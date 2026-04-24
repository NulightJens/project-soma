/**
 * SQLite engine for Minions.
 *
 * Implements `QueueEngine` over `better-sqlite3`. Boots the schema from
 * `schema.sql` on open. Translates "advisory locks" (gbrain's Postgres
 * primitive) into `BEGIN IMMEDIATE` transactions + a sentinel row in
 * `minion_rate_leases` — same semantics for single-writer SOMA, no
 * distributed lock service required.
 *
 * Connection PRAGMAs:
 *   journal_mode = WAL       — reader/writer concurrency
 *   synchronous  = NORMAL    — durable-on-commit, not per-write
 *   foreign_keys = ON        — cascade deletes
 *   busy_timeout = 5000      — 5s wait on contended locks
 */

import Database from 'better-sqlite3';
import type { Database as BetterSqliteDatabase, Statement } from 'better-sqlite3';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import type { QueueEngine, QueueEngineOpts, Row } from './engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Options accepted by `openSqliteEngine`. */
export interface SqliteEngineOpts extends QueueEngineOpts {
  /**
   * Filesystem path to the database. Pass `:memory:` for an in-memory
   * database (test-only; each open gets a fresh DB).
   */
  path: string;
  /** Skip schema bootstrap. For tests that control schema lifecycle. */
  skipSchema?: boolean;
  /**
   * Override path to schema.sql. Defaults to the sibling file shipped
   * with the compiled module.
   */
  schemaPath?: string;
  /**
   * Busy timeout in ms for contended locks. SQLite default is 5s.
   * Raise for workloads with heavy lock contention.
   */
  busyTimeoutMs?: number;
}

class SqliteEngine implements QueueEngine {
  readonly kind = 'sqlite' as const;
  private readonly db: BetterSqliteDatabase;
  private readonly getNow: () => number;
  private readonly stmtCache = new Map<string, Statement>();
  private closed = false;

  constructor(opts: SqliteEngineOpts) {
    this.db = new Database(opts.path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma(`busy_timeout = ${opts.busyTimeoutMs ?? 5000}`);

    if (!opts.skipSchema) {
      const schemaPath = opts.schemaPath ?? resolveSchemaPath();
      const ddl = readFileSync(schemaPath, 'utf-8');
      this.db.exec(ddl);
    }

    const clock = opts.clock;
    if (typeof clock === 'number') {
      this.getNow = () => clock;
    } else if (typeof clock === 'function') {
      this.getNow = clock;
    } else {
      this.getNow = () => Date.now();
    }
  }

  async exec(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<{ lastInsertId: number; changes: number }> {
    const stmt = this.prepare(sql);
    const info = stmt.run(...(params as unknown[]));
    return {
      lastInsertId: Number(info.lastInsertRowid ?? 0),
      changes: info.changes,
    };
  }

  async one<T = Row>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
    const stmt = this.prepare(sql);
    const row = stmt.get(...(params as unknown[]));
    return (row as T | undefined) ?? null;
  }

  async all<T = Row>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    const stmt = this.prepare(sql);
    const rows = stmt.all(...(params as unknown[]));
    return rows as T[];
  }

  async tx<T>(fn: (tx: QueueEngine) => Promise<T>): Promise<T> {
    // better-sqlite3's `db.transaction` runs synchronously. Our engine
    // surface is async by contract, but SQLite is synchronous underneath
    // — we execute the callback and let its awaits resolve via the
    // single-threaded event loop. Nested tx attempts are forbidden by
    // SQLite (SAVEPOINT would be required; we don't use that yet).
    //
    // Implementation: open a BEGIN IMMEDIATE, run `fn(this)`, and commit
    // or rollback based on thrown/returned. This is explicit instead of
    // relying on `db.transaction` because the callback can be async.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = await fn(this);
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // ignore — if rollback fails, the original error is more important
      }
      throw err;
    }
  }

  /**
   * Acquire a named lock. Implemented as a `BEGIN IMMEDIATE` tx that
   * inserts a sentinel row into `minion_rate_leases`. Release closes the
   * tx.
   *
   * For single-writer SOMA this provides mutex semantics matching
   * gbrain's `pg_advisory_xact_lock`. The Postgres engine (later)
   * restores true advisory-lock semantics for distributed workloads.
   */
  async acquireLock(key: string, timeoutMs: number): Promise<() => Promise<void>> {
    const deadline = this.getNow() + timeoutMs;
    const leaseToken = randomBytes(16).toString('hex');
    const pollInterval = 50;

    while (true) {
      // Try to reserve: INSERT ... SELECT where NOT EXISTS an active lease
      // for this key. Scope format is `__lock__:{key}:{token}` — unique per
      // acquisition — so we match on a `LIKE '__lock__:{key}:%'` pattern
      // when checking for contention. owner_job = NULL marks an engine-owned
      // advisory lock (as opposed to a job-owned rate lease).
      const { changes } = await this.exec(
        `INSERT INTO minion_rate_leases (scope, owner_job, acquired_at)
         SELECT ?, NULL, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM minion_rate_leases
           WHERE scope LIKE ? ESCAPE '\\' AND released_at IS NULL
         )`,
        [
          `__lock__:${key}:${leaseToken}`,
          this.getNow(),
          `__lock__:${escapeLike(key)}:%`,
        ],
      );

      if (changes === 1) {
        const row = await this.one<{ id: number }>(
          `SELECT id FROM minion_rate_leases WHERE scope = ? AND released_at IS NULL`,
          [`__lock__:${key}:${leaseToken}`],
        );
        const leaseId = row?.id;
        if (leaseId === undefined) {
          throw new Error(`acquireLock: inserted lease row disappeared (key=${key})`);
        }
        return async () => {
          await this.exec(
            `UPDATE minion_rate_leases SET released_at = ? WHERE id = ?`,
            [this.getNow(), leaseId],
          );
        };
      }

      if (this.getNow() >= deadline) {
        throw new Error(`acquireLock: timeout after ${timeoutMs}ms (key=${key})`);
      }
      await sleep(pollInterval);
    }
  }

  now(): number {
    return this.getNow();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stmtCache.clear();
    this.db.close();
  }

  private prepare(sql: string): Statement {
    const cached = this.stmtCache.get(sql);
    if (cached) return cached;
    const stmt = this.db.prepare(sql);
    this.stmtCache.set(sql, stmt);
    return stmt;
  }
}

/**
 * Factory: open a fresh SQLite engine. Bootstraps schema on first open
 * unless `skipSchema` is set. Idempotent — opening an existing DB is a
 * no-op for the schema (CREATE IF NOT EXISTS throughout).
 */
export function openSqliteEngine(opts: SqliteEngineOpts): QueueEngine {
  return new SqliteEngine(opts);
}

function resolveSchemaPath(): string {
  // When running from dist/, schema.sql sits next to engine-sqlite.js.
  // When running from src/ (tsx dev mode), schema.sql sits next to
  // engine-sqlite.ts. `__dirname` resolves to both correctly under
  // `module: esnext` + `moduleResolution: bundler`.
  return join(__dirname, 'schema.sql');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Escape `%`, `_`, and `\` in a lock key for safe use inside a
 * `LIKE ... ESCAPE '\\'` pattern. Lock keys are application-supplied
 * strings — a user-scheduled lock named `10%_off` should not
 * accidentally match `10XXoff` just because `%` and `_` are LIKE
 * wildcards.
 */
function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (m) => '\\' + m);
}
