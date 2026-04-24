/**
 * Tests for the CLI's built-in handlers (echo / noop / sleep).
 *
 * Drives each handler end-to-end through MinionQueue + MinionWorker so the
 * ctx wiring (data, signal, log, attempts_made) is exercised, not just the
 * handler body.
 */

import { describe, expect, it } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { unlinkSync, existsSync } from 'fs';

import { MinionQueue, MinionWorker, openSqliteEngine } from '../src/minions/index.js';
import { BUILTIN_HANDLERS, resolveBuiltinHandlers } from '../src/cli/job-handlers.js';

function tmpPath(): string {
  return join(tmpdir(), `soma-handlers-${randomUUID()}.db`);
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

async function runOneJob(
  handlerName: keyof typeof BUILTIN_HANDLERS,
  data: Record<string, unknown>,
  opts: { lockDuration?: number } = {},
): Promise<ReturnType<MinionQueue['getJob']>> {
  const path = tmpPath();
  const engine = openSqliteEngine({ path });
  const queue = new MinionQueue(engine);
  const worker = new MinionWorker(engine, {
    lockDuration: opts.lockDuration ?? 30_000,
    pollInterval: 50,
    stalledInterval: 60_000,
  });
  worker.register(handlerName, BUILTIN_HANDLERS[handlerName]);
  try {
    const job = await queue.add(handlerName, data);
    await worker.tick();
    await worker.drain(2_000);
    return queue.getJob(job.id);
  } finally {
    worker.stop();
    await engine.close();
    cleanup(path);
  }
}

describe('BUILTIN_HANDLERS registry', () => {
  it('exposes echo, noop, and sleep', () => {
    expect(Object.keys(BUILTIN_HANDLERS).sort()).toEqual(['echo', 'noop', 'sleep']);
  });
});

describe('resolveBuiltinHandlers env gate', () => {
  it('excludes shell by default', () => {
    const prev = process.env.SOMA_ALLOW_SHELL_JOBS;
    delete process.env.SOMA_ALLOW_SHELL_JOBS;
    try {
      expect(Object.keys(resolveBuiltinHandlers()).sort()).toEqual(['echo', 'noop', 'sleep']);
    } finally {
      if (prev !== undefined) process.env.SOMA_ALLOW_SHELL_JOBS = prev;
    }
  });

  it('includes shell when SOMA_ALLOW_SHELL_JOBS=1', () => {
    const prev = process.env.SOMA_ALLOW_SHELL_JOBS;
    process.env.SOMA_ALLOW_SHELL_JOBS = '1';
    try {
      expect(Object.keys(resolveBuiltinHandlers()).sort()).toEqual(['echo', 'noop', 'shell', 'sleep']);
    } finally {
      if (prev === undefined) delete process.env.SOMA_ALLOW_SHELL_JOBS;
      else process.env.SOMA_ALLOW_SHELL_JOBS = prev;
    }
  });

  it('ignores values other than "1"', () => {
    const prev = process.env.SOMA_ALLOW_SHELL_JOBS;
    process.env.SOMA_ALLOW_SHELL_JOBS = 'true';
    try {
      expect(Object.keys(resolveBuiltinHandlers()).sort()).toEqual(['echo', 'noop', 'sleep']);
    } finally {
      if (prev === undefined) delete process.env.SOMA_ALLOW_SHELL_JOBS;
      else process.env.SOMA_ALLOW_SHELL_JOBS = prev;
    }
  });
});

describe('echo handler', () => {
  it('returns the input data verbatim inside { echoed } and records the attempt', async () => {
    const finished = await runOneJob('echo', { msg: 'hi', n: 7 });
    expect(finished?.status).toBe('completed');
    expect(finished?.result).toEqual({ echoed: { msg: 'hi', n: 7 }, attempt: 1 });
  });

  it('writes a log line to the stacktrace', async () => {
    const finished = await runOneJob('echo', { tag: 'logtest' });
    expect(finished?.stacktrace.length).toBe(1);
    expect(finished?.stacktrace[0]).toMatch(/echo received data.*logtest/);
  });
});

describe('noop handler', () => {
  it('returns an empty object', async () => {
    const finished = await runOneJob('noop', {});
    expect(finished?.status).toBe('completed');
    expect(finished?.result).toEqual({});
  });
});

describe('sleep handler', () => {
  it('sleeps the requested duration and returns slept_ms', async () => {
    const start = Date.now();
    const finished = await runOneJob('sleep', { ms: 80 });
    const elapsed = Date.now() - start;
    expect(finished?.status).toBe('completed');
    expect(finished?.result).toEqual({ slept_ms: 80 });
    expect(elapsed).toBeGreaterThanOrEqual(70);
  });

  it('rejects negative ms', async () => {
    const finished = await runOneJob('sleep', { ms: -5 });
    // Handler throws → delayed (first attempt) with the error recorded.
    expect(['delayed', 'dead']).toContain(finished?.status);
    expect(finished?.error_text).toMatch(/non-negative/);
  });

  it('rejects its own promise when ctx.signal aborts', async () => {
    // Drive the handler directly — no worker, no queue — to isolate the
    // abort-signal wiring. The worker.ts sigkill-rescue smoke already
    // covers the claim → lock-loss → abort integration path.
    const abort = new AbortController();
    const ctx = {
      id: 0,
      name: 'sleep',
      data: { ms: 10_000 },
      attempts_made: 0,
      signal: abort.signal,
      shutdownSignal: new AbortController().signal,
      updateProgress: async () => {},
      updateTokens: async () => {},
      log: async () => {},
      isActive: async () => true,
      readInbox: async () => [],
    };
    const promise = BUILTIN_HANDLERS.sleep(ctx);
    setTimeout(() => abort.abort(new Error('cancel')), 20);
    await expect(promise).rejects.toThrow(/aborted after signal/);
  });
});
