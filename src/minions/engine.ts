/**
 * QueueEngine — pluggable backend interface for Minions.
 *
 * Contract: every Minions feature that needs persistence goes through
 * this interface. Engines implement the contract; queue.ts / worker.ts
 * are engine-agnostic.
 *
 * SOMA ships these engines:
 *   - 'sqlite'    — `better-sqlite3` on disk (default local dev)
 *   - 'pglite'    — WASM Postgres (parity with gbrain)
 *   - 'postgres'  — remote Postgres (production multi-process)
 *   - 'd1'        — Cloudflare D1 (distributed edge)
 *
 * Only 'sqlite' is implemented in Phase 1. The interface below is the
 * contract the other engines will fill in.
 */

export type QueueEngineKind = 'sqlite' | 'pglite' | 'postgres' | 'd1';

/**
 * Row shape returned by engine queries. Engines normalise to plain
 * objects; callers use `rowTo*` helpers in `types.ts` to decode.
 */
export type Row = Record<string, unknown>;

/**
 * Minimal SQL-ish interface every engine supports. Queries use `?`
 * placeholders; engines translate to their native binding style.
 */
export interface QueueEngine {
  readonly kind: QueueEngineKind;

  /** Run a write statement. Returns last insert rowid (0 if none) and change count. */
  exec(sql: string, params?: readonly unknown[]): Promise<{ lastInsertId: number; changes: number }>;

  /** Fetch a single row (or null). */
  one<T = Row>(sql: string, params?: readonly unknown[]): Promise<T | null>;

  /** Fetch all rows. */
  all<T = Row>(sql: string, params?: readonly unknown[]): Promise<T[]>;

  /**
   * Run `fn` inside a transaction. Engines choose isolation level
   * sensibly (SQLite: BEGIN IMMEDIATE; Postgres: READ COMMITTED).
   * Throwing from `fn` rolls back.
   */
  tx<T>(fn: (tx: QueueEngine) => Promise<T>): Promise<T>;

  /**
   * Acquire an advisory-style concurrency lock scoped to `key`.
   * Implementations:
   *   - sqlite   → BEGIN IMMEDIATE tx + sentinel row
   *   - postgres → pg_advisory_xact_lock
   *   - d1       → eventual-consistent rows + `UPDATE ... WHERE NOT EXISTS`
   * Returns a release function. Throws if the lock cannot be obtained
   * within `timeoutMs`.
   */
  acquireLock(key: string, timeoutMs: number): Promise<() => Promise<void>>;

  /** Return `NOW()` in Unix ms. Centralised so tests can inject a clock. */
  now(): number;

  /** Close underlying connections. Idempotent. */
  close(): Promise<void>;
}

/**
 * Options common to all engines. Engine-specific options extend this.
 */
export interface QueueEngineOpts {
  /** Set `this.now()` to a fixed value or callable — for tests. */
  clock?: number | (() => number);
}
