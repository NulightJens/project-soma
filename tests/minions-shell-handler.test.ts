/**
 * shellHandler tests — validation (UnrecoverableError for misshapen input),
 * execution (exit codes, env allowlist, stdout truncation, pid), abort (both
 * ctx.signal and ctx.shutdownSignal trigger SIGTERM→SIGKILL kill ladder).
 *
 * Drives shellHandler directly with a stub MinionJobContext; doesn't go
 * through MinionQueue / MinionWorker. That keeps these tests fast (real
 * subprocess calls, but no DB round-trips) and independent of queue state.
 */

import { describe, expect, it } from 'vitest';

import { shellHandler } from '../src/minions/handlers/shell.js';
import { UnrecoverableError } from '../src/minions/index.js';
import type { MinionJobContext } from '../src/minions/index.js';

interface StubCtxOpts {
  data: Record<string, unknown>;
  signal?: AbortSignal;
  shutdownSignal?: AbortSignal;
}

function makeCtx(opts: StubCtxOpts): MinionJobContext {
  return {
    id: 1,
    name: 'shell',
    data: opts.data,
    attempts_made: 0,
    signal: opts.signal ?? new AbortController().signal,
    shutdownSignal: opts.shutdownSignal ?? new AbortController().signal,
    async updateProgress() {},
    async updateTokens() {},
    async log() {},
    async isActive() { return true; },
    async readInbox() { return []; },
  };
}

describe('shellHandler — validation', () => {
  it('rejects when neither cmd nor argv is provided', async () => {
    await expect(
      shellHandler(makeCtx({ data: { cwd: '/tmp' } })),
    ).rejects.toThrow(UnrecoverableError);
  });

  it('rejects when both cmd and argv are provided', async () => {
    await expect(
      shellHandler(makeCtx({ data: { cmd: 'echo hi', argv: ['echo', 'hi'], cwd: '/tmp' } })),
    ).rejects.toThrow(UnrecoverableError);
  });

  it('rejects when argv contains a non-string element', async () => {
    await expect(
      shellHandler(makeCtx({ data: { argv: ['echo', 42], cwd: '/tmp' } })),
    ).rejects.toThrow(UnrecoverableError);
  });

  it('rejects when cwd is missing', async () => {
    await expect(
      shellHandler(makeCtx({ data: { cmd: 'echo hi' } })),
    ).rejects.toThrow(UnrecoverableError);
  });

  it('rejects when cwd is a relative path', async () => {
    await expect(
      shellHandler(makeCtx({ data: { cmd: 'echo hi', cwd: './relative' } })),
    ).rejects.toThrow(UnrecoverableError);
  });

  it('rejects when env is not an object', async () => {
    await expect(
      shellHandler(makeCtx({ data: { cmd: 'echo hi', cwd: '/tmp', env: 'nope' } })),
    ).rejects.toThrow(UnrecoverableError);
  });

  it('rejects when an env value is not a string', async () => {
    await expect(
      shellHandler(makeCtx({ data: { cmd: 'echo hi', cwd: '/tmp', env: { FOO: 123 } } })),
    ).rejects.toThrow(UnrecoverableError);
  });
});

describe('shellHandler — execution', () => {
  it('runs cmd via /bin/sh -c and returns stdout + exit_code 0', async () => {
    const result = await shellHandler(
      makeCtx({ data: { cmd: 'echo hello', cwd: '/tmp' } }),
    ) as { exit_code: number; stdout_tail: string; pid: number; duration_ms: number };
    expect(result.exit_code).toBe(0);
    expect(result.stdout_tail).toBe('hello\n');
    expect(result.pid).toBeGreaterThan(0);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('runs argv directly without a shell', async () => {
    const result = await shellHandler(
      makeCtx({ data: { argv: ['/bin/echo', 'world'], cwd: '/tmp' } }),
    ) as { exit_code: number; stdout_tail: string };
    expect(result.exit_code).toBe(0);
    expect(result.stdout_tail).toBe('world\n');
  });

  it('throws Error with exit code when child exits non-zero', async () => {
    await expect(
      shellHandler(makeCtx({ data: { cmd: 'exit 7', cwd: '/tmp' } })),
    ).rejects.toThrow(/exit 7/);
  });

  it('SHELL_ENV_ALLOWLIST blocks process.env secrets from reaching child', async () => {
    const secretKey = '__SOMA_TEST_SECRET__';
    process.env[secretKey] = 'should-not-leak';
    try {
      const result = await shellHandler(
        makeCtx({ data: { cmd: `echo "${'$' + secretKey}"`, cwd: '/tmp' } }),
      ) as { stdout_tail: string };
      // Child shell expands $__SOMA_TEST_SECRET__ to empty (not in child env).
      expect(result.stdout_tail).toBe('\n');
    } finally {
      delete process.env[secretKey];
    }
  });

  it('caller-supplied env override reaches child process', async () => {
    const result = await shellHandler(
      makeCtx({
        data: { cmd: 'echo "$CUSTOM_TOKEN"', cwd: '/tmp', env: { CUSTOM_TOKEN: 'hello-from-caller' } },
      }),
    ) as { stdout_tail: string };
    expect(result.stdout_tail).toBe('hello-from-caller\n');
  });

  it('truncates stdout past 64KB with a [truncated N bytes] marker', async () => {
    // Emit ~128KB of 'a' characters.
    const result = await shellHandler(
      makeCtx({ data: { cmd: 'yes a | head -c 131072', cwd: '/tmp' } }),
    ) as { stdout_tail: string };
    expect(result.stdout_tail.startsWith('[truncated ')).toBe(true);
    // Tail body after the marker line should be ≤ 64KB.
    const firstNewline = result.stdout_tail.indexOf('\n');
    const tailBody = result.stdout_tail.slice(firstNewline + 1);
    expect(Buffer.byteLength(tailBody, 'utf8')).toBeLessThanOrEqual(64 * 1024);
  }, 10000);
});

describe('shellHandler — abort', () => {
  it('ctx.signal abort triggers kill ladder; throws error starting with "aborted:"', async () => {
    const ac = new AbortController();
    const run = shellHandler(makeCtx({
      data: { cmd: 'sleep 30', cwd: '/tmp' },
      signal: ac.signal,
    }));
    // Let the child spawn, then abort.
    setTimeout(() => ac.abort(new Error('timeout-test')), 100);
    await expect(run).rejects.toThrow(/^aborted:/);
  }, 10000);

  it('ctx.shutdownSignal abort also triggers kill ladder', async () => {
    const ac = new AbortController();
    const run = shellHandler(makeCtx({
      data: { cmd: 'sleep 30', cwd: '/tmp' },
      shutdownSignal: ac.signal,
    }));
    setTimeout(() => ac.abort(), 100);
    await expect(run).rejects.toThrow(/^aborted:/);
  }, 10000);
});
