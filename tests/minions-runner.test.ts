/**
 * Unified runner tests — registry seams + NDJSON parser (pure) + subscription
 * engine driven via a fake `claude` binary + api engine stub.
 *
 * Does NOT touch a real `claude` subprocess. The subscription engine is
 * exercised against a shell script fixture that emits canned NDJSON, so the
 * tests are deterministic and fast (no network, no OAuth, no API key).
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { writeFileSync, chmodSync, unlinkSync, mkdirSync, existsSync, rmSync } from 'fs';

import {
  runnerHandler,
  registerEngine,
  getEngine,
  listEngines,
  resetRegistryForTests,
  type RunnerEngine,
} from '../src/minions/handlers/runner.js';
import {
  buildClaudeArgs,
  createAccumulator,
  ingestNDJSONLine,
  makeSubscriptionEngine,
} from '../src/minions/handlers/engines/subscription.js';
import { apiEngine } from '../src/minions/handlers/engines/api.js';
import { UnrecoverableError } from '../src/minions/index.js';
import type { MinionJobContext } from '../src/minions/index.js';

// ── Test helpers ────────────────────────────────────────────

interface StubCtxOpts {
  data: Record<string, unknown>;
  signal?: AbortSignal;
  shutdownSignal?: AbortSignal;
}

function makeCtx(opts: StubCtxOpts): MinionJobContext {
  return {
    id: 1,
    name: 'subagent',
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

/** Write a minimal shell script that `echo`s a fixed NDJSON payload to stdout
 *  and exits. Fulfils the subscription engine's `claude -p` contract without
 *  actually running the CLI. */
function makeFakeClaudeBinary(ndjsonPayload: string, opts: { exitCode?: number; readStdin?: boolean } = {}): string {
  const dir = join(tmpdir(), `soma-runner-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  const scriptPath = join(dir, 'claude');
  // Payload is written via heredoc. If readStdin is set, the script drains
  // stdin first (so we confirm the caller's prompt reaches the binary).
  const drainStdin = opts.readStdin === false ? '' : 'cat > /dev/null\n';
  const exit = opts.exitCode ?? 0;
  // NDJSON payload via printf to preserve newlines exactly
  const escaped = ndjsonPayload.replace(/'/g, `'\\''`);
  const body = `#!/bin/bash
${drainStdin}printf '%s' '${escaped}'
exit ${exit}
`;
  writeFileSync(scriptPath, body);
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function cleanupFakeBinary(path: string): void {
  try {
    const dir = path.replace(/\/claude$/, '');
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  } catch {
    // non-fatal
  }
}

// ── Test: engine registry ───────────────────────────────────

describe('runner — engine registry', () => {
  // Save + restore the production registry around each registry-manipulating
  // test. Other describe blocks below rely on the default engines being
  // present.
  let savedEngines: RunnerEngine[] = [];

  beforeEach(() => {
    savedEngines = listEngines().map((n) => getEngine(n)!).filter(Boolean);
    resetRegistryForTests();
  });

  afterEach(() => {
    resetRegistryForTests();
    for (const e of savedEngines) registerEngine(e);
  });

  it('registers an engine and retrieves it by name', () => {
    const fake: RunnerEngine = { name: 'fake', async run() { throw new Error('not impl'); } };
    registerEngine(fake);
    expect(getEngine('fake')).toBe(fake);
    expect(listEngines()).toEqual(['fake']);
  });

  it('throws on duplicate-name registration', () => {
    const a: RunnerEngine = { name: 'dup', async run() { throw new Error(); } };
    const b: RunnerEngine = { name: 'dup', async run() { throw new Error(); } };
    registerEngine(a);
    expect(() => registerEngine(b)).toThrow(/already registered/);
  });

  it('getEngine returns undefined for unknown names', () => {
    expect(getEngine('nope')).toBeUndefined();
  });

  it('listEngines returns sorted names', () => {
    registerEngine({ name: 'zebra', async run() { throw new Error(); } });
    registerEngine({ name: 'alpha', async run() { throw new Error(); } });
    expect(listEngines()).toEqual(['alpha', 'zebra']);
  });

  it('runnerHandler rejects unknown engine with UnrecoverableError', async () => {
    registerEngine({ name: 'only-one', async run() { throw new Error(); } });
    await expect(
      runnerHandler(makeCtx({ data: { prompt: 'hi', engine: 'missing' } })),
    ).rejects.toThrow(UnrecoverableError);
  });
});

describe('runner — production registry defaults', () => {
  it('has both subscription and api engines registered on module load', () => {
    // These register as side-effects of importing the engine modules.
    expect(getEngine('subscription')).toBeDefined();
    expect(getEngine('api')).toBeDefined();
    expect(listEngines()).toEqual(['api', 'subscription']);
  });
});

// ── Test: runner handler validation + dispatch ──────────────

describe('runner — handler validation + dispatch', () => {
  it('rejects when prompt is missing', async () => {
    await expect(
      runnerHandler(makeCtx({ data: {} })),
    ).rejects.toThrow(UnrecoverableError);
  });

  it('rejects when prompt is an empty string', async () => {
    await expect(
      runnerHandler(makeCtx({ data: { prompt: '' } })),
    ).rejects.toThrow(UnrecoverableError);
  });

  it('api engine stub throws UnrecoverableError explaining the deferral', async () => {
    await expect(
      apiEngine.run(makeCtx({ data: { prompt: 'hi' } }), { prompt: 'hi' }),
    ).rejects.toThrow(UnrecoverableError);
    await expect(
      apiEngine.run(makeCtx({ data: { prompt: 'hi' } }), { prompt: 'hi' }),
    ).rejects.toThrow(/'api' engine is not yet ported/);
  });

  it('routes to engine named by data.engine when provided', async () => {
    await expect(
      runnerHandler(makeCtx({ data: { prompt: 'hi', engine: 'api' } })),
    ).rejects.toThrow(/not yet ported/);
  });

  it('falls back to SOMA_DEFAULT_ENGINE when data.engine is absent', async () => {
    const prev = process.env.SOMA_DEFAULT_ENGINE;
    process.env.SOMA_DEFAULT_ENGINE = 'api';
    try {
      await expect(
        runnerHandler(makeCtx({ data: { prompt: 'hi' } })),
      ).rejects.toThrow(/not yet ported/);
    } finally {
      if (prev === undefined) delete process.env.SOMA_DEFAULT_ENGINE;
      else process.env.SOMA_DEFAULT_ENGINE = prev;
    }
  });
});

// ── Test: pure NDJSON parser ────────────────────────────────

describe('subscription — ingestNDJSONLine (pure)', () => {
  it('skips empty and malformed lines', () => {
    const acc = createAccumulator();
    ingestNDJSONLine(acc, '');
    ingestNDJSONLine(acc, '   ');
    ingestNDJSONLine(acc, '{not valid json');
    expect(acc.transcript).toEqual([]);
    expect(acc.assistant_turns).toBe(0);
  });

  it('captures assistant turns with tool_use blocks', () => {
    const acc = createAccumulator();
    ingestNDJSONLine(acc, JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'thinking...' },
          { type: 'tool_use', id: 't1', name: 'Read', input: { path: '/tmp/foo' } },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    }));
    expect(acc.assistant_turns).toBe(1);
    expect(acc.tool_calls).toEqual([{ tool: 'Read', input: { path: '/tmp/foo' } }]);
    expect(acc.tokens).toEqual({ input: 100, output: 50, cache_read: 0, cache_create: 0 });
  });

  it('captures the result event with cost + final text', () => {
    const acc = createAccumulator();
    ingestNDJSONLine(acc, JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'all done',
      num_turns: 3,
      total_cost_usd: 0.0042,
      usage: {
        input_tokens: 250,
        output_tokens: 120,
        cache_read_input_tokens: 800,
        cache_creation_input_tokens: 0,
      },
    }));
    expect(acc.result?.subtype).toBe('success');
    expect(acc.result?.total_cost_usd).toBe(0.0042);
    expect(acc.result?.result).toBe('all done');
  });

  it('accumulates tokens across multiple assistant turns', () => {
    const acc = createAccumulator();
    ingestNDJSONLine(acc, JSON.stringify({
      type: 'assistant',
      message: { content: [], usage: { input_tokens: 100, output_tokens: 50 } },
    }));
    ingestNDJSONLine(acc, JSON.stringify({
      type: 'assistant',
      message: { content: [], usage: { input_tokens: 50, output_tokens: 30, cache_read_input_tokens: 400 } },
    }));
    expect(acc.assistant_turns).toBe(2);
    expect(acc.tokens).toEqual({ input: 150, output: 80, cache_read: 400, cache_create: 0 });
  });
});

// ── Test: buildClaudeArgs (pure) ────────────────────────────

describe('subscription — buildClaudeArgs (pure)', () => {
  it('builds canonical args with defaults', () => {
    const args = buildClaudeArgs({ prompt: 'hi' });
    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--verbose');
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).toContain('--max-turns');
    expect(args).toContain('--model');
  });

  it('passes allowed_tools through', () => {
    const args = buildClaudeArgs({ prompt: 'hi', allowed_tools: ['Read', 'Write'] });
    const idx = args.indexOf('--allowed-tools');
    expect(idx).toBeGreaterThan(-1);
    expect(args.slice(idx + 1, idx + 3)).toEqual(['Read', 'Write']);
  });

  it('appends --append-system-prompt when system is provided', () => {
    const args = buildClaudeArgs({ prompt: 'hi', system: 'you are helpful' });
    const idx = args.indexOf('--append-system-prompt');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('you are helpful');
  });

  it('does not include --append-system-prompt when system is absent', () => {
    const args = buildClaudeArgs({ prompt: 'hi' });
    expect(args).not.toContain('--append-system-prompt');
  });
});

// ── Test: subscription engine against a fake claude binary ──

describe('subscription — end-to-end with a fake claude binary', () => {
  const fakes: string[] = [];
  afterEach(() => {
    while (fakes.length > 0) cleanupFakeBinary(fakes.pop()!);
  });

  it('parses a complete transcript + returns the RunnerResult', async () => {
    const payload = [
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 't1', name: 'Read', input: { path: '/x' } },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'done',
        num_turns: 1,
        total_cost_usd: 0.0025,
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 800 },
      }),
    ].join('\n') + '\n';
    const fake = makeFakeClaudeBinary(payload);
    fakes.push(fake);
    const engine = makeSubscriptionEngine({ binary: fake });
    const ctx = makeCtx({ data: { prompt: 'hi' } });
    const result = await engine.run(ctx, { prompt: 'hi' });
    expect(result.engine).toBe('subscription');
    expect(result.result).toBe('done');
    expect(result.tool_calls).toEqual([{ tool: 'Read', input: { path: '/x' } }]);
    expect(result.cost_usd).toBe(0.0025);
    expect(result.tokens.input).toBe(100);
    expect(result.tokens.output).toBe(50);
    expect(result.tokens.cache_read).toBe(800);
    expect(result.turns_used).toBe(1);
    expect(result.exit_reason).toBe('success');
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    expect(result.transcript.length).toBe(2);
  }, 10000);

  it('marks error_max_turns when the result event carries that subtype', async () => {
    const payload = JSON.stringify({
      type: 'result',
      subtype: 'error_max_turns',
      is_error: true,
      result: 'turn budget exceeded',
      num_turns: 20,
    }) + '\n';
    const fake = makeFakeClaudeBinary(payload);
    fakes.push(fake);
    const engine = makeSubscriptionEngine({ binary: fake });
    const result = await engine.run(makeCtx({ data: { prompt: 'hi' } }), { prompt: 'hi' });
    expect(result.exit_reason).toBe('error_max_turns');
  }, 10000);

  it('throws when the child exits non-zero without a result line', async () => {
    const fake = makeFakeClaudeBinary('', { exitCode: 2 });
    fakes.push(fake);
    const engine = makeSubscriptionEngine({ binary: fake });
    await expect(
      engine.run(makeCtx({ data: { prompt: 'hi' } }), { prompt: 'hi' }),
    ).rejects.toThrow(/claude -p exited 2/);
  }, 10000);

  it('ctx.signal abort triggers kill ladder and throws aborted:', async () => {
    // Fake binary that sleeps 30s so we can abort mid-run.
    const dir = join(tmpdir(), `soma-runner-abort-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    const scriptPath = join(dir, 'claude');
    writeFileSync(scriptPath, '#!/bin/bash\ncat > /dev/null\nsleep 30\n');
    chmodSync(scriptPath, 0o755);
    fakes.push(scriptPath);

    const ac = new AbortController();
    const engine = makeSubscriptionEngine({ binary: scriptPath });
    const run = engine.run(
      makeCtx({ data: { prompt: 'hi' }, signal: ac.signal }),
      { prompt: 'hi' },
    );
    setTimeout(() => ac.abort(new Error('timeout-test')), 100);
    await expect(run).rejects.toThrow(/^aborted:/);
  }, 10000);
});
