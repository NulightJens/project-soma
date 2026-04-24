/**
 * Protected-names gate tests.
 *
 * Two layers:
 *   1. Pure module — PROTECTED_JOB_NAMES membership + isProtectedJobName.
 *   2. MinionQueue.add() gate — untrusted submission rejected; trusted
 *      `{allowProtectedSubmit: true}` passes; whitespace-trim-evasion
 *      is blocked; opts-spread cannot carry the trust flag.
 */

import { describe, expect, it } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { unlinkSync, existsSync } from 'fs';

import {
  MinionQueue,
  PROTECTED_JOB_NAMES,
  isProtectedJobName,
  openSqliteEngine,
} from '../src/minions/index.js';
import type { QueueEngine } from '../src/minions/index.js';

function tmpPath(): string {
  return join(tmpdir(), `soma-protected-test-${randomUUID()}.db`);
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

describe('protected-names — pure module', () => {
  it('PROTECTED_JOB_NAMES contains shell, subagent, subagent_aggregator', () => {
    expect(PROTECTED_JOB_NAMES.has('shell')).toBe(true);
    expect(PROTECTED_JOB_NAMES.has('subagent')).toBe(true);
    expect(PROTECTED_JOB_NAMES.has('subagent_aggregator')).toBe(true);
  });

  it('PROTECTED_JOB_NAMES does NOT contain common untrusted names', () => {
    for (const name of ['sync', 'embed', 'anything', 'Shell', 'SHELL', 'shelled']) {
      expect(PROTECTED_JOB_NAMES.has(name)).toBe(false);
    }
  });

  it('isProtectedJobName returns true for every protected name', () => {
    expect(isProtectedJobName('shell')).toBe(true);
    expect(isProtectedJobName('subagent')).toBe(true);
    expect(isProtectedJobName('subagent_aggregator')).toBe(true);
  });

  it('isProtectedJobName trims whitespace before checking', () => {
    expect(isProtectedJobName(' shell ')).toBe(true);
    expect(isProtectedJobName('\tshell\n')).toBe(true);
    expect(isProtectedJobName('  subagent  ')).toBe(true);
  });

  it('isProtectedJobName is case-sensitive (matches gbrain semantics)', () => {
    expect(isProtectedJobName('SHELL')).toBe(false);
    expect(isProtectedJobName('Shell')).toBe(false);
    expect(isProtectedJobName('SubAgent')).toBe(false);
  });

  it('isProtectedJobName returns false for non-member names', () => {
    expect(isProtectedJobName('sync')).toBe(false);
    expect(isProtectedJobName('')).toBe(false);
    expect(isProtectedJobName('shells')).toBe(false);
    expect(isProtectedJobName('shell-thing')).toBe(false);
  });
});

describe('MinionQueue.add — protected-name gate', () => {
  it('rejects untrusted submission of every protected name', async () => {
    await withQueue(async (q) => {
      for (const name of ['shell', 'subagent', 'subagent_aggregator']) {
        await expect(q.add(name)).rejects.toThrow(/protected job name/i);
      }
    });
  });

  it('allows submission when trusted.allowProtectedSubmit is true', async () => {
    await withQueue(async (q) => {
      const shell = await q.add('shell', { cmd: 'echo hi' }, {}, { allowProtectedSubmit: true });
      expect(shell.name).toBe('shell');
      expect(shell.status).toBe('waiting');

      const subagent = await q.add('subagent', {}, {}, { allowProtectedSubmit: true });
      expect(subagent.name).toBe('subagent');

      const agg = await q.add('subagent_aggregator', {}, {}, { allowProtectedSubmit: true });
      expect(agg.name).toBe('subagent_aggregator');
    });
  });

  it('trim-evasion does not bypass the gate', async () => {
    await withQueue(async (q) => {
      await expect(q.add(' shell ')).rejects.toThrow(/protected job name/i);
      await expect(q.add('\tsubagent\n')).rejects.toThrow(/protected job name/i);
    });
  });

  it('allowProtectedSubmit: false explicitly still blocks', async () => {
    await withQueue(async (q) => {
      await expect(q.add('shell', {}, {}, { allowProtectedSubmit: false })).rejects.toThrow(
        /protected job name/i,
      );
    });
  });

  it('trust flag cannot hide inside opts via spread', async () => {
    await withQueue(async (q) => {
      // Simulate an attacker-controlled `userOpts` payload containing the
      // flag — since TrustedSubmitOpts is the 4th arg (NOT in opts), any
      // `{...userOpts}` spread into `opts` cannot grant trust.
      const hostileUserOpts = {
        priority: 0,
        allowProtectedSubmit: true, // ignored — wrong argument position
      } as unknown as Parameters<typeof q.add>[2];
      await expect(q.add('shell', {}, hostileUserOpts)).rejects.toThrow(/protected job name/i);
    });
  });

  it('non-protected names are unaffected by the gate', async () => {
    await withQueue(async (q) => {
      const job = await q.add('sync', { full: true });
      expect(job.name).toBe('sync');
      expect(job.status).toBe('waiting');
    });
  });

  it('empty-name error still fires before the protected-name check', async () => {
    await withQueue(async (q) => {
      await expect(q.add('')).rejects.toThrow(/empty/i);
      await expect(q.add('   ')).rejects.toThrow(/empty/i);
    });
  });
});
