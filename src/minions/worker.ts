/**
 * MinionWorker — concurrent in-process job worker for SOMA.
 *
 * Ported from gbrain's `src/core/minions/worker.ts` (MIT © Garry Tan).
 *
 * Processes up to `concurrency` jobs simultaneously using a Promise pool.
 * Each job gets its own AbortController, lock-renewal timer, and
 * isolated state.
 *
 * SOMA adaptations from the Postgres original (all annotated `// SOMA:`
 * inline where they occur):
 *   - `BrainEngine` → `QueueEngine`.
 *   - All inline `engine.executeRaw` calls (ctx.log JSONB append, ctx.isActive,
 *     quiet-hours defer/skip UPDATEs) are routed through new MinionQueue
 *     helpers (`appendLogEntry`, `isJobActive`, `deferForQuietHours`,
 *     `skipForQuietHours`). This concentrates SQL rewrites in queue.ts
 *     per ADR-012 (synergy not silos) and keeps the worker engine-agnostic.
 *   - Postgres `now() + interval '15 minutes'` → JS ms math (15 * 60_000).
 *   - `.ts` extensions on relative imports → `.js` per repo moduleResolution:
 *     bundler convention.
 *   - `queue.ensureSchema()` call removed — SOMA's SQLite engine bootstraps
 *     DDL on `openSqliteEngine()` rather than lazily on first use.
 *
 * Usage:
 *   const worker = new MinionWorker(engine);
 *   worker.register('sync', async (ctx) => {
 *     // ...do work...
 *     return { pages_synced: 42 };
 *   });
 *   await worker.start(); // polls until SIGTERM
 */

import { randomUUID } from 'crypto';

import type { QueueEngine } from './engine.js';
import type {
  MinionJob,
  MinionJobContext,
  MinionHandler,
  MinionQueueOpts,
  MinionWorkerOpts,
  TokenUpdate,
  TranscriptEntry,
} from './types.js';
import { UnrecoverableError } from './types.js';
import { MinionQueue } from './queue.js';
import { calculateBackoff } from './backoff.js';
import { evaluateQuietHours, type QuietHoursConfig } from './quiet-hours.js';

/** Re-claim delay after a quiet-hours 'defer' verdict. 15 minutes matches gbrain. */
const QUIET_HOURS_DEFER_MS = 15 * 60 * 1000;

/**
 * Read the `quiet_hours` JSON column off a MinionJob, if present. Older
 * rows (or job inputs that omit the field) return null.
 */
function readQuietHoursConfig(job: MinionJob): QuietHoursConfig | null {
  const cfg = job.quiet_hours;
  if (!cfg || typeof cfg !== 'object') return null;
  return cfg as unknown as QuietHoursConfig;
}

/** Per-job in-flight state (isolated per job, not shared across the worker). */
interface InFlightJob {
  job: MinionJob;
  lockToken: string;
  lockTimer: ReturnType<typeof setInterval>;
  abort: AbortController;
  promise: Promise<void>;
}

export class MinionWorker {
  private queue: MinionQueue;
  private handlers = new Map<string, MinionHandler>();
  private running = false;
  private inFlight = new Map<number, InFlightJob>();
  private workerId = randomUUID();

  /**
   * Fires only on worker process SIGTERM/SIGINT. Handlers that need to
   * run shutdown-specific cleanup (e.g. shell handler's SIGTERM→SIGKILL
   * sequence on its child) subscribe via `ctx.shutdownSignal`. Separated
   * from the per-job abort controller so non-shell handlers don't get
   * cancelled mid-flight on deploy restart — they still get the full 30s
   * cleanup race instead.
   */
  private shutdownAbort = new AbortController();

  private opts: Required<MinionWorkerOpts>;

  constructor(
    private engine: QueueEngine,
    opts?: MinionWorkerOpts & MinionQueueOpts,
  ) {
    this.queue = new MinionQueue(engine, {
      maxSpawnDepth: opts?.maxSpawnDepth,
      maxAttachmentBytes: opts?.maxAttachmentBytes,
    });
    this.opts = {
      queue: opts?.queue ?? 'default',
      concurrency: opts?.concurrency ?? 1,
      lockDuration: opts?.lockDuration ?? 30_000,
      stalledInterval: opts?.stalledInterval ?? 30_000,
      maxStalledCount: opts?.maxStalledCount ?? 1,
      pollInterval: opts?.pollInterval ?? 5_000,
    };
  }

  /** Register a handler for a job type. */
  register(name: string, handler: MinionHandler): void {
    this.handlers.set(name, handler);
  }

  /** Get registered handler names (used by the claim query's name filter). */
  get registeredNames(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Run one iteration of the worker loop: promote delayed → claim one
   * job (if under concurrency) → launch it. Exposed so tests can drive
   * the worker deterministically without the polling loop.
   *
   * Returns the claimed job (if any) so tests can await its completion.
   */
  async tick(): Promise<MinionJob | null> {
    try {
      await this.queue.promoteDelayed();
    } catch (e) {
      console.error('Promotion error:', e instanceof Error ? e.message : String(e));
    }

    if (this.inFlight.size >= this.opts.concurrency) return null;

    const lockToken = `${this.workerId}:${Date.now()}`;
    const job = await this.queue.claim(
      lockToken,
      this.opts.lockDuration,
      this.opts.queue,
      this.registeredNames,
    );
    if (!job) return null;

    const quietCfg = readQuietHoursConfig(job);
    const verdict = evaluateQuietHours(quietCfg);
    if (verdict !== 'allow') {
      await this.handleQuietHoursDefer(job, lockToken, verdict);
      return null;
    }

    this.launchJob(job, lockToken);
    return job;
  }

  /**
   * Wait for all currently in-flight jobs to settle. Used by tests and
   * by the shutdown path. Does not stop the loop — call `stop()` first.
   */
  async drain(timeoutMs = 30_000): Promise<void> {
    if (this.inFlight.size === 0) return;
    const pending = Array.from(this.inFlight.values()).map((f) => f.promise);
    await Promise.race([
      Promise.allSettled(pending),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  /** Start the worker loop. Blocks until `stop()` or SIGTERM/SIGINT. */
  async start(): Promise<void> {
    if (this.handlers.size === 0) {
      throw new Error(
        'No handlers registered. Call worker.register(name, handler) before start().',
      );
    }

    this.running = true;

    // Graceful shutdown. Fires shutdownAbort so handlers subscribed to
    // `ctx.shutdownSignal` can run their own cleanup BEFORE the 30s race
    // in the finally block expires.
    const shutdown = () => {
      console.log('Minion worker shutting down...');
      this.running = false;
      if (!this.shutdownAbort.signal.aborted) {
        this.shutdownAbort.abort(new Error('shutdown'));
      }
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    // Stall + timeout detection on interval. Order matters: handleStalled
    // FIRST so a stalled job (lock_until expired) gets requeued before
    // handleTimeouts' `lock_until > now` guard would skip it.
    const stalledTimer = setInterval(async () => {
      try {
        const { requeued, dead } = await this.queue.handleStalled();
        if (requeued.length > 0) {
          console.log(`Stall detector: requeued ${requeued.length} jobs`);
        }
        if (dead.length > 0) {
          console.log(`Stall detector: dead-lettered ${dead.length} jobs`);
        }
      } catch (e) {
        console.error('Stall detection error:', e instanceof Error ? e.message : String(e));
      }
      try {
        const timedOut = await this.queue.handleTimeouts();
        if (timedOut.length > 0) {
          console.log(`Timeout detector: dead-lettered ${timedOut.length} jobs`);
        }
      } catch (e) {
        console.error('Timeout detection error:', e instanceof Error ? e.message : String(e));
      }
    }, this.opts.stalledInterval);

    try {
      while (this.running) {
        const claimed = await this.tick();
        if (claimed) {
          continue;
        }
        const waitMs = this.inFlight.size === 0 ? this.opts.pollInterval : 100;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    } finally {
      clearInterval(stalledTimer);
      process.removeListener('SIGTERM', shutdown);
      process.removeListener('SIGINT', shutdown);

      if (this.inFlight.size > 0) {
        console.log(
          `Waiting for ${this.inFlight.size} in-flight job(s) to finish (30s timeout)...`,
        );
        await this.drain(30_000);
      }

      console.log('Minion worker stopped.');
    }
  }

  /** Stop the worker gracefully. Loop exits after the current tick. */
  stop(): void {
    this.running = false;
  }

  /**
   * Handle a quiet-hours verdict on a freshly claimed job.
   *
   * 'defer' → status reverts to 'delayed'; `delay_until` bumped forward
   *   by 15 minutes so the same job doesn't immediately re-claim.
   * 'skip'  → job is cancelled outright; `error_text='skipped_quiet_hours'`.
   */
  private async handleQuietHoursDefer(
    job: MinionJob,
    lockToken: string,
    verdict: 'skip' | 'defer',
  ): Promise<void> {
    try {
      if (verdict === 'skip') {
        await this.queue.skipForQuietHours(job.id, lockToken);
        console.log(`Quiet-hours skip: ${job.name} (id=${job.id})`);
      } else {
        await this.queue.deferForQuietHours(job.id, lockToken, QUIET_HOURS_DEFER_MS);
        console.log(`Quiet-hours defer: ${job.name} (id=${job.id}) → retry after 15m`);
      }
    } catch (e) {
      console.error(
        `handleQuietHoursDefer error for job ${job.id}:`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  /** Launch a job as an independent in-flight promise. */
  private launchJob(job: MinionJob, lockToken: string): void {
    const abort = new AbortController();

    // Per-job lock renewal (not shared across jobs).
    const lockTimer = setInterval(async () => {
      const renewed = await this.queue.renewLock(job.id, lockToken, this.opts.lockDuration);
      if (!renewed) {
        console.warn(`Lock lost for job ${job.id}, aborting execution`);
        clearInterval(lockTimer);
        abort.abort(new Error('lock-lost'));
      }
    }, this.opts.lockDuration / 2);

    // Per-job wall-clock timeout safety net. Cooperative: fires abort()
    // so the handler's signal flips. Handlers ignoring AbortSignal can't
    // be force-killed from JS; the DB-side handleTimeouts is the
    // authoritative status flip.
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    if (job.timeout_ms != null) {
      timeoutTimer = setTimeout(() => {
        if (!abort.signal.aborted) {
          console.warn(
            `Job ${job.id} (${job.name}) hit per-job timeout (${job.timeout_ms}ms), aborting`,
          );
          abort.abort(new Error('timeout'));
        }
      }, job.timeout_ms);
    }

    const promise = this.executeJob(job, lockToken, abort, lockTimer).finally(() => {
      clearInterval(lockTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      this.inFlight.delete(job.id);
    });

    this.inFlight.set(job.id, { job, lockToken, lockTimer, abort, promise });
  }

  private async executeJob(
    job: MinionJob,
    lockToken: string,
    abort: AbortController,
    lockTimer: ReturnType<typeof setInterval>,
  ): Promise<void> {
    const handler = this.handlers.get(job.name);
    if (!handler) {
      await this.queue.failJob(job.id, lockToken, `No handler for job type '${job.name}'`, 'dead');
      return;
    }

    // Per-job context. Most handlers only care about `signal` (timeout /
    // cancel / lock-loss). `shutdownSignal` is separate: fires only on
    // worker SIGTERM/SIGINT. Handlers needing pre-exit cleanup subscribe
    // to shutdownSignal.
    const context: MinionJobContext = {
      id: job.id,
      name: job.name,
      data: job.data,
      attempts_made: job.attempts_made,
      signal: abort.signal,
      shutdownSignal: this.shutdownAbort.signal,
      updateProgress: async (progress: unknown) => {
        await this.queue.updateProgress(job.id, lockToken, progress);
      },
      updateTokens: async (tokens: TokenUpdate) => {
        await this.queue.updateTokens(job.id, lockToken, tokens);
      },
      log: async (message: string | TranscriptEntry) => {
        const value = typeof message === 'string' ? message : JSON.stringify(message);
        await this.queue.appendLogEntry(job.id, lockToken, value);
      },
      isActive: async () => this.queue.isJobActive(job.id, lockToken),
      readInbox: async () => this.queue.readInbox(job.id, lockToken),
    };

    try {
      const result = await handler(context);

      clearInterval(lockTimer);

      const completed = await this.queue.completeJob(
        job.id,
        lockToken,
        result != null
          ? typeof result === 'object'
            ? (result as Record<string, unknown>)
            : { value: result }
          : undefined,
      );

      if (!completed) {
        console.warn(
          `Job ${job.id} completion dropped (lock token mismatch, job was reclaimed)`,
        );
        return;
      }
      // resolveParent is folded into queue.completeJob (same transaction
      // as status flip + token rollup + child_done), so a process crash
      // between complete and parent resolve is impossible.
    } catch (err) {
      clearInterval(lockTimer);

      // Derive errorText from the abort reason when available — otherwise
      // fall back to the thrown error. failJob is idempotent (matches on
      // status='active' + lock_token), so if another path already flipped
      // the row our call no-ops cleanly.
      let errorText: string;
      if (abort.signal.aborted) {
        const reason =
          abort.signal.reason instanceof Error
            ? abort.signal.reason.message
            : String(abort.signal.reason || 'aborted');
        errorText = `aborted: ${reason}`;
      } else {
        errorText = err instanceof Error ? err.message : String(err);
      }

      const isUnrecoverable = err instanceof UnrecoverableError;
      const attemptsExhausted = job.attempts_made + 1 >= job.max_attempts;

      const newStatus: 'delayed' | 'failed' | 'dead' =
        isUnrecoverable || attemptsExhausted ? 'dead' : 'delayed';

      const backoffMs =
        newStatus === 'delayed'
          ? calculateBackoff({
              backoff_type: job.backoff_type,
              backoff_delay: job.backoff_delay,
              backoff_jitter: job.backoff_jitter,
              attempts_made: job.attempts_made + 1,
            })
          : 0;

      const failed = await this.queue.failJob(job.id, lockToken, errorText, newStatus, backoffMs);
      if (!failed) {
        console.warn(`Job ${job.id} failure dropped (lock token mismatch)`);
        return;
      }

      if (newStatus === 'delayed') {
        console.log(
          `Job ${job.id} (${job.name}) failed, retrying in ${Math.round(backoffMs)}ms (attempt ${job.attempts_made + 1}/${job.max_attempts})`,
        );
      } else {
        console.log(`Job ${job.id} (${job.name}) permanently failed: ${errorText}`);
      }
    }
  }
}
