/**
 * API engine tests — multi-turn loop with crash-resumable replay,
 * provider abstraction, env gate, and Anthropic provider's block
 * normalisation. No real network calls; the Anthropic SDK is never loaded
 * here (we go through the Provider seam with a fake provider).
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { openSqliteEngine } from '../src/minions/engine-sqlite.js';
import { MinionQueue } from '../src/minions/queue.js';
import type { QueueEngine } from '../src/minions/engine.js';
import { UnrecoverableError } from '../src/minions/index.js';
import type { MinionJobContext, SubagentApi } from '../src/minions/types.js';
import {
  makeApiEngine,
  registerProvider,
  getProvider,
  resetProviderRegistryForTests,
  type Provider,
  type ProviderTurnResult,
  type ApiToolDef,
} from '../src/minions/handlers/engines/api.js';
import { runApiLoop } from '../src/minions/handlers/engines/api.js';
import { makeAnthropicProvider } from '../src/minions/handlers/engines/api/providers/anthropic.js';

// ── Helpers ──────────────────────────────────────────────────

interface FakeJobScope {
  engine: QueueEngine;
  queue: MinionQueue;
  jobId: number;
  ctx: MinionJobContext;
  cleanup: () => Promise<void>;
}

async function setupJob(opts: {
  data: Record<string, unknown>;
  signal?: AbortSignal;
  shutdownSignal?: AbortSignal;
}): Promise<FakeJobScope> {
  const engine = await openSqliteEngine({ path: ':memory:' });
  const queue = new MinionQueue(engine);
  const job = await queue.add('subagent', opts.data, undefined, {
    allowProtectedSubmit: true,
  });
  const subagent: SubagentApi = {
    appendMessage: (msg) => queue.appendSubagentMessage(job.id, msg),
    loadMessages: () => queue.loadSubagentMessages(job.id),
    appendToolExecPending: (args) =>
      queue.appendSubagentToolExecPending({ jobId: job.id, ...args }),
    markToolExecComplete: (args) =>
      queue.markSubagentToolExecComplete({ jobId: job.id, ...args }),
    markToolExecFailed: (args) =>
      queue.markSubagentToolExecFailed({ jobId: job.id, ...args }),
    loadToolExecs: () => queue.loadSubagentToolExecs(job.id),
  };
  const ctx: MinionJobContext = {
    id: job.id,
    name: job.name,
    data: opts.data,
    attempts_made: 0,
    signal: opts.signal ?? new AbortController().signal,
    shutdownSignal: opts.shutdownSignal ?? new AbortController().signal,
    async updateProgress() {},
    async updateTokens() {},
    async log() {},
    async isActive() { return true; },
    async readInbox() { return []; },
    subagent,
  };
  return {
    engine,
    queue,
    jobId: job.id,
    ctx,
    cleanup: async () => engine.close(),
  };
}

/**
 * Build a Provider whose runTurn answers from a queue of canned responses.
 * Each call shifts one off; throws if the queue is empty (lets tests assert
 * exact turn count).
 */
function makeFakeProvider(responses: ProviderTurnResult[], opts: { name?: string } = {}): Provider {
  let idx = 0;
  return {
    name: opts.name ?? 'fake',
    rateKey: () => 'fake:test',
    async runTurn() {
      if (idx >= responses.length) throw new Error('fake provider: out of responses');
      return responses[idx++];
    },
  };
}

// ── Tests: env gate + factory wiring ─────────────────────────

describe('api engine — env gate', () => {
  it('throws UnrecoverableError when SOMA_ALLOW_API_ENGINE is unset', async () => {
    const prev = process.env.SOMA_ALLOW_API_ENGINE;
    delete process.env.SOMA_ALLOW_API_ENGINE;
    try {
      const scope = await setupJob({ data: { prompt: 'hi' } });
      // makeApiEngine() with no deps mirrors the production-registered engine.
      const engine = makeApiEngine();
      await expect(engine.run(scope.ctx)).rejects.toThrow(UnrecoverableError);
      await expect(engine.run(scope.ctx)).rejects.toThrow(/SOMA_ALLOW_API_ENGINE=1/);
      await scope.cleanup();
    } finally {
      if (prev === undefined) delete process.env.SOMA_ALLOW_API_ENGINE;
      else process.env.SOMA_ALLOW_API_ENGINE = prev;
    }
  });

  it('bypasses the gate when deps.engine is provided (test path)', async () => {
    const prev = process.env.SOMA_ALLOW_API_ENGINE;
    delete process.env.SOMA_ALLOW_API_ENGINE;
    try {
      const scope = await setupJob({ data: { prompt: 'hi', provider: 'fake' } });
      const fake = makeFakeProvider([
        {
          content_blocks: [{ type: 'text', text: 'ok' }],
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
          stop_reason: 'end_turn',
        },
      ]);
      const engine = makeApiEngine({
        engine: scope.engine,
        resolveProvider: (n) => (n === 'fake' ? fake : undefined),
      });
      const result = await engine.run(scope.ctx);
      expect(result.result).toBe('ok');
      await scope.cleanup();
    } finally {
      if (prev === undefined) delete process.env.SOMA_ALLOW_API_ENGINE;
      else process.env.SOMA_ALLOW_API_ENGINE = prev;
    }
  });
});

// ── Tests: validation ────────────────────────────────────────

describe('api engine — validation', () => {
  it('rejects empty prompt with UnrecoverableError', async () => {
    const scope = await setupJob({ data: { prompt: '' } });
    await expect(
      runApiLoop(scope.ctx, { engine: scope.engine }),
    ).rejects.toThrow(UnrecoverableError);
    await scope.cleanup();
  });

  it('rejects unknown provider with UnrecoverableError', async () => {
    const scope = await setupJob({ data: { prompt: 'hi', provider: 'nope' } });
    await expect(
      runApiLoop(scope.ctx, {
        engine: scope.engine,
        resolveProvider: () => undefined,
      }),
    ).rejects.toThrow(/unknown provider 'nope'/);
    await scope.cleanup();
  });

  it('throws when ctx.subagent is missing', async () => {
    const scope = await setupJob({ data: { prompt: 'hi' } });
    const ctxNoSubagent: MinionJobContext = { ...scope.ctx, subagent: undefined };
    await expect(
      runApiLoop(ctxNoSubagent, { engine: scope.engine }),
    ).rejects.toThrow(/ctx.subagent is required/);
    await scope.cleanup();
  });
});

// ── Tests: single-turn happy path ────────────────────────────

describe('api engine — single-turn happy path', () => {
  it('persists seed user message + assistant turn, returns final text', async () => {
    const scope = await setupJob({ data: { prompt: 'say hi' } });
    const fake = makeFakeProvider([
      {
        content_blocks: [{ type: 'text', text: 'hello world' }],
        usage: {
          input_tokens: 5,
          output_tokens: 2,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        stop_reason: 'end_turn',
      },
    ]);
    const result = await runApiLoop(scope.ctx, {
      engine: scope.engine,
      resolveProvider: () => fake,
    });
    expect(result.engine).toBe('api');
    expect(result.result).toBe('hello world');
    expect(result.turns_used).toBe(1);
    expect(result.exit_reason).toBe('end_turn');
    expect(result.tokens.input).toBe(5);
    expect(result.tokens.output).toBe(2);

    // Persisted: user (idx 0) + assistant (idx 1)
    const msgs = await scope.queue.loadSubagentMessages(scope.jobId);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('user');
    expect(msgs[1].role).toBe('assistant');
    expect(msgs[1].tokens_in).toBe(5);
    expect(msgs[1].tokens_out).toBe(2);

    await scope.cleanup();
  });
});

// ── Tests: tool-use loop ─────────────────────────────────────

describe('api engine — tool-use loop', () => {
  it('dispatches tool, persists ledger pending → complete, follows up', async () => {
    const scope = await setupJob({ data: { prompt: 'use the tool' } });
    let toolCalls = 0;
    const tool: ApiToolDef = {
      name: 'add',
      description: 'add two numbers',
      input_schema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
      idempotent: true,
      async execute(input) {
        toolCalls++;
        const i = input as { a: number; b: number };
        return { sum: i.a + i.b };
      },
    };

    const fake = makeFakeProvider([
      // Turn 1: model wants to call `add`.
      {
        content_blocks: [
          { type: 'tool_use', id: 'tu_1', name: 'add', input: { a: 2, b: 3 } },
        ],
        usage: {
          input_tokens: 10, output_tokens: 5,
          cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
        },
        stop_reason: 'tool_use',
      },
      // Turn 2: with tool result in hand, replies with the answer.
      {
        content_blocks: [{ type: 'text', text: 'the sum is 5' }],
        usage: {
          input_tokens: 4, output_tokens: 3,
          cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
        },
        stop_reason: 'end_turn',
      },
    ]);

    // Inject tool via data.tools (commit-c registry replaces this path).
    scope.ctx.data = { ...scope.ctx.data, tools: [tool] };

    const result = await runApiLoop(scope.ctx, {
      engine: scope.engine,
      resolveProvider: () => fake,
    });
    expect(toolCalls).toBe(1);
    expect(result.result).toBe('the sum is 5');
    expect(result.turns_used).toBe(2);
    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls[0].tool).toBe('add');

    // Ledger: one row, complete.
    const ledger = await scope.queue.loadSubagentToolExecs(scope.jobId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].status).toBe('complete');
    expect(ledger[0].output).toEqual({ sum: 5 });

    await scope.cleanup();
  });

  it('records tool_use missing from registry as failed and continues', async () => {
    const scope = await setupJob({ data: { prompt: 'go' } });
    const fake = makeFakeProvider([
      {
        content_blocks: [
          { type: 'tool_use', id: 'tu_x', name: 'unregistered', input: {} },
        ],
        usage: {
          input_tokens: 1, output_tokens: 1,
          cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
        },
        stop_reason: 'tool_use',
      },
      {
        content_blocks: [{ type: 'text', text: 'sorry, fell back' }],
        usage: {
          input_tokens: 2, output_tokens: 2,
          cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
        },
        stop_reason: 'end_turn',
      },
    ]);
    const result = await runApiLoop(scope.ctx, {
      engine: scope.engine,
      resolveProvider: () => fake,
    });
    expect(result.result).toBe('sorry, fell back');
    const ledger = await scope.queue.loadSubagentToolExecs(scope.jobId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].status).toBe('failed');
    expect(ledger[0].error).toMatch(/not in the registry/);
    await scope.cleanup();
  });
});

// ── Tests: max_turns limit ───────────────────────────────────

describe('api engine — max_turns', () => {
  it('exits with stop_reason=max_turns when limit reached without end_turn', async () => {
    const scope = await setupJob({ data: { prompt: 'go forever', max_turns: 2 } });
    // Two turns, both ending in tool_use without a registered tool — so
    // both keep generating user-side tool_result blocks but never end_turn.
    const fake = makeFakeProvider([
      {
        content_blocks: [{ type: 'tool_use', id: 'a', name: 'mystery', input: {} }],
        usage: {
          input_tokens: 1, output_tokens: 1,
          cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
        },
        stop_reason: 'tool_use',
      },
      {
        content_blocks: [{ type: 'tool_use', id: 'b', name: 'mystery', input: {} }],
        usage: {
          input_tokens: 1, output_tokens: 1,
          cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
        },
        stop_reason: 'tool_use',
      },
    ]);
    const result = await runApiLoop(scope.ctx, {
      engine: scope.engine,
      resolveProvider: () => fake,
    });
    expect(result.exit_reason).toBe('max_turns');
    expect(result.turns_used).toBe(2);
    await scope.cleanup();
  });
});

// ── Tests: replay reconciliation ─────────────────────────────

describe('api engine — replay', () => {
  it('skips persisted seed, replays prior tool exec, finishes from where it left off', async () => {
    const scope = await setupJob({ data: { prompt: 'do it' } });
    // Pre-seed state: user message + assistant message with tool_use that
    // already completed in a prior run. The fresh provider call should be
    // the FOLLOW-UP turn only (1 call, not 2).
    await scope.ctx.subagent!.appendMessage({
      message_idx: 0,
      role: 'user',
      content_blocks: [{ type: 'text', text: 'do it' }],
      tokens_in: null, tokens_out: null,
      tokens_cache_read: null, tokens_cache_create: null, model: null,
    });
    await scope.ctx.subagent!.appendMessage({
      message_idx: 1,
      role: 'assistant',
      content_blocks: [
        { type: 'tool_use', id: 'tu_done', name: 'echoer', input: { a: 1 } },
      ],
      tokens_in: 10, tokens_out: 3,
      tokens_cache_read: 0, tokens_cache_create: 0,
      model: 'claude-sonnet-4-6',
    });
    await scope.ctx.subagent!.appendToolExecPending({
      message_idx: 1,
      tool_use_id: 'tu_done',
      tool_name: 'echoer',
      input: { a: 1 },
    });
    await scope.ctx.subagent!.markToolExecComplete({
      tool_use_id: 'tu_done',
      output: { echoed: 1 },
    });

    let providerCalls = 0;
    const fake: Provider = {
      name: 'fake',
      rateKey: () => 'fake:test',
      async runTurn() {
        providerCalls++;
        return {
          content_blocks: [{ type: 'text', text: 'finished' }],
          usage: {
            input_tokens: 4, output_tokens: 2,
            cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
          },
          stop_reason: 'end_turn',
        };
      },
    };

    const tool: ApiToolDef = {
      name: 'echoer',
      description: 'echo',
      input_schema: { type: 'object' },
      idempotent: true,
      async execute(i) { return i; },
    };
    scope.ctx.data = { ...scope.ctx.data, tools: [tool] };

    const result = await runApiLoop(scope.ctx, {
      engine: scope.engine,
      resolveProvider: () => fake,
    });

    expect(providerCalls).toBe(1);
    expect(result.result).toBe('finished');
    // Total tokens = priors (10/3) + this turn (4/2) = (14/5)
    expect(result.tokens.input).toBe(14);
    expect(result.tokens.output).toBe(5);
    await scope.cleanup();
  });
});

// ── Tests: provider registry ─────────────────────────────────

describe('api engine — provider registry', () => {
  let saved: Provider[] = [];

  beforeEach(() => {
    saved = [];
    for (const name of ['anthropic']) {
      const p = getProvider(name);
      if (p) saved.push(p);
    }
    resetProviderRegistryForTests();
  });

  afterEach(() => {
    resetProviderRegistryForTests();
    for (const p of saved) registerProvider(p);
  });

  it('rejects duplicate provider registration', () => {
    const p1: Provider = { name: 'dupe', rateKey: () => 'k', async runTurn() { throw new Error(); } };
    const p2: Provider = { name: 'dupe', rateKey: () => 'k', async runTurn() { throw new Error(); } };
    registerProvider(p1);
    expect(() => registerProvider(p2)).toThrow(/already registered/);
  });

  it('resolves a registered provider by name', () => {
    const p: Provider = {
      name: 'whichever',
      rateKey: () => 'whichever:test',
      async runTurn() { throw new Error(); },
    };
    registerProvider(p);
    expect(getProvider('whichever')).toBe(p);
    expect(getProvider('nope')).toBeUndefined();
  });
});

// ── Tests: Anthropic provider — block normalisation ──────────

describe('anthropic provider — runTurn', () => {
  it('translates content blocks both ways and normalises usage', async () => {
    const captured: Array<unknown> = [];
    const fakeClient = {
      async create(params: unknown) {
        captured.push(params);
        return {
          content: [
            { type: 'text', text: 'reply' },
            { type: 'tool_use', id: 'tu_1', name: 't', input: { x: 1 } },
            // Unknown block type — should be silently dropped.
            { type: 'thinking', thinking: 'meta' },
          ],
          stop_reason: 'tool_use',
          usage: {
            input_tokens: 7, output_tokens: 4,
            cache_read_input_tokens: 1, cache_creation_input_tokens: 2,
          },
        };
      },
    };
    const provider = makeAnthropicProvider({ client: fakeClient });
    const result = await provider.runTurn({
      model: 'claude-sonnet-4-6',
      system: 'sys',
      messages: [
        {
          message_idx: 0, role: 'user',
          content_blocks: [{ type: 'text', text: 'hi' }],
          tokens_in: null, tokens_out: null,
          tokens_cache_read: null, tokens_cache_create: null, model: null,
        },
      ],
      tools: [
        { name: 'a', description: 'A', input_schema: {}, idempotent: true, async execute() { return null; } },
        { name: 'b', description: 'B', input_schema: {}, idempotent: true, async execute() { return null; } },
      ],
      max_tokens: 100,
      signal: new AbortController().signal,
    });

    // Outbound shape: cache_control on system + last tool only.
    expect(captured).toHaveLength(1);
    const sentParams = captured[0] as {
      system: Array<{ cache_control?: unknown }>;
      tools?: Array<{ cache_control?: unknown }>;
    };
    expect(sentParams.system[0].cache_control).toBeDefined();
    expect(sentParams.tools![0].cache_control).toBeUndefined();
    expect(sentParams.tools![1].cache_control).toBeDefined();

    // Inbound shape: only known block types kept.
    expect(result.content_blocks).toHaveLength(2);
    expect(result.content_blocks[0]).toEqual({ type: 'text', text: 'reply' });
    expect(result.content_blocks[1]).toMatchObject({ type: 'tool_use', id: 'tu_1', name: 't' });

    expect(result.usage.input_tokens).toBe(7);
    expect(result.usage.output_tokens).toBe(4);
    expect(result.usage.cache_read_input_tokens).toBe(1);
    expect(result.usage.cache_creation_input_tokens).toBe(2);
    expect(result.stop_reason).toBe('tool_use');
  });
});
