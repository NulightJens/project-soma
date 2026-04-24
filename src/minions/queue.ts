/**
 * MinionQueue — SOMA's durable priority queue.
 *
 * Ported from gbrain's `src/core/minions/queue.ts` (MIT © Garry Tan).
 *
 * SOMA adaptations from the Postgres original (all annotated `// SOMA:`
 * inline where they occur):
 *   - `$N` placeholders → `?` placeholders (better-sqlite3 style)
 *   - `$N::jsonb` casts → app-side `JSON.stringify()` before binding
 *   - `now()` SQL → engine.now() (Unix ms from JS)
 *   - Postgres `INTERVAL '1 millisecond'` arithmetic → JS math
 *   - `FOR UPDATE` / `FOR UPDATE SKIP LOCKED` → dropped. The engine's
 *     `tx()` opens a SQLite BEGIN IMMEDIATE which serializes writers at
 *     the DB level. Single-writer SOMA preserves gbrain's correctness.
 *     The Postgres engine (Phase 7) will restore row-level locking.
 *   - `ANY($N)` array param → dynamic `IN (?, ?, ...)` generation
 *   - `count(*) FILTER (WHERE cond)` → `SUM(CASE WHEN cond THEN 1 ELSE 0 END)`
 *   - `to_jsonb($x::text) || stacktrace` append → JS-side read + parse +
 *     push + stringify + write
 *   - Date `.toISOString()` for bindings → pass Unix ms number directly
 *   - Timestamps are Unix ms throughout (schema INTEGER, app number)
 *   - `ensureSchema()` removed — engine bootstrap handles DDL on open
 *
 * Deferred from this first port (tracked as TODOs):
 *   - Attachments (addAttachment/listAttachments/getAttachment/
 *     deleteAttachment) — depend on `attachments.ts` helper. Next pass.
 *   - Protected-name gate — depends on `protected-names.ts`. Next pass.
 *     Present callers pass `trusted: {allowProtectedSubmit: true}` to
 *     bypass; absent callers get a placeholder no-op until the gate
 *     lands.
 *
 * Usage:
 *   const queue = new MinionQueue(engine);
 *   const job = await queue.add('sync', { full: true });
 *   const claimed = await queue.claim('worker-1', 30000, 'default', ['sync']);
 *   await queue.completeJob(claimed.id, 'worker-1', { ok: true });
 */

import type { QueueEngine } from './engine.js';
import type {
  Attachment,
  AttachmentInput,
  MinionJob,
  MinionJobInput,
  MinionJobStatus,
  InboxMessage,
  TokenUpdate,
  MinionQueueOpts,
  ChildDoneMessage,
} from './types.js';
import { rowToAttachment, rowToMinionJob, rowToInboxMessage } from './types.js';
import { validateAttachment } from './attachments.js';

/**
 * Opt-in trust flag for submitting protected job names ('shell' today).
 * Passed as the 4th argument to `add()` so spread-user-opts can't carry
 * it accidentally.
 *
 * SOMA: protected-names gate not yet ported; flag preserved in the
 * signature for wire compatibility.
 */
export interface TrustedSubmitOpts {
  allowProtectedSubmit?: boolean;
}

const DEFAULT_MAX_SPAWN_DEPTH = 5;
const DEFAULT_MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MiB

export class MinionQueue {
  readonly maxSpawnDepth: number;
  readonly maxAttachmentBytes: number;

  constructor(private engine: QueueEngine, opts: MinionQueueOpts = {}) {
    this.maxSpawnDepth = opts.maxSpawnDepth ?? DEFAULT_MAX_SPAWN_DEPTH;
    this.maxAttachmentBytes = opts.maxAttachmentBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES;
  }

  // ---------------------------------------------------------------------------
  // Submission
  // ---------------------------------------------------------------------------

  /**
   * Submit a new job.
   *
   * Wrapped in `engine.tx()`: when parent_job_id is set, the tx serializes
   * concurrent submissions so the cap check is coherent. Without this,
   * two concurrent submissions could both see count = N-1 and both
   * insert, blowing max_children.
   *
   * Child status is 'waiting' (or 'delayed') — claimable. Parent is flipped
   * to 'waiting-children' atomically. `idempotency_key` dedups via the
   * unique partial index; the same key returns the existing row with no
   * second insert.
   */
  async add(
    name: string,
    data?: Record<string, unknown>,
    opts?: Partial<MinionJobInput>,
    _trusted?: TrustedSubmitOpts, // SOMA: protected-names gate not yet ported
  ): Promise<MinionJob> {
    const jobName = (name || '').trim();
    if (jobName.length === 0) {
      throw new Error('Job name cannot be empty');
    }
    // SOMA: protected-names enforcement lands with protected-names.ts port.
    // Current behavior: no gate. All names accepted. Existing Minions
    // callers should continue passing `{allowProtectedSubmit: true}` on
    // trusted paths so the signature doesn't drift.

    const now = this.engine.now();
    const childStatus: MinionJobStatus = opts?.delay ? 'delayed' : 'waiting';
    const delayUntil = opts?.delay ? now + opts.delay : null;
    const maxSpawnDepth = opts?.max_spawn_depth ?? this.maxSpawnDepth;

    return this.engine.tx(async (tx) => {
      // 1. Idempotency fast path — existing row wins, no further work.
      if (opts?.idempotency_key) {
        const existing = await tx.one<Record<string, unknown>>(
          `SELECT * FROM minion_jobs WHERE idempotency_key = ?`,
          [opts.idempotency_key],
        );
        if (existing) return rowToMinionJob(existing);
      }

      // 2. Parent lookup + depth/cap validation. SOMA: the BEGIN IMMEDIATE
      //    transaction already serializes writers; we don't need a
      //    per-row FOR UPDATE.
      let depth = 0;
      if (opts?.parent_job_id) {
        const parentRow = await tx.one<Record<string, unknown>>(
          `SELECT * FROM minion_jobs WHERE id = ?`,
          [opts.parent_job_id],
        );
        if (!parentRow) {
          throw new Error(`parent_job_id ${opts.parent_job_id} not found`);
        }
        const parent = rowToMinionJob(parentRow);

        depth = parent.depth + 1;
        if (depth > maxSpawnDepth) {
          throw new Error(`spawn depth ${depth} exceeds maxSpawnDepth ${maxSpawnDepth}`);
        }

        if (parent.max_children !== null) {
          const countRow = await tx.one<{ count: number }>(
            `SELECT count(*) AS count FROM minion_jobs
             WHERE parent_job_id = ? AND status NOT IN ('completed','failed','dead','cancelled')`,
            [opts.parent_job_id],
          );
          const live = countRow?.count ?? 0;
          if (live >= parent.max_children) {
            throw new Error(
              `parent ${opts.parent_job_id} already has ${live} live children (max_children=${parent.max_children})`,
            );
          }
        }
      }

      // 3. Insert child. ON CONFLICT catches an idempotency race.
      //    max_stalled is conditional — when provided, clamped to [1,100]
      //    and included; when absent, the schema DEFAULT (5) applies.
      const hasMaxStalled = opts?.max_stalled !== undefined && opts.max_stalled !== null;
      const clampedMaxStalled = hasMaxStalled
        ? Math.max(1, Math.min(100, Math.floor(opts!.max_stalled as number)))
        : null;

      const cols: string[] = [
        'name',
        'queue',
        'status',
        'priority',
        'data',
        'max_attempts',
        'backoff_type',
        'backoff_delay',
        'backoff_jitter',
        'delay_until',
        'parent_job_id',
        'on_child_fail',
        'depth',
        'max_children',
        'timeout_ms',
        'remove_on_complete',
        'remove_on_fail',
        'idempotency_key',
        'quiet_hours',
        'stagger_key',
        'created_at',
        'updated_at',
      ];
      const params: unknown[] = [
        jobName,
        opts?.queue ?? 'default',
        childStatus,
        opts?.priority ?? 0,
        JSON.stringify(data ?? {}),
        opts?.max_attempts ?? 3,
        opts?.backoff_type ?? 'exponential',
        opts?.backoff_delay ?? 1000,
        opts?.backoff_jitter ?? 0.2,
        delayUntil,
        opts?.parent_job_id ?? null,
        opts?.on_child_fail ?? 'fail_parent',
        depth,
        opts?.max_children ?? null,
        opts?.timeout_ms ?? null,
        opts?.remove_on_complete ? 1 : 0,
        opts?.remove_on_fail ? 1 : 0,
        opts?.idempotency_key ?? null,
        opts?.quiet_hours ? JSON.stringify(opts.quiet_hours) : null,
        opts?.stagger_key ?? null,
        now,
        now,
      ];
      if (hasMaxStalled) {
        cols.push('max_stalled');
        params.push(clampedMaxStalled);
      }

      const placeholders = params.map(() => '?').join(', ');
      // SOMA: SQLite requires the partial-index predicate in the
      // ON CONFLICT target so it can match `minion_jobs_idempotency_idx`
      // (which is `CREATE UNIQUE INDEX ... WHERE idempotency_key IS NOT NULL`).
      // Postgres tolerates the bare form; SQLite errors without the WHERE.
      const insertSql = opts?.idempotency_key
        ? `INSERT INTO minion_jobs (${cols.join(', ')})
           VALUES (${placeholders})
           ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
           RETURNING *`
        : `INSERT INTO minion_jobs (${cols.join(', ')})
           VALUES (${placeholders})
           RETURNING *`;

      const inserted = await tx.all<Record<string, unknown>>(insertSql, params);

      // ON CONFLICT DO NOTHING returns 0 rows — fall back to SELECT to
      // fetch the row that won the race.
      if (inserted.length === 0 && opts?.idempotency_key) {
        const existing = await tx.one<Record<string, unknown>>(
          `SELECT * FROM minion_jobs WHERE idempotency_key = ?`,
          [opts.idempotency_key],
        );
        if (!existing) {
          throw new Error(
            `idempotency_key ${opts.idempotency_key} insert returned no row and no existing row found`,
          );
        }
        return rowToMinionJob(existing);
      }

      const child = rowToMinionJob(inserted[0]);

      // 4. Flip parent to waiting-children if this is a fresh child insert.
      //    Only transition from non-terminal, non-already-waiting-children states.
      if (opts?.parent_job_id) {
        await tx.exec(
          `UPDATE minion_jobs SET status = 'waiting-children', updated_at = ?
           WHERE id = ? AND status IN ('waiting','active','delayed')`,
          [now, opts.parent_job_id],
        );
      }

      return child;
    });
  }

  // ---------------------------------------------------------------------------
  // Read paths
  // ---------------------------------------------------------------------------

  /** Get a job by ID. Returns null if not found. */
  async getJob(id: number): Promise<MinionJob | null> {
    const row = await this.engine.one<Record<string, unknown>>(
      'SELECT * FROM minion_jobs WHERE id = ?',
      [id],
    );
    return row ? rowToMinionJob(row) : null;
  }

  /** List jobs with optional filters. */
  async getJobs(opts?: {
    status?: MinionJobStatus;
    queue?: string;
    name?: string;
    limit?: number;
    offset?: number;
  }): Promise<MinionJob[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts?.status) {
      conditions.push(`status = ?`);
      params.push(opts.status);
    }
    if (opts?.queue) {
      conditions.push(`queue = ?`);
      params.push(opts.queue);
    }
    if (opts?.name) {
      conditions.push(`name = ?`);
      params.push(opts.name);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;
    params.push(limit, offset);

    const rows = await this.engine.all<Record<string, unknown>>(
      `SELECT * FROM minion_jobs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      params,
    );
    return rows.map(rowToMinionJob);
  }

  /** Remove a job. Only terminal statuses can be removed. */
  async removeJob(id: number): Promise<boolean> {
    const { changes } = await this.engine.exec(
      `DELETE FROM minion_jobs WHERE id = ? AND status IN ('completed','dead','cancelled','failed')`,
      [id],
    );
    return changes > 0;
  }

  // ---------------------------------------------------------------------------
  // Cancellation
  // ---------------------------------------------------------------------------

  /**
   * Cancel a job and cascade-kill all descendants in one transaction.
   *
   * BullMQ-style best-effort cancel: the recursive CTE snapshots the
   * parent_job_id chain at statement start. A descendant re-parented
   * BEFORE the cancel call is excluded; one re-parented DURING may still
   * get cancelled if seen in the snapshot. Re-parented descendants whose
   * parent_job_id was NULL'd by removeChildDependency naturally fall out.
   *
   * Active descendants get `lock_token = NULL` — the same path pause
   * uses — so the worker's renewLock fails next tick and the handler's
   * AbortController fires.
   *
   * Returns the *root* (the job matching id), not an arbitrary descendant.
   */
  async cancelJob(id: number): Promise<MinionJob | null> {
    return this.engine.tx(async (tx) => {
      const now = this.engine.now();
      const rows = await tx.all<Record<string, unknown>>(
        `WITH RECURSIVE descendants AS (
           SELECT id, 0 AS d FROM minion_jobs WHERE id = ?
           UNION ALL
           SELECT m.id, descendants.d + 1
             FROM minion_jobs m
             JOIN descendants ON m.parent_job_id = descendants.id
             WHERE descendants.d < 100
         )
         UPDATE minion_jobs SET
           status = 'cancelled',
           lock_token = NULL,
           lock_until = NULL,
           finished_at = ?,
           updated_at = ?
          WHERE id IN (SELECT id FROM descendants)
            AND status IN ('waiting','active','delayed','waiting-children','paused')
          RETURNING *`,
        [id, now, now],
      );
      if (rows.length === 0) return null;

      // Emit child_done(outcome='cancelled') for every cancelled row with a
      // parent, then resolve any aggregator parents whose last open child
      // we just cancelled.
      const parentIds = new Set<number>();
      for (const r of rows) {
        const parentJobId = r.parent_job_id as number | null;
        if (parentJobId == null) continue;
        parentIds.add(parentJobId);
        const childDone: ChildDoneMessage = {
          type: 'child_done',
          child_id: r.id as number,
          job_name: r.name as string,
          result: null,
          outcome: 'cancelled',
          error: 'cancelled',
        };
        await this.postChildDone(tx, parentJobId, childDone);
      }

      for (const parentId of parentIds) {
        await this.resolveParentInTx(tx, parentId, now);
      }

      const root = rows.find((r) => (r.id as number) === id);
      return root ? rowToMinionJob(root) : null;
    });
  }

  /** Re-queue a failed or dead job for retry. */
  async retryJob(id: number): Promise<MinionJob | null> {
    const now = this.engine.now();
    const rows = await this.engine.all<Record<string, unknown>>(
      `UPDATE minion_jobs SET status = 'waiting', error_text = NULL,
        lock_token = NULL, lock_until = NULL, delay_until = NULL,
        finished_at = NULL, updated_at = ?
       WHERE id = ? AND status IN ('failed','dead')
       RETURNING *`,
      [now, id],
    );
    return rows.length > 0 ? rowToMinionJob(rows[0]) : null;
  }

  /** Prune old jobs in terminal statuses. Returns count of deleted rows. */
  async prune(opts?: { olderThan?: Date; status?: MinionJobStatus[] }): Promise<number> {
    const statuses = opts?.status ?? ['completed', 'dead', 'cancelled'];
    const olderThanMs = opts?.olderThan
      ? opts.olderThan.getTime()
      : this.engine.now() - 30 * 86400000;

    const placeholders = statuses.map(() => '?').join(', ');
    const { changes } = await this.engine.exec(
      `DELETE FROM minion_jobs
       WHERE status IN (${placeholders}) AND updated_at < ?`,
      [...statuses, olderThanMs],
    );
    return changes;
  }

  /** Get job statistics. */
  async getStats(opts?: { since?: Date }): Promise<{
    by_status: Record<string, number>;
    by_type: Array<{
      name: string;
      total: number;
      completed: number;
      failed: number;
      dead: number;
      avg_duration_ms: number | null;
    }>;
    queue_health: { waiting: number; active: number; stalled: number };
  }> {
    const sinceMs = opts?.since ? opts.since.getTime() : this.engine.now() - 86400000;
    const now = this.engine.now();

    const statusRows = await this.engine.all<{ status: string; count: number }>(
      `SELECT status, count(*) AS count FROM minion_jobs GROUP BY status`,
    );
    const by_status: Record<string, number> = {};
    for (const r of statusRows) by_status[r.status] = r.count;

    // SOMA: `count(*) FILTER (WHERE cond)` rewritten as SUM CASE WHEN.
    const typeRows = await this.engine.all<{
      name: string;
      total: number;
      completed: number;
      failed: number;
      dead: number;
      avg_duration_ms: number | null;
    }>(
      `SELECT name,
        count(*) AS total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status = 'dead' THEN 1 ELSE 0 END) AS dead,
        AVG(CASE WHEN finished_at IS NOT NULL AND started_at IS NOT NULL
                 THEN finished_at - started_at
                 ELSE NULL END) AS avg_duration_ms
       FROM minion_jobs WHERE created_at >= ?
       GROUP BY name ORDER BY total DESC`,
      [sinceMs],
    );
    const by_type = typeRows.map((r) => ({
      name: r.name,
      total: r.total,
      completed: r.completed,
      failed: r.failed,
      dead: r.dead,
      avg_duration_ms: r.avg_duration_ms != null ? Math.round(r.avg_duration_ms) : null,
    }));

    const stalledRow = await this.engine.one<{ count: number }>(
      `SELECT count(*) AS count FROM minion_jobs WHERE status = 'active' AND lock_until < ?`,
      [now],
    );
    const stalled = stalledRow?.count ?? 0;

    return {
      by_status,
      by_type,
      queue_health: {
        waiting: by_status['waiting'] ?? 0,
        active: by_status['active'] ?? 0,
        stalled,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Claim / renew / lock management
  // ---------------------------------------------------------------------------

  /**
   * Claim the next waiting job for a worker. Token-fenced, filters by
   * registered names.
   *
   * Sets `timeout_at = now + timeout_ms` so `handleTimeouts` can
   * dead-letter expired jobs without re-reading `timeout_ms`.
   *
   * SOMA: Postgres `FOR UPDATE SKIP LOCKED` dropped — the engine's
   * BEGIN IMMEDIATE transaction serializes writers at the database
   * level. Single-writer SOMA preserves correctness; the Postgres
   * engine (Phase 7) restores SKIP LOCKED for distributed workloads.
   */
  async claim(
    lockToken: string,
    lockDurationMs: number,
    queue: string,
    registeredNames: string[],
  ): Promise<MinionJob | null> {
    if (registeredNames.length === 0) return null;

    return this.engine.tx(async (tx) => {
      const now = this.engine.now();
      const lockUntil = now + lockDurationMs;

      const namePlaceholders = registeredNames.map(() => '?').join(', ');
      const candidate = await tx.one<{ id: number; timeout_ms: number | null }>(
        `SELECT id, timeout_ms FROM minion_jobs
         WHERE queue = ? AND status = 'waiting' AND name IN (${namePlaceholders})
         ORDER BY priority ASC, created_at ASC
         LIMIT 1`,
        [queue, ...registeredNames],
      );
      if (!candidate) return null;

      const timeoutAt = candidate.timeout_ms ? now + candidate.timeout_ms : null;

      const rows = await tx.all<Record<string, unknown>>(
        `UPDATE minion_jobs SET
          status = 'active',
          lock_token = ?,
          lock_until = ?,
          timeout_at = ?,
          attempts_started = attempts_started + 1,
          started_at = COALESCE(started_at, ?),
          updated_at = ?
         WHERE id = ? AND status = 'waiting'
         RETURNING *`,
        [lockToken, lockUntil, timeoutAt, now, now, candidate.id],
      );
      return rows.length > 0 ? rowToMinionJob(rows[0]) : null;
    });
  }

  /** Renew lock (token-fenced). Returns false on token mismatch. */
  async renewLock(id: number, lockToken: string, lockDurationMs: number): Promise<boolean> {
    const now = this.engine.now();
    const { changes } = await this.engine.exec(
      `UPDATE minion_jobs SET lock_until = ?, updated_at = ?
       WHERE id = ? AND lock_token = ? AND status = 'active'`,
      [now + lockDurationMs, now, id, lockToken],
    );
    return changes > 0;
  }

  /** Update job progress (token-fenced). */
  async updateProgress(id: number, lockToken: string, progress: unknown): Promise<boolean> {
    const { changes } = await this.engine.exec(
      `UPDATE minion_jobs SET progress = ?, updated_at = ?
       WHERE id = ? AND status = 'active' AND lock_token = ?`,
      [JSON.stringify(progress), this.engine.now(), id, lockToken],
    );
    return changes > 0;
  }

  /** Update token counts for a job (accumulates). Token-fenced. */
  async updateTokens(id: number, lockToken: string, tokens: TokenUpdate): Promise<boolean> {
    const { changes } = await this.engine.exec(
      `UPDATE minion_jobs SET
        tokens_input = tokens_input + ?,
        tokens_output = tokens_output + ?,
        tokens_cache_read = tokens_cache_read + ?,
        updated_at = ?
       WHERE id = ? AND status = 'active' AND lock_token = ?`,
      [
        tokens.input ?? 0,
        tokens.output ?? 0,
        tokens.cache_read ?? 0,
        this.engine.now(),
        id,
        lockToken,
      ],
    );
    return changes > 0;
  }

  // ---------------------------------------------------------------------------
  // Timeout / stall / delayed promotion
  // ---------------------------------------------------------------------------

  /**
   * Dead-letter active jobs whose `timeout_at` has passed.
   *
   * The `lock_until > now()` guard is critical: a stalled job
   * (`lock_until < now`) is being requeued by `handleStalled`, NOT timed
   * out terminally. Stall → retry, timeout → dead. Run order in worker
   * loop: `handleStalled()` BEFORE `handleTimeouts()` to give stall
   * recovery first crack.
   */
  async handleTimeouts(): Promise<MinionJob[]> {
    return this.engine.tx(async (tx) => {
      const now = this.engine.now();
      const rows = await tx.all<Record<string, unknown>>(
        `UPDATE minion_jobs SET
          status = 'dead',
          error_text = 'timeout exceeded',
          lock_token = NULL,
          lock_until = NULL,
          finished_at = ?,
          updated_at = ?
         WHERE status = 'active'
           AND timeout_at IS NOT NULL
           AND timeout_at < ?
           AND lock_until > ?
         RETURNING *`,
        [now, now, now, now],
      );

      const parentIds = new Set<number>();
      for (const r of rows) {
        const parentJobId = r.parent_job_id as number | null;
        if (parentJobId == null) continue;
        parentIds.add(parentJobId);
        const childDone: ChildDoneMessage = {
          type: 'child_done',
          child_id: r.id as number,
          job_name: r.name as string,
          result: null,
          outcome: 'timeout',
          error: 'timeout exceeded',
        };
        await this.postChildDone(tx, parentJobId, childDone);
      }

      for (const parentId of parentIds) {
        await this.resolveParentInTx(tx, parentId, now);
      }

      return rows.map(rowToMinionJob);
    });
  }

  /** Promote delayed jobs whose `delay_until` has passed. */
  async promoteDelayed(): Promise<MinionJob[]> {
    const now = this.engine.now();
    const rows = await this.engine.all<Record<string, unknown>>(
      `UPDATE minion_jobs SET status = 'waiting', delay_until = NULL,
        lock_token = NULL, lock_until = NULL, updated_at = ?
       WHERE status = 'delayed' AND delay_until <= ?
       RETURNING *`,
      [now, now],
    );
    return rows.map(rowToMinionJob);
  }

  /**
   * Detect + handle stalled jobs (active with expired lock). Single
   * transaction, no off-by-one.
   *
   * SOMA: gbrain's single-CTE with three ` UNION ALL` RETURNINGs isn't
   * expressible in SQLite — SQLite doesn't support `UPDATE` in a CTE.
   * We do the same work in two passes inside a tx: first query the
   * stalled set (locking them via the BEGIN IMMEDIATE), then UPDATE
   * each set separately.
   */
  async handleStalled(): Promise<{ requeued: MinionJob[]; dead: MinionJob[] }> {
    return this.engine.tx(async (tx) => {
      const now = this.engine.now();
      const stalled = await tx.all<{
        id: number;
        stalled_counter: number;
        max_stalled: number;
      }>(
        `SELECT id, stalled_counter, max_stalled
           FROM minion_jobs
          WHERE status = 'active' AND lock_until < ?`,
        [now],
      );
      if (stalled.length === 0) return { requeued: [], dead: [] };

      const toRequeueIds: number[] = [];
      const toDeadIds: number[] = [];
      for (const s of stalled) {
        if (s.stalled_counter + 1 < s.max_stalled) toRequeueIds.push(s.id);
        else toDeadIds.push(s.id);
      }

      const requeued: MinionJob[] = [];
      if (toRequeueIds.length > 0) {
        const ph = toRequeueIds.map(() => '?').join(', ');
        const rows = await tx.all<Record<string, unknown>>(
          `UPDATE minion_jobs SET
            status = 'waiting',
            stalled_counter = stalled_counter + 1,
            lock_token = NULL,
            lock_until = NULL,
            updated_at = ?
           WHERE id IN (${ph})
           RETURNING *`,
          [now, ...toRequeueIds],
        );
        requeued.push(...rows.map(rowToMinionJob));
      }

      const dead: MinionJob[] = [];
      if (toDeadIds.length > 0) {
        const ph = toDeadIds.map(() => '?').join(', ');
        const rows = await tx.all<Record<string, unknown>>(
          `UPDATE minion_jobs SET
            status = 'dead',
            stalled_counter = stalled_counter + 1,
            error_text = 'max stalled count exceeded',
            lock_token = NULL,
            lock_until = NULL,
            finished_at = ?,
            updated_at = ?
           WHERE id IN (${ph})
           RETURNING *`,
          [now, now, ...toDeadIds],
        );
        dead.push(...rows.map(rowToMinionJob));
      }

      return { requeued, dead };
    });
  }

  // ---------------------------------------------------------------------------
  // Terminal transitions (complete / fail)
  // ---------------------------------------------------------------------------

  /**
   * Complete a job (token-fenced). Atomic: mark completed, roll up tokens
   * to parent, post child_done, resolve parent waiting-children, handle
   * remove_on_complete.
   */
  async completeJob(
    id: number,
    lockToken: string,
    result?: Record<string, unknown>,
  ): Promise<MinionJob | null> {
    return this.engine.tx(async (tx) => {
      const now = this.engine.now();
      const rows = await tx.all<Record<string, unknown>>(
        `UPDATE minion_jobs SET
          status = 'completed',
          result = ?,
          finished_at = ?,
          lock_token = NULL,
          lock_until = NULL,
          updated_at = ?
         WHERE id = ? AND status = 'active' AND lock_token = ?
         RETURNING *`,
        [result ? JSON.stringify(result) : null, now, now, id, lockToken],
      );
      if (rows.length === 0) return null;

      const completed = rowToMinionJob(rows[0]);

      if (completed.parent_job_id) {
        if (
          completed.tokens_input > 0 ||
          completed.tokens_output > 0 ||
          completed.tokens_cache_read > 0
        ) {
          await tx.exec(
            `UPDATE minion_jobs SET
              tokens_input = tokens_input + ?,
              tokens_output = tokens_output + ?,
              tokens_cache_read = tokens_cache_read + ?,
              updated_at = ?
             WHERE id = ? AND status NOT IN ('completed','failed','dead','cancelled')`,
            [
              completed.tokens_input,
              completed.tokens_output,
              completed.tokens_cache_read,
              now,
              completed.parent_job_id,
            ],
          );
        }

        const childDone: ChildDoneMessage = {
          type: 'child_done',
          child_id: completed.id,
          job_name: completed.name,
          result: result ?? null,
          outcome: 'complete',
        };
        await this.postChildDone(tx, completed.parent_job_id, childDone);
        await this.resolveParentInTx(tx, completed.parent_job_id, now);
      }

      if (completed.remove_on_complete) {
        await tx.exec(`DELETE FROM minion_jobs WHERE id = ?`, [completed.id]);
      }

      return completed;
    });
  }

  /**
   * Fail a job (token-fenced). Atomic: transition to delayed/failed/dead,
   * append error to stacktrace, on terminal-failure run on_child_fail
   * policy, post child_done, handle remove_on_fail.
   *
   * SOMA: gbrain's `stacktrace = COALESCE(stacktrace, '[]'::jsonb) || to_jsonb($x::text)`
   * append is rewritten as a JS-side read + push + write, since SQLite
   * doesn't have JSONB operators. Two round-trips inside the tx.
   */
  async failJob(
    id: number,
    lockToken: string,
    errorText: string,
    newStatus: 'delayed' | 'failed' | 'dead',
    backoffMs?: number,
  ): Promise<MinionJob | null> {
    return this.engine.tx(async (tx) => {
      const now = this.engine.now();

      // Read current stacktrace to append to.
      const current = await tx.one<{ stacktrace: string }>(
        `SELECT stacktrace FROM minion_jobs WHERE id = ? AND status = 'active' AND lock_token = ?`,
        [id, lockToken],
      );
      if (!current) return null;

      const prevStack = (() => {
        try {
          const parsed = JSON.parse(current.stacktrace);
          return Array.isArray(parsed) ? (parsed as string[]) : [];
        } catch {
          return [];
        }
      })();
      const nextStack = [...prevStack, errorText];

      const delayUntil = newStatus === 'delayed' ? now + (backoffMs ?? 0) : null;
      const finishedAt = newStatus === 'failed' || newStatus === 'dead' ? now : null;

      const rows = await tx.all<Record<string, unknown>>(
        `UPDATE minion_jobs SET
          status = ?,
          error_text = ?,
          attempts_made = attempts_made + 1,
          stacktrace = ?,
          delay_until = ?,
          finished_at = ?,
          lock_token = NULL,
          lock_until = NULL,
          updated_at = ?
         WHERE id = ? AND status = 'active' AND lock_token = ?
         RETURNING *`,
        [
          newStatus,
          errorText,
          JSON.stringify(nextStack),
          delayUntil,
          finishedAt,
          now,
          id,
          lockToken,
        ],
      );
      if (rows.length === 0) return null;

      const failed = rowToMinionJob(rows[0]);
      const terminal = newStatus === 'failed' || newStatus === 'dead';

      if (terminal && failed.parent_job_id) {
        const childDone: ChildDoneMessage = {
          type: 'child_done',
          child_id: failed.id,
          job_name: failed.name,
          result: null,
          outcome: newStatus === 'dead' ? 'dead' : 'failed',
          error: errorText,
        };
        await this.postChildDone(tx, failed.parent_job_id, childDone);

        if (failed.on_child_fail === 'fail_parent') {
          await tx.exec(
            `UPDATE minion_jobs SET status = 'failed',
              error_text = ?, finished_at = ?, updated_at = ?
             WHERE id = ? AND status = 'waiting-children'`,
            [
              `child job ${failed.id} failed: ${errorText}`,
              now,
              now,
              failed.parent_job_id,
            ],
          );
        } else if (failed.on_child_fail === 'remove_dep') {
          await tx.exec(
            `UPDATE minion_jobs SET parent_job_id = NULL, updated_at = ? WHERE id = ?`,
            [now, failed.id],
          );
          await this.resolveParentInTx(tx, failed.parent_job_id, now);
        } else {
          // 'ignore' / 'continue': aggregator sibling-count model
          await this.resolveParentInTx(tx, failed.parent_job_id, now);
        }
      }

      if (terminal && failed.remove_on_fail) {
        await tx.exec(`DELETE FROM minion_jobs WHERE id = ?`, [failed.id]);
      }

      return failed;
    });
  }

  // ---------------------------------------------------------------------------
  // Parent reconciliation
  // ---------------------------------------------------------------------------

  /**
   * Flip parent to `waiting` once every child is in a terminal state.
   * Terminal set includes 'failed' so a child failing with
   * on_child_fail='continue'/'ignore' doesn't strand the parent.
   */
  async resolveParent(parentId: number): Promise<MinionJob | null> {
    const now = this.engine.now();
    const rows = await this.engine.all<Record<string, unknown>>(
      `UPDATE minion_jobs SET status = 'waiting', updated_at = ?
       WHERE id = ? AND status = 'waiting-children'
         AND NOT EXISTS (
           SELECT 1 FROM minion_jobs
           WHERE parent_job_id = ?
             AND status NOT IN ('completed','failed','dead','cancelled')
         )
       RETURNING *`,
      [now, parentId, parentId],
    );
    return rows.length > 0 ? rowToMinionJob(rows[0]) : null;
  }

  /** Fail the parent when a child fails with fail_parent policy. */
  async failParent(
    parentId: number,
    childId: number,
    errorText: string,
  ): Promise<MinionJob | null> {
    const now = this.engine.now();
    const rows = await this.engine.all<Record<string, unknown>>(
      `UPDATE minion_jobs SET status = 'failed',
        error_text = ?, finished_at = ?, updated_at = ?
       WHERE id = ? AND status = 'waiting-children'
       RETURNING *`,
      [`child job ${childId} failed: ${errorText}`, now, now, parentId],
    );
    return rows.length > 0 ? rowToMinionJob(rows[0]) : null;
  }

  /** Remove a child's dependency on its parent. */
  async removeChildDependency(childId: number): Promise<void> {
    await this.engine.exec(
      `UPDATE minion_jobs SET parent_job_id = NULL, updated_at = ? WHERE id = ?`,
      [this.engine.now(), childId],
    );
  }

  // ---------------------------------------------------------------------------
  // Pause / resume
  // ---------------------------------------------------------------------------

  /** Pause a waiting or active job. For active, clears the lock so the
   *  worker's AbortController fires and the handler stops gracefully. */
  async pauseJob(id: number): Promise<MinionJob | null> {
    const now = this.engine.now();
    const rows = await this.engine.all<Record<string, unknown>>(
      `UPDATE minion_jobs SET status = 'paused',
        lock_token = NULL, lock_until = NULL, updated_at = ?
       WHERE id = ? AND status IN ('waiting','active','delayed')
       RETURNING *`,
      [now, id],
    );
    return rows.length > 0 ? rowToMinionJob(rows[0]) : null;
  }

  /** Resume a paused job back to waiting. */
  async resumeJob(id: number): Promise<MinionJob | null> {
    const now = this.engine.now();
    const rows = await this.engine.all<Record<string, unknown>>(
      `UPDATE minion_jobs SET status = 'waiting',
        lock_token = NULL, lock_until = NULL, updated_at = ?
       WHERE id = ? AND status = 'paused'
       RETURNING *`,
      [now, id],
    );
    return rows.length > 0 ? rowToMinionJob(rows[0]) : null;
  }

  // ---------------------------------------------------------------------------
  // Inbox / messaging
  // ---------------------------------------------------------------------------

  /** Send a message to a job's inbox. Sender must be the parent job or 'admin'. */
  async sendMessage(
    jobId: number,
    payload: unknown,
    sender: string,
  ): Promise<InboxMessage | null> {
    const job = await this.getJob(jobId);
    if (!job) return null;
    if (['completed', 'dead', 'cancelled', 'failed'].includes(job.status)) return null;
    if (sender !== 'admin' && sender !== String(job.parent_job_id)) return null;

    const now = this.engine.now();
    const rows = await this.engine.all<Record<string, unknown>>(
      `INSERT INTO minion_inbox (job_id, sender, payload, sent_at)
       VALUES (?, ?, ?, ?)
       RETURNING *`,
      [jobId, sender, JSON.stringify(payload), now],
    );
    return rows.length > 0 ? rowToInboxMessage(rows[0]) : null;
  }

  /** Read unread inbox messages for a job. Token-fenced. Marks messages as read. */
  async readInbox(jobId: number, lockToken: string): Promise<InboxMessage[]> {
    const lockCheck = await this.engine.one<{ id: number }>(
      `SELECT id FROM minion_jobs WHERE id = ? AND lock_token = ? AND status = 'active'`,
      [jobId, lockToken],
    );
    if (!lockCheck) return [];

    const now = this.engine.now();
    const rows = await this.engine.all<Record<string, unknown>>(
      `UPDATE minion_inbox SET read_at = ?
       WHERE job_id = ? AND read_at IS NULL
       RETURNING *`,
      [now, jobId],
    );
    return rows.map(rowToInboxMessage);
  }

  /**
   * Read child_done messages from a parent's inbox. Token-fenced. Does
   * NOT mark messages read — callers may poll repeatedly. Use `since`
   * to fetch only newer entries.
   */
  async readChildCompletions(
    parentId: number,
    lockToken: string,
    opts?: { since?: Date },
  ): Promise<ChildDoneMessage[]> {
    const lockCheck = await this.engine.one<{ id: number }>(
      `SELECT id FROM minion_jobs WHERE id = ? AND lock_token = ? AND status = 'active'`,
      [parentId, lockToken],
    );
    if (!lockCheck) return [];

    const params: unknown[] = [parentId];
    let sinceClause = '';
    if (opts?.since) {
      sinceClause = ' AND sent_at > ?';
      params.push(opts.since.getTime());
    }

    // SOMA: `payload->>'type' = 'child_done'` JSON operator rewritten as
    // `json_extract(payload, '$.type') = 'child_done'` (SQLite JSON1).
    const rows = await this.engine.all<{ payload: string }>(
      `SELECT payload FROM minion_inbox
       WHERE job_id = ? AND json_extract(payload, '$.type') = 'child_done'${sinceClause}
       ORDER BY sent_at ASC`,
      params,
    );

    return rows.map((r) => JSON.parse(r.payload) as ChildDoneMessage);
  }

  // ---------------------------------------------------------------------------
  // Replay
  // ---------------------------------------------------------------------------

  /** Replay a completed/failed/dead job with optional data overrides. Creates a new job. */
  async replayJob(
    id: number,
    dataOverrides?: Record<string, unknown>,
  ): Promise<MinionJob | null> {
    const source = await this.getJob(id);
    if (!source) return null;
    if (!['completed', 'failed', 'dead'].includes(source.status)) return null;

    const data = dataOverrides ? { ...source.data, ...dataOverrides } : source.data;

    return this.add(source.name, data, {
      queue: source.queue,
      priority: source.priority,
      max_attempts: source.max_attempts,
      backoff_type: source.backoff_type,
      backoff_delay: source.backoff_delay,
      backoff_jitter: source.backoff_jitter,
    });
  }

  // ---------------------------------------------------------------------------
  // Worker support — ctx.log / ctx.isActive + quiet-hours transitions
  // ---------------------------------------------------------------------------
  //
  // These four helpers exist so MinionWorker can stay engine-agnostic. The
  // SQL equivalents in gbrain's worker go through `engine.executeRaw` with
  // Postgres-specific JSONB + INTERVAL arithmetic; SOMA concentrates the
  // SQLite rewrites here alongside the rest of the state-machine SQL
  // (ADR-012: one coherent implementation, not a sidecar).

  /**
   * Token-fenced liveness probe. Used by `ctx.isActive` inside handlers
   * that want to bail out early if they've been cancelled / re-claimed.
   */
  async isJobActive(id: number, lockToken: string): Promise<boolean> {
    const row = await this.engine.one<{ id: number }>(
      `SELECT id FROM minion_jobs
        WHERE id = ? AND status = 'active' AND lock_token = ?`,
      [id, lockToken],
    );
    return row !== null;
  }

  /**
   * Append a free-form message to the job's `stacktrace` JSON array.
   * Token-fenced. Used by `ctx.log` from handlers for transcript lines
   * that aren't full TranscriptEntry objects.
   *
   * SOMA: gbrain does this in a single Postgres statement via
   * `stacktrace = COALESCE(stacktrace, '[]'::jsonb) || to_jsonb($1::text)`.
   * SQLite has no JSONB append operator, so we read-parse-push-write
   * inside a tx. BEGIN IMMEDIATE serializes the read and write against
   * concurrent log appends.
   */
  async appendLogEntry(id: number, lockToken: string, message: string): Promise<boolean> {
    return this.engine.tx(async (tx) => {
      const current = await tx.one<{ stacktrace: string }>(
        `SELECT stacktrace FROM minion_jobs
          WHERE id = ? AND status = 'active' AND lock_token = ?`,
        [id, lockToken],
      );
      if (!current) return false;

      const prev = (() => {
        try {
          const parsed = JSON.parse(current.stacktrace);
          return Array.isArray(parsed) ? (parsed as string[]) : [];
        } catch {
          return [];
        }
      })();
      prev.push(message);

      const { changes } = await tx.exec(
        `UPDATE minion_jobs SET stacktrace = ?, updated_at = ?
          WHERE id = ? AND status = 'active' AND lock_token = ?`,
        [JSON.stringify(prev), this.engine.now(), id, lockToken],
      );
      return changes > 0;
    });
  }

  /**
   * Quiet-hours defer: a claimed job falls inside its quiet window.
   * Reverse the claim transition back to 'delayed', bumping `delay_until`
   * forward by `delayMs` so the same job doesn't immediately re-claim.
   * Token-fenced — returns false if something else already moved the row.
   *
   * SOMA: gbrain uses `now() + interval '15 minutes'` inline; we compute
   * the millisecond delta in JS and bind it.
   */
  async deferForQuietHours(
    id: number,
    lockToken: string,
    delayMs: number,
  ): Promise<boolean> {
    const now = this.engine.now();
    const { changes } = await this.engine.exec(
      `UPDATE minion_jobs SET
         status = 'delayed',
         lock_token = NULL,
         lock_until = NULL,
         delay_until = ?,
         updated_at = ?
        WHERE id = ? AND status = 'active' AND lock_token = ?`,
      [now + delayMs, now, id, lockToken],
    );
    return changes > 0;
  }

  /**
   * Quiet-hours skip: the job is cancelled outright with
   * `error_text='skipped_quiet_hours'`. Token-fenced lock release first so
   * the following cancelJob descendant walk sees a clean state and the
   * child_done rollup fires. Returns the cancelled job or null if the
   * lock fence failed (another path already flipped the row).
   */
  async skipForQuietHours(id: number, lockToken: string): Promise<MinionJob | null> {
    const now = this.engine.now();
    const { changes } = await this.engine.exec(
      `UPDATE minion_jobs SET
         lock_token = NULL,
         lock_until = NULL,
         error_text = 'skipped_quiet_hours',
         updated_at = ?
        WHERE id = ? AND status = 'active' AND lock_token = ?`,
      [now, id, lockToken],
    );
    if (changes === 0) return null;
    return this.cancelJob(id);
  }

  // ---------------------------------------------------------------------------
  // Attachments
  // ---------------------------------------------------------------------------

  /**
   * Attach a file to a job. Validates size, base64, filename safety, and
   * duplicate filename. Returns the persisted attachment metadata (bytes
   * are not echoed back — use getAttachment to fetch).
   *
   * The DB `UNIQUE (job_id, filename)` constraint is the authoritative
   * duplicate fence; the in-memory pre-check just gives a faster, clearer
   * error before the round-trip.
   *
   * SOMA: `content BLOB` column added in schema (gbrain's original column
   * name kept). better-sqlite3 accepts a Buffer directly and returns one
   * on read; no driver-side encoding required.
   */
  async addAttachment(jobId: number, input: AttachmentInput): Promise<Attachment> {
    const exists = await this.engine.one<{ id: number }>(
      `SELECT id FROM minion_jobs WHERE id = ?`,
      [jobId],
    );
    if (!exists) {
      throw new Error(`job ${jobId} not found`);
    }

    const existingRows = await this.engine.all<{ filename: string }>(
      `SELECT filename FROM minion_attachments WHERE job_id = ?`,
      [jobId],
    );
    const existingFilenames = new Set(existingRows.map((r) => r.filename));

    const result = validateAttachment(input, {
      maxBytes: this.maxAttachmentBytes,
      existingFilenames,
    });
    if (!result.ok) {
      throw new Error(`attachment validation failed: ${result.error}`);
    }
    const { filename, content_type, bytes, size_bytes, sha256 } = result.normalized;

    const rows = await this.engine.all<Record<string, unknown>>(
      `INSERT INTO minion_attachments
         (job_id, filename, content_type, content, size_bytes, sha256)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING id, job_id, filename, content_type, storage_uri, size_bytes, sha256, created_at`,
      [jobId, filename, content_type, bytes, size_bytes, sha256],
    );
    return rowToAttachment(rows[0]);
  }

  /** List attachments for a job (metadata only, no bytes). */
  async listAttachments(jobId: number): Promise<Attachment[]> {
    const rows = await this.engine.all<Record<string, unknown>>(
      `SELECT id, job_id, filename, content_type, storage_uri, size_bytes, sha256, created_at
         FROM minion_attachments
        WHERE job_id = ?
        ORDER BY created_at ASC, id ASC`,
      [jobId],
    );
    return rows.map(rowToAttachment);
  }

  /**
   * Fetch a single attachment with bytes. Returns null if not found.
   * Bytes are returned as a Buffer regardless of how the driver spells
   * the BLOB column on the way out.
   */
  async getAttachment(
    jobId: number,
    filename: string,
  ): Promise<{ meta: Attachment; bytes: Buffer } | null> {
    const row = await this.engine.one<Record<string, unknown>>(
      `SELECT id, job_id, filename, content_type, storage_uri, size_bytes, sha256, created_at, content
         FROM minion_attachments
        WHERE job_id = ? AND filename = ?`,
      [jobId, filename],
    );
    if (!row) return null;

    const meta = rowToAttachment(row);
    const raw = row.content;
    let bytes: Buffer;
    if (raw == null) {
      bytes = Buffer.alloc(0);
    } else if (Buffer.isBuffer(raw)) {
      bytes = raw;
    } else if (raw instanceof Uint8Array) {
      bytes = Buffer.from(raw);
    } else {
      bytes = Buffer.from(raw as ArrayBuffer);
    }
    return { meta, bytes };
  }

  /** Delete an attachment by job + filename. Returns true if a row was removed. */
  async deleteAttachment(jobId: number, filename: string): Promise<boolean> {
    const { changes } = await this.engine.exec(
      `DELETE FROM minion_attachments WHERE job_id = ? AND filename = ?`,
      [jobId, filename],
    );
    return changes > 0;
  }

  // ---------------------------------------------------------------------------
  // Shared internals
  // ---------------------------------------------------------------------------

  /**
   * Insert a `child_done` message into a parent's inbox iff the parent
   * is still non-terminal. Idempotent on duplicate inserts (none —
   * primary key is auto-incremented). Skipping the insert for terminal
   * parents matches gbrain's EXISTS guard semantics.
   */
  private async postChildDone(
    tx: QueueEngine,
    parentId: number,
    msg: ChildDoneMessage,
  ): Promise<void> {
    const now = this.engine.now();
    // SOMA: `INSERT ... SELECT ... WHERE EXISTS (...)` pattern preserved
    // verbatim — SQLite supports this shape fine.
    await tx.exec(
      `INSERT INTO minion_inbox (job_id, sender, payload, sent_at)
       SELECT ?, 'minions', ?, ?
       WHERE EXISTS (
         SELECT 1 FROM minion_jobs
         WHERE id = ? AND status NOT IN ('completed','failed','dead','cancelled')
       )`,
      [parentId, JSON.stringify(msg), now, parentId],
    );
  }

  /**
   * Flip a parent from 'waiting-children' to 'waiting' when every child
   * is in a terminal state. No-op otherwise. Called inline from complete
   * / fail / cancel / timeout paths — keeps parent reconciliation
   * crash-proof (fold-in of resolveParent).
   */
  private async resolveParentInTx(
    tx: QueueEngine,
    parentId: number,
    now: number,
  ): Promise<void> {
    await tx.exec(
      `UPDATE minion_jobs SET status = 'waiting', updated_at = ?
       WHERE id = ? AND status = 'waiting-children'
         AND NOT EXISTS (
           SELECT 1 FROM minion_jobs
           WHERE parent_job_id = ?
             AND status NOT IN ('completed','failed','dead','cancelled')
         )`,
      [now, parentId, parentId],
    );
  }
}
