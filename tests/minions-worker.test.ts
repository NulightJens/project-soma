/**
 * MinionWorker tests — handler registration, claim→run→complete happy path,
 * failure + retry, UnrecoverableError, SIGKILL rescue smoke.
 *
 * The worker's main loop is not exercised (it'd spin on real setInterval);
 * tests drive it via `worker.tick()` + `worker.drain()` with an injected
 * clock so state-machine transitions are deterministic.
 */

import { describe, expect, it } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { unlinkSync, existsSync } from 'fs';

import {
  MinionQueue,
  MinionWorker,
  UnrecoverableError,
  openSqliteEngine,
} from '../src/minions/index.js';
import type { QueueEngine } from '../src/minions/index.js';

function tmpPath(): string {
  return join(tmpdir(), `soma-worker-test-${randomUUID()}.db`);
}

function cleanup(path: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = path + suffix;
    if (existsSync(f)) {
      try {
        unlinkSync(f);
      } catch {
        // ignore
      }
    }
  }
}

/** Mutable clock so tests can advance time past lock_until / delay_until. */
function makeClock(start = 1_700_000_000_000): { now: () => number; advance: (ms: number) => void; set: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (ms: number) => {
      t = ms;
    },
  };
}

async function withRig<T>(
  fn: (ctx: {
    engine: QueueEngine;
    queue: MinionQueue;
    worker: MinionWorker;
    clock: ReturnType<typeof makeClock>;
  }) => Promise<T>,
  workerOpts: Parameters<typeof makeWorker>[1] = {},
): Promise<T> {
  const path = tmpPath();
  const clock = makeClock();
  const engine = openSqliteEngine({ path, clock: clock.now });
  const queue = new MinionQueue(engine);
  const worker = makeWorker(engine, workerOpts);
  try {
    return await fn({ engine, queue, worker, clock });
  } finally {
    worker.stop();
    await worker.drain(1_000);
    await engine.close();
    cleanup(path);
  }
}

function makeWorker(
  engine: QueueEngine,
  opts: { lockDuration?: number; pollInterval?: number; concurrency?: number } = {},
): MinionWorker {
  return new MinionWorker(engine, {
    lockDuration: opts.lockDuration ?? 30_000,
    pollInterval: opts.pollInterval ?? 50,
    concurrency: opts.concurrency ?? 1,
    stalledInterval: 60_000,
  });
}

describe('MinionWorker — handler registration', () => {
  it('throws from start() when no handlers are registered', async () => {
    const path = tmpPath();
    const engine = openSqliteEngine({ path });
    const worker = new MinionWorker(engine);
    try {
      await expect(worker.start()).rejects.toThrow(/No handlers registered/);
    } finally {
      await engine.close();
      cleanup(path);
    }
  });

  it('register() makes handler names visible via registeredNames', async () => {
    await withRig(async ({ worker }) => {
      worker.register('sync', async () => ({ ok: true }));
      worker.register('embed', async () => ({ ok: true }));
      expect(worker.registeredNames.sort()).toEqual(['embed', 'sync']);
    });
  });

  it('claim filter ignores jobs whose name has no registered handler', async () => {
    await withRig(async ({ queue, worker }) => {
      worker.register('known', async () => ({ ok: true }));
      await queue.add('unknown');
      const claimed = await worker.tick();
      expect(claimed).toBeNull();
      // Registering the handler later lets it run on the next tick.
      worker.register('unknown', async () => ({ late: true }));
      const second = await worker.tick();
      expect(second?.name).toBe('unknown');
      await worker.drain(1_000);
    });
  });
});

describe('MinionWorker — claim → run → complete', () => {
  it('runs the handler, persists the result, and marks completed', async () => {
    await withRig(async ({ queue, worker }) => {
      let sawCtx: { id: number; name: string; data: Record<string, unknown> } | null = null;
      worker.register('sync', async (ctx) => {
        sawCtx = { id: ctx.id, name: ctx.name, data: ctx.data };
        return { pages: 42 };
      });

      const job = await queue.add('sync', { full: true });
      const claimed = await worker.tick();
      expect(claimed?.id).toBe(job.id);

      await worker.drain(1_000);

      expect(sawCtx).toEqual({ id: job.id, name: 'sync', data: { full: true } });

      const finished = await queue.getJob(job.id);
      expect(finished?.status).toBe('completed');
      expect(finished?.result).toEqual({ pages: 42 });
      expect(finished?.finished_at).not.toBeNull();
      expect(finished?.lock_token).toBeNull();
    });
  });

  it('wraps a primitive handler return in { value } on the result column', async () => {
    await withRig(async ({ queue, worker }) => {
      worker.register('count', async () => 7);
      const job = await queue.add('count');
      await worker.tick();
      await worker.drain(1_000);

      const finished = await queue.getJob(job.id);
      expect(finished?.result).toEqual({ value: 7 });
    });
  });

  it('ctx.updateProgress / ctx.updateTokens / ctx.log persist through the token fence', async () => {
    await withRig(async ({ queue, worker }) => {
      worker.register('instrumented', async (ctx) => {
        await ctx.updateProgress({ step: 1, total: 3 });
        await ctx.updateTokens({ input: 10, output: 20, cache_read: 5 });
        await ctx.log('hello');
        await ctx.log({ type: 'log', message: 'structured', ts: '2026-04-23T00:00:00Z' });
        expect(await ctx.isActive()).toBe(true);
        return { ok: true };
      });

      const job = await queue.add('instrumented');
      await worker.tick();
      await worker.drain(1_000);

      const finished = await queue.getJob(job.id);
      expect(finished?.status).toBe('completed');
      expect(finished?.tokens_input).toBe(10);
      expect(finished?.tokens_output).toBe(20);
      expect(finished?.tokens_cache_read).toBe(5);
      // progress is cleared on completion? No — queue.completeJob leaves it.
      expect(finished?.progress).toEqual({ step: 1, total: 3 });
      // stacktrace captured both entries.
      expect(finished?.stacktrace.length).toBe(2);
      expect(finished?.stacktrace[0]).toBe('hello');
      const structured = JSON.parse(finished?.stacktrace[1] ?? '{}');
      expect(structured.message).toBe('structured');
    });
  });

  it('records empty inbox via ctx.readInbox for a job with no messages', async () => {
    await withRig(async ({ queue, worker }) => {
      worker.register('check-inbox', async (ctx) => {
        const msgs = await ctx.readInbox();
        return { count: msgs.length };
      });
      const job = await queue.add('check-inbox');
      await worker.tick();
      await worker.drain(1_000);

      const finished = await queue.getJob(job.id);
      expect(finished?.result).toEqual({ count: 0 });
    });
  });
});

describe('MinionWorker — failure + retry', () => {
  it('pushes the job to delayed with a backoff on a retryable failure', async () => {
    await withRig(async ({ queue, worker, clock }) => {
      worker.register('flaky', async () => {
        throw new Error('boom');
      });
      const job = await queue.add('flaky', {}, {
        max_attempts: 3,
        backoff_type: 'fixed',
        backoff_delay: 1_000,
        backoff_jitter: 0,
      });

      await worker.tick();
      await worker.drain(1_000);

      const after = await queue.getJob(job.id);
      expect(after?.status).toBe('delayed');
      expect(after?.attempts_made).toBe(1);
      expect(after?.error_text).toBe('boom');
      expect(after?.stacktrace).toEqual(['boom']);
      expect(after?.delay_until).not.toBeNull();
      expect(after?.delay_until).toBeGreaterThanOrEqual(clock.now() + 1_000);
    });
  });

  it('dead-letters once attempts_made would reach max_attempts', async () => {
    await withRig(async ({ queue, worker, clock }) => {
      worker.register('flaky', async () => {
        throw new Error('boom');
      });
      const job = await queue.add('flaky', {}, {
        max_attempts: 2,
        backoff_type: 'fixed',
        backoff_delay: 1_000,
        backoff_jitter: 0,
      });

      // Attempt 1 → delayed.
      await worker.tick();
      await worker.drain(1_000);
      expect((await queue.getJob(job.id))?.status).toBe('delayed');

      // Advance past delay_until and re-run: second failure goes to 'dead'.
      clock.advance(5_000);
      await worker.tick();
      await worker.drain(1_000);

      const final = await queue.getJob(job.id);
      expect(final?.status).toBe('dead');
      expect(final?.attempts_made).toBe(2);
      expect(final?.stacktrace.length).toBe(2);
    });
  });

  it('UnrecoverableError skips retry and goes straight to dead', async () => {
    await withRig(async ({ queue, worker }) => {
      worker.register('fatal', async () => {
        throw new UnrecoverableError('schema drift');
      });
      const job = await queue.add('fatal', {}, { max_attempts: 5 });

      await worker.tick();
      await worker.drain(1_000);

      const after = await queue.getJob(job.id);
      expect(after?.status).toBe('dead');
      expect(after?.attempts_made).toBe(1);
      expect(after?.error_text).toBe('schema drift');
    });
  });
});

describe('MinionWorker — SIGKILL rescue smoke', () => {
  it('stalled-lock recovery: worker A claims, dies mid-run, worker B completes', async () => {
    const path = tmpPath();
    const clock = makeClock();
    const engine = openSqliteEngine({ path, clock: clock.now });
    const queue = new MinionQueue(engine);

    // Worker A with a short lockDuration so the test doesn't have to
    // advance the clock days. 1 second lock; stalled sweep manual.
    const workerA = new MinionWorker(engine, {
      lockDuration: 1_000,
      pollInterval: 50,
      stalledInterval: 60_000,
    });
    const workerB = new MinionWorker(engine, {
      lockDuration: 30_000,
      pollInterval: 50,
      stalledInterval: 60_000,
    });

    try {
      // Worker A's handler: deliberately never resolves so we can simulate
      // the process dying mid-run without racing real timers.
      let aClaimed: number | null = null;
      workerA.register('rescue', async (ctx) => {
        aClaimed = ctx.id;
        // Never resolves.
        await new Promise(() => {});
        return { ok: true };
      });

      workerB.register('rescue', async () => ({ rescued: true }));

      const job = await queue.add('rescue');

      const claimedByA = await workerA.tick();
      expect(claimedByA?.id).toBe(job.id);
      expect(aClaimed).toBe(job.id);
      expect((await queue.getJob(job.id))?.status).toBe('active');

      // Advance past lock_until. Worker A is "dead" — no lock renewal is
      // going to fire because we don't let the test runtime tick its real
      // interval timers. Invoke handleStalled directly as the rescue path.
      clock.advance(2_000);
      const { requeued, dead } = await queue.handleStalled();
      expect(requeued.map((r) => r.id)).toContain(job.id);
      expect(dead).toEqual([]);

      const afterStall = await queue.getJob(job.id);
      expect(afterStall?.status).toBe('waiting');
      expect(afterStall?.stalled_counter).toBe(1);
      expect(afterStall?.lock_token).toBeNull();

      // Worker B picks it up and completes cleanly.
      const claimedByB = await workerB.tick();
      expect(claimedByB?.id).toBe(job.id);
      await workerB.drain(1_000);

      const finished = await queue.getJob(job.id);
      expect(finished?.status).toBe('completed');
      expect(finished?.result).toEqual({ rescued: true });
    } finally {
      workerA.stop();
      workerB.stop();
      // Don't drain workerA — its handler never resolves by design.
      await workerB.drain(1_000);
      await engine.close();
      cleanup(path);
    }
  });
});
