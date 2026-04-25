/**
 * OpenAI-compatible provider tests + custom-endpoint config tests.
 *
 * No real network — every test injects `fetchImpl` so requests can be
 * inspected and responses canned. Custom-endpoint tests reset the provider
 * registry around each case so SOMA_API_CUSTOM_PROVIDERS env loading is
 * deterministic.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import {
  makeOpenAiProvider,
  messagesToOpenAi,
  openAiAssistantToBlocks,
  normaliseFinishReason,
} from '../src/minions/handlers/engines/api/providers/openai.js';
import {
  loadCustomProvidersFromEnv,
} from '../src/minions/handlers/engines/api/providers/custom.js';
import {
  registerProvider,
  getProvider,
  listProviders,
  resetProviderRegistryForTests,
  type Provider,
} from '../src/minions/handlers/engines/api.js';
import { ProviderHttpError } from '../src/minions/handlers/engines/api/types.js';

// ── Pure translators ────────────────────────────────────────

describe('openai provider — messagesToOpenAi (pure)', () => {
  it('prepends the system message and converts text-only user/assistant', () => {
    const out = messagesToOpenAi('be helpful', [
      { message_idx: 0, role: 'user', content_blocks: [{ type: 'text', text: 'hi' }],
        tokens_in: null, tokens_out: null, tokens_cache_read: null, tokens_cache_create: null, model: null },
      { message_idx: 1, role: 'assistant', content_blocks: [{ type: 'text', text: 'hello' }],
        tokens_in: 1, tokens_out: 1, tokens_cache_read: 0, tokens_cache_create: 0, model: 'gpt-4' },
    ]);
    expect(out).toEqual([
      { role: 'system', content: 'be helpful' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  it('translates assistant tool_use into tool_calls and serialises args as JSON', () => {
    const out = messagesToOpenAi('s', [
      {
        message_idx: 0, role: 'assistant',
        content_blocks: [
          { type: 'text', text: 'looking up' },
          { type: 'tool_use', id: 'tu_1', name: 'search', input: { q: 'cats' } },
        ],
        tokens_in: null, tokens_out: null, tokens_cache_read: null, tokens_cache_create: null, model: null,
      },
    ]);
    expect(out[1]).toMatchObject({
      role: 'assistant',
      content: 'looking up',
      tool_calls: [
        {
          id: 'tu_1',
          type: 'function',
          function: { name: 'search', arguments: '{"q":"cats"}' },
        },
      ],
    });
  });

  it('splits a user message with multiple tool_result blocks into separate role:tool messages', () => {
    const out = messagesToOpenAi('s', [
      {
        message_idx: 0, role: 'user',
        content_blocks: [
          { type: 'tool_result', tool_use_id: 'tu_1', content: 'one' },
          { type: 'tool_result', tool_use_id: 'tu_2', content: 'two' },
        ],
        tokens_in: null, tokens_out: null, tokens_cache_read: null, tokens_cache_create: null, model: null,
      },
    ]);
    // system + 2 tool messages, no user text message (no text blocks).
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual({ role: 'tool', tool_call_id: 'tu_1', content: 'one' });
    expect(out[2]).toEqual({ role: 'tool', tool_call_id: 'tu_2', content: 'two' });
  });

  it('emits assistant.content as null when only tool_uses are present', () => {
    const out = messagesToOpenAi('s', [
      {
        message_idx: 0, role: 'assistant',
        content_blocks: [{ type: 'tool_use', id: 'tu', name: 'go', input: {} }],
        tokens_in: null, tokens_out: null, tokens_cache_read: null, tokens_cache_create: null, model: null,
      },
    ]);
    expect(out[1]).toMatchObject({ role: 'assistant', content: null });
  });
});

describe('openai provider — openAiAssistantToBlocks (pure)', () => {
  it('converts content + tool_calls back into canonical blocks', () => {
    const blocks = openAiAssistantToBlocks({
      content: 'thinking out loud',
      tool_calls: [
        { id: 'c_1', type: 'function', function: { name: 'fetch', arguments: '{"u":"x"}' } },
      ],
    });
    expect(blocks).toEqual([
      { type: 'text', text: 'thinking out loud' },
      { type: 'tool_use', id: 'c_1', name: 'fetch', input: { u: 'x' } },
    ]);
  });

  it('preserves malformed JSON args under __raw so the model can self-correct', () => {
    const blocks = openAiAssistantToBlocks({
      content: null,
      tool_calls: [
        { id: 'c_1', type: 'function', function: { name: 'fetch', arguments: 'not-json' } },
      ],
    });
    expect(blocks).toEqual([
      { type: 'tool_use', id: 'c_1', name: 'fetch', input: { __raw: 'not-json' } },
    ]);
  });

  it('returns an empty array when content is null/empty and there are no tool_calls', () => {
    expect(openAiAssistantToBlocks({ content: null })).toEqual([]);
    expect(openAiAssistantToBlocks({ content: '' })).toEqual([]);
  });
});

describe('openai provider — normaliseFinishReason', () => {
  it.each([
    ['stop', 'end_turn'],
    ['tool_calls', 'tool_use'],
    ['function_call', 'tool_use'],
    ['length', 'max_tokens'],
    ['content_filter', 'other'],
    [undefined, 'other'],
  ])('maps %s → %s', (input, expected) => {
    expect(normaliseFinishReason(input)).toBe(expected);
  });
});

// ── runTurn integration via fake fetch ──────────────────────

describe('openai provider — runTurn', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-test-key';
  });
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('builds the request body, sets bearer auth, parses response, returns canonical result', async () => {
    let capturedReq: { url: string; init: RequestInit } | null = null;
    const fakeFetch: typeof fetch = async (url, init) => {
      capturedReq = { url: String(url), init: init! };
      const body: Record<string, unknown> = {
        choices: [
          {
            message: { content: 'pong', tool_calls: undefined },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 11, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 2 } },
      };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const provider = makeOpenAiProvider({ fetchImpl: fakeFetch });
    const result = await provider.runTurn({
      model: 'gpt-4o-mini',
      system: 'be helpful',
      messages: [
        { message_idx: 0, role: 'user', content_blocks: [{ type: 'text', text: 'ping' }],
          tokens_in: null, tokens_out: null, tokens_cache_read: null, tokens_cache_create: null, model: null },
      ],
      tools: [],
      max_tokens: 100,
      signal: new AbortController().signal,
    });

    expect(capturedReq).not.toBeNull();
    expect(capturedReq!.url).toBe('https://api.openai.com/v1/chat/completions');
    const headers = capturedReq!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test-key');
    const sentBody = JSON.parse(capturedReq!.init.body as string);
    expect(sentBody.model).toBe('gpt-4o-mini');
    expect(sentBody.messages[0]).toEqual({ role: 'system', content: 'be helpful' });
    expect(sentBody.messages[1]).toEqual({ role: 'user', content: 'ping' });

    expect(result.content_blocks).toEqual([{ type: 'text', text: 'pong' }]);
    expect(result.usage.input_tokens).toBe(11);
    expect(result.usage.output_tokens).toBe(3);
    expect(result.usage.cache_read_input_tokens).toBe(2);
    expect(result.stop_reason).toBe('end_turn');
  });

  it('surfaces non-OK responses as ProviderHttpError with the status', async () => {
    const fakeFetch: typeof fetch = async () => {
      return new Response('rate limited', { status: 429 });
    };
    const provider = makeOpenAiProvider({ fetchImpl: fakeFetch });
    await expect(
      provider.runTurn({
        model: 'gpt-4o',
        system: 'x',
        messages: [{ message_idx: 0, role: 'user', content_blocks: [{ type: 'text', text: 'hi' }],
          tokens_in: null, tokens_out: null, tokens_cache_read: null, tokens_cache_create: null, model: null }],
        tools: [],
        max_tokens: 10,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(ProviderHttpError);
  });

  it('throws ProviderHttpError when auth env var is missing', async () => {
    delete process.env.OPENAI_API_KEY;
    const provider = makeOpenAiProvider({});
    await expect(
      provider.runTurn({
        model: 'gpt-4o',
        system: 'x',
        messages: [{ message_idx: 0, role: 'user', content_blocks: [{ type: 'text', text: 'hi' }],
          tokens_in: null, tokens_out: null, tokens_cache_read: null, tokens_cache_create: null, model: null }],
        tools: [],
        max_tokens: 10,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/OPENAI_API_KEY env var not set/);
  });
});

// ── Custom-endpoint env config ──────────────────────────────

describe('custom providers — loadCustomProvidersFromEnv', () => {
  let saved: Provider[] = [];
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env.SOMA_API_CUSTOM_PROVIDERS;
    saved = listProviders().map((n) => getProvider(n)!).filter(Boolean);
    resetProviderRegistryForTests();
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.SOMA_API_CUSTOM_PROVIDERS;
    else process.env.SOMA_API_CUSTOM_PROVIDERS = prevEnv;
    resetProviderRegistryForTests();
    for (const p of saved) registerProvider(p);
  });

  it('returns no-ops when env var is unset or empty', () => {
    delete process.env.SOMA_API_CUSTOM_PROVIDERS;
    expect(loadCustomProvidersFromEnv()).toEqual({ registered: [], errors: [] });

    process.env.SOMA_API_CUSTOM_PROVIDERS = '   ';
    expect(loadCustomProvidersFromEnv()).toEqual({ registered: [], errors: [] });
  });

  it('reports parse errors without crashing', () => {
    process.env.SOMA_API_CUSTOM_PROVIDERS = 'not-json';
    const r = loadCustomProvidersFromEnv();
    expect(r.registered).toEqual([]);
    expect(r.errors[0]).toMatch(/not valid JSON/);
  });

  it('rejects when root is not an array', () => {
    process.env.SOMA_API_CUSTOM_PROVIDERS = '{"name":"x"}';
    const r = loadCustomProvidersFromEnv();
    expect(r.errors[0]).toMatch(/root must be a JSON array/);
  });

  it('validates required fields per entry', () => {
    process.env.SOMA_API_CUSTOM_PROVIDERS = JSON.stringify([
      {},
      { name: 'a', base_url: 'gopher://broken', auth_env_var: 'X' },
      { name: 'b', base_url: 'https://ok', auth_env_var: '' },
      { name: 'c', base_url: 'https://ok', auth_env_var: 'C_KEY', auth_header: 42 },
    ]);
    const r = loadCustomProvidersFromEnv();
    expect(r.registered).toEqual([]);
    expect(r.errors).toHaveLength(4);
    expect(r.errors[0]).toMatch(/'name' must be a non-empty string/);
    expect(r.errors[1]).toMatch(/'base_url' must be an http\(s\) URL/);
    expect(r.errors[2]).toMatch(/'auth_env_var' must be a non-empty string/);
    expect(r.errors[3]).toMatch(/'auth_header' must be a string/);
  });

  it('registers a valid entry and uses its config when runTurn fires', async () => {
    process.env.SOMA_API_CUSTOM_PROVIDERS = JSON.stringify([
      {
        name: 'openrouter',
        base_url: 'https://openrouter.ai/api/v1',
        auth_env_var: 'OPENROUTER_API_KEY',
        extra_headers: { 'HTTP-Referer': 'https://soma.local' },
      },
    ]);
    const r = loadCustomProvidersFromEnv();
    expect(r.errors).toEqual([]);
    expect(r.registered).toEqual(['openrouter']);

    const provider = getProvider('openrouter');
    expect(provider).toBeDefined();

    // Cannot call runTurn end-to-end without re-injecting fetch — but we
    // can confirm the rateKey and that missing env raises the expected
    // ProviderHttpError.
    expect(provider!.rateKey()).toBe('openrouter:chat');
    delete process.env.OPENROUTER_API_KEY;
    await expect(
      provider!.runTurn({
        model: 'anthropic/claude-sonnet-4-6',
        system: 's',
        messages: [{ message_idx: 0, role: 'user', content_blocks: [{ type: 'text', text: 'hi' }],
          tokens_in: null, tokens_out: null, tokens_cache_read: null, tokens_cache_create: null, model: null }],
        tools: [],
        max_tokens: 10,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/OPENROUTER_API_KEY env var not set/);
  });

  it('refuses duplicate provider names already in the registry', () => {
    // Register a provider, then try to load custom config that names it.
    registerProvider({ name: 'collider', rateKey: () => 'k', async runTurn() { throw new Error(); } });
    process.env.SOMA_API_CUSTOM_PROVIDERS = JSON.stringify([
      { name: 'collider', base_url: 'https://x', auth_env_var: 'X' },
    ]);
    const r = loadCustomProvidersFromEnv();
    expect(r.registered).toEqual([]);
    expect(r.errors[0]).toMatch(/already registered/);
  });
});
