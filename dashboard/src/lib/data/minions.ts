/**
 * Minions data layer — read the SOMA queue's SQLite DB directly.
 *
 * The canonical schema + SQL live in the `cortextos` package at
 * `src/minions/*`. This module duplicates the minimum surface the
 * dashboard needs (list / get + lightweight filters) so the dashboard
 * doesn't have to pull in the `cortextos` package at build time. Keep
 * the SQL in sync with `src/minions/queue.ts` if it changes.
 *
 * All mutations (cancel / retry) route through the CLI (`cortextos jobs
 * cancel <id>` etc.) so the authoritative state-machine transitions —
 * recursive CTE cancel cascade, parent rollup, child_done inbox — live
 * in one place (queue.ts).
 *
 * Output here is structured + full-fidelity — the ADR-014 "filter for
 * human readability" lives in the page component, not this layer.
 */

import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { join } from 'path';
import { getCTXRoot } from '@/lib/config';

export type MinionJobStatus =
  | 'waiting'
  | 'active'
  | 'completed'
  | 'failed'
  | 'delayed'
  | 'dead'
  | 'cancelled'
  | 'waiting-children'
  | 'paused';

export interface MinionJob {
  id: number;
  name: string;
  queue: string;
  status: MinionJobStatus;
  priority: number;
  data: Record<string, unknown>;
  max_attempts: number;
  attempts_made: number;
  stalled_counter: number;
  lock_token: string | null;
  lock_until: number | null;
  delay_until: number | null;
  parent_job_id: number | null;
  tokens_input: number;
  tokens_output: number;
  tokens_cache_read: number;
  depth: number;
  timeout_ms: number | null;
  timeout_at: number | null;
  idempotency_key: string | null;
  result: Record<string, unknown> | null;
  progress: unknown | null;
  error_text: string | null;
  stacktrace: string[];
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  updated_at: number;
}

function resolveDbPath(): string {
  if (process.env.SOMA_MINIONS_DB) return process.env.SOMA_MINIONS_DB;
  return join(getCTXRoot(), 'minions.db');
}

function openDb(): Database.Database | null {
  const path = resolveDbPath();
  if (!existsSync(path)) return null;
  const db = new Database(path, { readonly: true, fileMustExist: true });
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  return db;
}

function parseJsonField<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw !== 'string') return raw as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToJob(row: Record<string, unknown>): MinionJob {
  return {
    id: row.id as number,
    name: row.name as string,
    queue: row.queue as string,
    status: row.status as MinionJobStatus,
    priority: row.priority as number,
    data: parseJsonField<Record<string, unknown>>(row.data, {}),
    max_attempts: row.max_attempts as number,
    attempts_made: row.attempts_made as number,
    stalled_counter: (row.stalled_counter as number) ?? 0,
    lock_token: (row.lock_token as string) || null,
    lock_until: (row.lock_until as number | null) ?? null,
    delay_until: (row.delay_until as number | null) ?? null,
    parent_job_id: (row.parent_job_id as number | null) ?? null,
    tokens_input: (row.tokens_input as number) ?? 0,
    tokens_output: (row.tokens_output as number) ?? 0,
    tokens_cache_read: (row.tokens_cache_read as number) ?? 0,
    depth: (row.depth as number) ?? 0,
    timeout_ms: (row.timeout_ms as number | null) ?? null,
    timeout_at: (row.timeout_at as number | null) ?? null,
    idempotency_key: (row.idempotency_key as string) || null,
    result: parseJsonField<Record<string, unknown> | null>(row.result, null),
    progress: parseJsonField<unknown>(row.progress, null),
    error_text: (row.error_text as string) || null,
    stacktrace: parseJsonField<string[]>(row.stacktrace, []),
    created_at: row.created_at as number,
    started_at: (row.started_at as number | null) ?? null,
    finished_at: (row.finished_at as number | null) ?? null,
    updated_at: row.updated_at as number,
  };
}

export interface ListJobsFilters {
  status?: MinionJobStatus;
  queue?: string;
  name?: string;
  limit?: number;
  offset?: number;
}

export interface QueueStats {
  by_status: Record<string, number>;
  total: number;
  stalled: number;
}

/** List jobs. Returns an empty array if the DB doesn't exist yet. */
export function listJobs(filters: ListJobsFilters = {}): MinionJob[] {
  const db = openDb();
  if (!db) return [];
  try {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    if (filters.queue) {
      conditions.push('queue = ?');
      params.push(filters.queue);
    }
    if (filters.name) {
      conditions.push('name = ?');
      params.push(filters.name);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit ?? 100;
    const offset = filters.offset ?? 0;
    params.push(limit, offset);
    const rows = db
      .prepare(
        `SELECT * FROM minion_jobs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...(params as unknown[])) as Record<string, unknown>[];
    return rows.map(rowToJob);
  } finally {
    db.close();
  }
}

/** Fetch one job by id. Returns null if not found or DB missing. */
export function getJob(id: number): MinionJob | null {
  const db = openDb();
  if (!db) return null;
  try {
    const row = db.prepare('SELECT * FROM minion_jobs WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToJob(row) : null;
  } finally {
    db.close();
  }
}

/** Summary counts by status + stall count. */
export function getQueueStats(): QueueStats {
  const db = openDb();
  if (!db) return { by_status: {}, total: 0, stalled: 0 };
  try {
    const rows = db
      .prepare('SELECT status, count(*) AS count FROM minion_jobs GROUP BY status')
      .all() as Array<{ status: string; count: number }>;
    const by_status: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      by_status[r.status] = r.count;
      total += r.count;
    }
    const stallRow = db
      .prepare(
        "SELECT count(*) AS c FROM minion_jobs WHERE status = 'active' AND lock_until < ?",
      )
      .get(Date.now()) as { c: number } | undefined;
    return { by_status, total, stalled: stallRow?.c ?? 0 };
  } finally {
    db.close();
  }
}

/**
 * Shell out to `cortextos jobs <action> <id>` for mutations so the
 * authoritative state-machine logic (queue.ts tx, cascade cancel,
 * parent rollup) stays in one place. Returns stdout on success.
 */
export async function runCliAction(
  action: 'cancel' | 'retry',
  id: number,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const run = promisify(execFile);
  const cliPath = join(getCTXRoot(), '..', '..', 'cortextos', 'dist', 'cli.js');
  // Fall back to PATH if the local dist doesn't exist.
  const bin = existsSync(cliPath) ? cliPath : 'cortextos';
  const argv = existsSync(cliPath)
    ? ['jobs', action, String(id)]
    : ['jobs', action, String(id)];
  try {
    const { stdout } = await run(existsSync(cliPath) ? 'node' : bin, existsSync(cliPath) ? [cliPath, ...argv] : argv, {
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    return { ok: true, message: stdout.trim() };
  } catch (e) {
    const err = e as Error & { stderr?: string };
    return { ok: false, error: err.stderr || err.message };
  }
}
