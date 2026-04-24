/**
 * MinionQueue state-machine tests.
 *
 * Floor coverage: every terminal transition, parent-child reconciliation,
 * stall rescue, idempotency dedup, priority claim, pause/resume.
 * Attachments / protected-names covered in a later pass (see queue.ts
 * port-status TODOs).
 */

import { describe, expect, it } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { unlinkSync, existsSync } from 'fs';

import { MinionQueue, openSqliteEngine } from '../src/minions/index.js';
import type { QueueEngine } from '../src/minions/index.js';

function tmpPath(): string {
  return join(tmpdir(), `soma-queue-test-${randomUUID()}.db`);
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

async function withQueue<T>(fn: (q: MinionQueue, e: QueueEngine) => Promise<T>): Promise<T> {
  const path = tmpPath();
  const engine = openSqliteEngine({ path });
  const queue = new MinionQueue(engine);
  try {
    return await fn(queue, engine);
  } finally {
    await engine.close();
    cleanup(path);
  }
}

describe('MinionQueue — add + getJob', () => {
  it('inserts and retrieves a job', async () => {
    await withQueue(async (q) => {
      const job = await q.add('sync', { full: true });
      expect(job.name).toBe('sync');
      expect(job.status).toBe('waiting');
      expect(job.data).toEqual({ full: true });

      const got = await q.getJob(job.id);
      expect(got?.id).toBe(job.id);
      expect(got?.data).toEqual({ full: true });
    });
  });

  it('rejects empty names', async () => {
    await withQueue(async (q) => {
      await expect(q.add('', {})).rejects.toThrow(/empty/i);
      await expect(q.add('   ', {})).rejects.toThrow(/empty/i);
    });
  });

  it('deduplicates on idempotency_key', async () => {
    await withQueue(async (q) => {
      const j1 = await q.add('sync', { v: 1 }, { idempotency_key: 'daily-sync' });
      const j2 = await q.add('sync', { v: 2 }, { idempotency_key: 'daily-sync' });
      expect(j2.id).toBe(j1.id);
      expect(j2.data).toEqual({ v: 1 }); // first wins
    });
  });

  it('creates delayed jobs with delay_until set', async () => {
    await withQueue(async (q, e) => {
      const before = e.now();
      const job = await q.add('later', {}, { delay: 1000 });
      expect(job.status).toBe('delayed');
      expect(job.delay_until).not.toBeNull();
      expect(job.delay_until!).toBeGreaterThanOrEqual(before + 1000);
    });
  });
});

describe('MinionQueue — parent/child', () => {
  it('flips parent to waiting-children on first child insert', async () => {
    await withQueue(async (q) => {
      const parent = await q.add('parent', {});
      expect(parent.status).toBe('waiting');

      await q.add('child', {}, { parent_job_id: parent.id });
      const updated = await q.getJob(parent.id);
      expect(updated?.status).toBe('waiting-children');
    });
  });

  it('enforces max_children cap', async () => {
    await withQueue(async (q) => {
      const parent = await q.add('parent', {}, { max_children: 2 });
      await q.add('c1', {}, { parent_job_id: parent.id });
      await q.add('c2', {}, { parent_job_id: parent.id });
      await expect(
        q.add('c3', {}, { parent_job_id: parent.id }),
      ).rejects.toThrow(/max_children/);
    });
  });

  it('enforces maxSpawnDepth', async () => {
    await withQueue(async (q) => {
      // Default maxSpawnDepth = 5; depth 5 is allowed (5 > 5 is false),
      // depth 6 is the first rejection.
      const p = await q.add('p', {});               // depth 0
      const c = await q.add('c', {}, { parent_job_id: p.id });   // depth 1
      const gc = await q.add('gc', {}, { parent_job_id: c.id }); // depth 2
      const g3 = await q.add('g3', {}, { parent_job_id: gc.id }); // depth 3
      const g4 = await q.add('g4', {}, { parent_job_id: g3.id }); // depth 4
      const g5 = await q.add('g5', {}, { parent_job_id: g4.id }); // depth 5 — allowed
      await expect(
        q.add('g6', {}, { parent_job_id: g5.id }),                // depth 6 — rejected
      ).rejects.toThrow(/spawn depth/);
    });
  });
});

describe('MinionQueue — claim', () => {
  it('returns null when nothing is waiting', async () => {
    await withQueue(async (q) => {
      const job = await q.claim('worker-1', 30000, 'default', ['sync']);
      expect(job).toBeNull();
    });
  });

  it('claims the highest-priority (lowest int) first', async () => {
    await withQueue(async (q) => {
      await q.add('sync', { a: 1 }, { priority: 10 });
      const hi = await q.add('sync', { a: 2 }, { priority: 1 });
      await q.add('sync', { a: 3 }, { priority: 5 });

      const claimed = await q.claim('worker-1', 30000, 'default', ['sync']);
      expect(claimed?.id).toBe(hi.id);
      expect(claimed?.status).toBe('active');
      expect(claimed?.lock_token).toBe('worker-1');
    });
  });

  it('filters by registered names', async () => {
    await withQueue(async (q) => {
      await q.add('sync', {});
      const upload = await q.add('upload', {});
      const claimed = await q.claim('worker-1', 30000, 'default', ['upload']);
      expect(claimed?.id).toBe(upload.id);
    });
  });

  it('sets timeout_at when timeout_ms is set', async () => {
    await withQueue(async (q, e) => {
      await q.add('deadline', {}, { timeout_ms: 5000 });
      const before = e.now();
      const claimed = await q.claim('w1', 30000, 'default', ['deadline']);
      expect(claimed?.timeout_at).not.toBeNull();
      expect(claimed!.timeout_at!).toBeGreaterThanOrEqual(before + 5000);
    });
  });
});

describe('MinionQueue — complete / fail', () => {
  it('completeJob transitions active → completed with result', async () => {
    await withQueue(async (q) => {
      await q.add('sync', {});
      const claimed = await q.claim('w1', 30000, 'default', ['sync']);
      const completed = await q.completeJob(claimed!.id, 'w1', { ok: true });
      expect(completed?.status).toBe('completed');
      expect(completed?.result).toEqual({ ok: true });
      expect(completed?.finished_at).not.toBeNull();
    });
  });

  it('completeJob rejects on token mismatch', async () => {
    await withQueue(async (q) => {
      await q.add('sync', {});
      const claimed = await q.claim('w1', 30000, 'default', ['sync']);
      const attempt = await q.completeJob(claimed!.id, 'different-token');
      expect(attempt).toBeNull();
    });
  });

  it('failJob(delayed) sets delay_until for retry', async () => {
    await withQueue(async (q, e) => {
      await q.add('flaky', {});
      const claimed = await q.claim('w1', 30000, 'default', ['flaky']);
      const before = e.now();
      const failed = await q.failJob(claimed!.id, 'w1', 'boom', 'delayed', 2000);
      expect(failed?.status).toBe('delayed');
      expect(failed?.attempts_made).toBe(1);
      expect(failed?.delay_until).not.toBeNull();
      expect(failed!.delay_until!).toBeGreaterThanOrEqual(before + 2000);
      expect(failed?.stacktrace).toEqual(['boom']);
    });
  });

  it('failJob(dead) finishes the job terminally', async () => {
    await withQueue(async (q) => {
      await q.add('cursed', {});
      const claimed = await q.claim('w1', 30000, 'default', ['cursed']);
      const failed = await q.failJob(claimed!.id, 'w1', 'fatal', 'dead');
      expect(failed?.status).toBe('dead');
      expect(failed?.finished_at).not.toBeNull();
    });
  });

  it('resolves parent once last child completes', async () => {
    await withQueue(async (q) => {
      const p = await q.add('parent', {});
      const c1 = await q.add('c', {}, { parent_job_id: p.id });
      const c2 = await q.add('c', {}, { parent_job_id: p.id });

      let claimed = await q.claim('w1', 30000, 'default', ['c']);
      await q.completeJob(claimed!.id, 'w1');
      expect((await q.getJob(p.id))?.status).toBe('waiting-children');

      claimed = await q.claim('w1', 30000, 'default', ['c']);
      await q.completeJob(claimed!.id, 'w1');
      expect((await q.getJob(p.id))?.status).toBe('waiting');
      expect(c1).toBeDefined();
      expect(c2).toBeDefined();
    });
  });

  it('posts child_done on completion for aggregator parents', async () => {
    await withQueue(async (q) => {
      const p = await q.add('parent', {});
      await q.add('c', {}, { parent_job_id: p.id });
      const claimed = await q.claim('w1', 30000, 'default', ['c']);
      await q.completeJob(claimed!.id, 'w1', { ok: true });

      // Claim the parent now that it's waiting
      const parentClaim = await q.claim('pw', 30000, 'default', ['parent']);
      expect(parentClaim).not.toBeNull();
      const completions = await q.readChildCompletions(p.id, 'pw');
      expect(completions).toHaveLength(1);
      expect(completions[0].outcome).toBe('complete');
      expect(completions[0].result).toEqual({ ok: true });
    });
  });

  it('fail_parent policy fails parent on terminal child failure', async () => {
    await withQueue(async (q) => {
      const p = await q.add('parent', {});
      await q.add('c', {}, { parent_job_id: p.id, on_child_fail: 'fail_parent' });

      const claimed = await q.claim('w1', 30000, 'default', ['c']);
      await q.failJob(claimed!.id, 'w1', 'bad', 'dead');

      const parent = await q.getJob(p.id);
      expect(parent?.status).toBe('failed');
      expect(parent?.error_text).toContain('failed');
    });
  });

  it('remove_dep policy removes parent link and resolves parent', async () => {
    await withQueue(async (q) => {
      const p = await q.add('parent', {});
      const c1 = await q.add('c', {}, {
        parent_job_id: p.id,
        on_child_fail: 'remove_dep',
      });
      await q.add('c', {}, { parent_job_id: p.id });

      // Fail c1 with remove_dep
      let claimed = await q.claim('w1', 30000, 'default', ['c']);
      await q.failJob(claimed!.id, 'w1', 'bad', 'dead');
      const freedChild = await q.getJob(c1.id);
      expect(freedChild?.parent_job_id).toBeNull();

      // Complete the remaining child — parent should now resolve
      claimed = await q.claim('w1', 30000, 'default', ['c']);
      await q.completeJob(claimed!.id, 'w1');
      expect((await q.getJob(p.id))?.status).toBe('waiting');
    });
  });
});

describe('MinionQueue — stall rescue / timeouts / delayed promotion', () => {
  it('handleStalled requeues active jobs with expired lock (below max_stalled)', async () => {
    await withQueue(async (q, e) => {
      await q.add('flaky', {}, { max_stalled: 3 });
      const claimed = await q.claim('w1', 100, 'default', ['flaky']);
      // simulate time advance — just clobber lock_until to the past
      await e.exec('UPDATE minion_jobs SET lock_until = ? WHERE id = ?', [
        e.now() - 5000,
        claimed!.id,
      ]);

      const { requeued, dead } = await q.handleStalled();
      expect(requeued).toHaveLength(1);
      expect(dead).toHaveLength(0);
      const after = await q.getJob(claimed!.id);
      expect(after?.status).toBe('waiting');
      expect(after?.stalled_counter).toBe(1);
    });
  });

  it('handleStalled dead-letters after max_stalled stalls', async () => {
    await withQueue(async (q, e) => {
      await q.add('cursed', {}, { max_stalled: 1 });
      const claimed = await q.claim('w1', 100, 'default', ['cursed']);
      await e.exec('UPDATE minion_jobs SET lock_until = ? WHERE id = ?', [
        e.now() - 5000,
        claimed!.id,
      ]);

      const { requeued, dead } = await q.handleStalled();
      expect(requeued).toHaveLength(0);
      expect(dead).toHaveLength(1);
      const after = await q.getJob(claimed!.id);
      expect(after?.status).toBe('dead');
      expect(after?.error_text).toContain('max stalled');
    });
  });

  it('handleTimeouts dead-letters expired active jobs', async () => {
    await withQueue(async (q, e) => {
      await q.add('slow', {}, { timeout_ms: 100 });
      const claimed = await q.claim('w1', 60000, 'default', ['slow']);
      // jump timeout_at into the past but keep lock_until current
      await e.exec('UPDATE minion_jobs SET timeout_at = ? WHERE id = ?', [
        e.now() - 1000,
        claimed!.id,
      ]);

      const timedOut = await q.handleTimeouts();
      expect(timedOut).toHaveLength(1);
      const after = await q.getJob(claimed!.id);
      expect(after?.status).toBe('dead');
      expect(after?.error_text).toBe('timeout exceeded');
    });
  });

  it('promoteDelayed flips delay_until-passed jobs to waiting', async () => {
    await withQueue(async (q, e) => {
      const j = await q.add('later', {}, { delay: 100 });
      // Advance delay_until into the past
      await e.exec('UPDATE minion_jobs SET delay_until = ? WHERE id = ?', [
        e.now() - 500,
        j.id,
      ]);

      const promoted = await q.promoteDelayed();
      expect(promoted).toHaveLength(1);
      expect(promoted[0].status).toBe('waiting');
    });
  });
});

describe('MinionQueue — cancel', () => {
  it('cancelJob cancels the root and cascades to descendants', async () => {
    await withQueue(async (q) => {
      const p = await q.add('p', {});
      const c = await q.add('c', {}, { parent_job_id: p.id });
      const gc = await q.add('gc', {}, { parent_job_id: c.id });

      const root = await q.cancelJob(p.id);
      expect(root?.status).toBe('cancelled');
      expect((await q.getJob(c.id))?.status).toBe('cancelled');
      expect((await q.getJob(gc.id))?.status).toBe('cancelled');
    });
  });

  it('cancelJob returns null when job is not cancellable', async () => {
    await withQueue(async (q) => {
      await q.add('done', {});
      const claimed = await q.claim('w1', 30000, 'default', ['done']);
      await q.completeJob(claimed!.id, 'w1');

      const result = await q.cancelJob(claimed!.id);
      expect(result).toBeNull();
    });
  });
});

describe('MinionQueue — pause / resume / retry / replay', () => {
  it('pauseJob + resumeJob round-trip a waiting job', async () => {
    await withQueue(async (q) => {
      const j = await q.add('x', {});
      const paused = await q.pauseJob(j.id);
      expect(paused?.status).toBe('paused');

      const resumed = await q.resumeJob(j.id);
      expect(resumed?.status).toBe('waiting');
    });
  });

  it('retryJob resurrects a failed job', async () => {
    await withQueue(async (q) => {
      await q.add('y', {});
      const claimed = await q.claim('w1', 30000, 'default', ['y']);
      await q.failJob(claimed!.id, 'w1', 'bad', 'failed');

      const retried = await q.retryJob(claimed!.id);
      expect(retried?.status).toBe('waiting');
      expect(retried?.error_text).toBeNull();
    });
  });

  it('replayJob creates a new job from a completed one', async () => {
    await withQueue(async (q) => {
      await q.add('z', { v: 1 });
      const claimed = await q.claim('w1', 30000, 'default', ['z']);
      await q.completeJob(claimed!.id, 'w1');

      const replayed = await q.replayJob(claimed!.id, { v: 2 });
      expect(replayed).not.toBeNull();
      expect(replayed!.id).not.toBe(claimed!.id);
      expect(replayed!.data).toEqual({ v: 2 });
      expect(replayed!.status).toBe('waiting');
    });
  });
});

describe('MinionQueue — inbox / tokens / progress / renew', () => {
  it('sendMessage from admin + readInbox marks read', async () => {
    await withQueue(async (q) => {
      const j = await q.add('svc', {});
      const claimed = await q.claim('w1', 30000, 'default', ['svc']);
      expect(claimed).not.toBeNull();

      const sent = await q.sendMessage(j.id, { nudge: 'check-inbox' }, 'admin');
      expect(sent?.sender).toBe('admin');

      const msgs = await q.readInbox(j.id, 'w1');
      expect(msgs).toHaveLength(1);
      expect(msgs[0].payload).toEqual({ nudge: 'check-inbox' });

      // Second read returns empty — marked as read
      const again = await q.readInbox(j.id, 'w1');
      expect(again).toHaveLength(0);
    });
  });

  it('renewLock extends lock_until; wrong token fails', async () => {
    await withQueue(async (q) => {
      await q.add('a', {});
      const claimed = await q.claim('w1', 30000, 'default', ['a']);
      expect(await q.renewLock(claimed!.id, 'w1', 60000)).toBe(true);
      expect(await q.renewLock(claimed!.id, 'wrong', 60000)).toBe(false);
    });
  });

  it('updateProgress writes token-fenced', async () => {
    await withQueue(async (q) => {
      await q.add('p', {});
      const claimed = await q.claim('w1', 30000, 'default', ['p']);
      expect(await q.updateProgress(claimed!.id, 'w1', { step: 1, total: 3 })).toBe(true);
      const got = await q.getJob(claimed!.id);
      expect(got?.progress).toEqual({ step: 1, total: 3 });
    });
  });

  it('updateTokens accumulates', async () => {
    await withQueue(async (q) => {
      await q.add('t', {});
      const claimed = await q.claim('w1', 30000, 'default', ['t']);
      expect(await q.updateTokens(claimed!.id, 'w1', { input: 100, output: 50 })).toBe(true);
      expect(await q.updateTokens(claimed!.id, 'w1', { input: 10, cache_read: 5 })).toBe(true);
      const got = await q.getJob(claimed!.id);
      expect(got?.tokens_input).toBe(110);
      expect(got?.tokens_output).toBe(50);
      expect(got?.tokens_cache_read).toBe(5);
    });
  });
});

describe('MinionQueue — prune / stats', () => {
  it('prune removes old terminal jobs', async () => {
    await withQueue(async (q, e) => {
      const old = await q.add('old', {});
      await q.claim('w1', 30000, 'default', ['old']);
      await q.failJob(old.id, 'w1', 'bye', 'dead');

      // Clobber updated_at to an old timestamp
      await e.exec('UPDATE minion_jobs SET updated_at = ? WHERE id = ?', [
        e.now() - 60 * 86400000,
        old.id,
      ]);

      const n = await q.prune({ olderThan: new Date(e.now() - 30 * 86400000) });
      expect(n).toBe(1);
      expect(await q.getJob(old.id)).toBeNull();
    });
  });

  it('getStats reports status and queue-health counts', async () => {
    await withQueue(async (q) => {
      await q.add('a', {});
      await q.add('b', {}, { priority: 1 });
      const stats = await q.getStats();
      expect(stats.by_status['waiting']).toBe(2);
      expect(stats.queue_health.waiting).toBe(2);
      expect(stats.queue_health.active).toBe(0);
      expect(stats.queue_health.stalled).toBe(0);
    });
  });
});
