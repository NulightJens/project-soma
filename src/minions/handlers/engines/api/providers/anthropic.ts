/**
 * Anthropic provider — Messages API via @anthropic-ai/sdk.
 *
 * Converts SOMA's canonical `SubagentContentBlock` (Anthropic-shape, by
 * design) to/from the SDK's `MessageParam` and `Message` shapes. Cache
 * markers on system + last-tool keep prompt-cache hit rate high (matches
 * gbrain's pattern).
 *
 * Lazy SDK import: we don't pull `@anthropic-ai/sdk` at module load so
 * tests / installations without the dep can still load this module. The
 * import resolves when `runTurn()` first runs without an injected client.
 */

import type {
  Provider,
  ProviderTurnRequest,
  ProviderTurnResult,
  ProviderTurnUsage,
  ProviderStopReason,
} from '../types.js';
import { ProviderHttpError } from '../types.js';
import type { SubagentContentBlock } from '../../../../types.js';
import { registerProvider } from './registry.js';

// ── Minimal structural type for the SDK surface we use ──────
//
// The real `Anthropic.Messages` object satisfies this. Tests can supply
// a hand-rolled object that implements the same shape — no SDK dep
// required for the unit tests.

export interface AnthropicMessagesClient {
  create(
    params: AnthropicCreateParams,
    opts?: { signal?: AbortSignal },
  ): Promise<AnthropicMessage>;
}

interface AnthropicCreateParams {
  model: string;
  max_tokens: number;
  system?: unknown;
  messages: Array<{ role: 'user' | 'assistant'; content: unknown }>;
  tools?: unknown;
}

interface AnthropicMessage {
  content: Array<Record<string, unknown>>;
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

// ── Factory ─────────────────────────────────────────────────

export interface AnthropicProviderDeps {
  /** Inject for tests. Default: lazy `new Anthropic().messages` at first call. */
  client?: AnthropicMessagesClient;
  /** Override for tests. Default: reads from `process.env.ANTHROPIC_API_KEY`. */
  apiKey?: string;
  /** Provider name for the registry. Defaults to `'anthropic'`. */
  name?: string;
  /** Rate-lease key. Defaults to `'anthropic:messages'`. */
  rateKey?: string;
  /** Late-bound client constructor — overridable in tests so the lazy import
   *  branch can be exercised without the real SDK. */
  makeClient?: () => Promise<AnthropicMessagesClient>;
}

export function makeAnthropicProvider(deps: AnthropicProviderDeps = {}): Provider {
  const name = deps.name ?? 'anthropic';
  const rateKey = deps.rateKey ?? 'anthropic:messages';
  let cached = deps.client ?? null;
  const makeClient =
    deps.makeClient ??
    (async () => {
      // SOMA: lazy import keeps the SDK out of the load graph for tests
      // and for installations that only use the subscription engine.
      const mod = (await import('@anthropic-ai/sdk')) as unknown as {
        default?: new (opts?: { apiKey?: string }) => { messages: AnthropicMessagesClient };
        Anthropic?: new (opts?: { apiKey?: string }) => { messages: AnthropicMessagesClient };
      };
      const Ctor = mod.default ?? mod.Anthropic;
      if (!Ctor) {
        throw new ProviderHttpError(
          name,
          null,
          '@anthropic-ai/sdk did not export a default constructor',
        );
      }
      const client = new Ctor(deps.apiKey ? { apiKey: deps.apiKey } : undefined);
      return client.messages;
    });

  return {
    name,
    rateKey: () => rateKey,
    async runTurn(req: ProviderTurnRequest): Promise<ProviderTurnResult> {
      if (!cached) cached = await makeClient();
      const params: AnthropicCreateParams = {
        model: req.model,
        max_tokens: req.max_tokens,
        system: [
          { type: 'text', text: req.system, cache_control: { type: 'ephemeral' } },
        ],
        messages: req.messages.map((m) => ({
          role: m.role,
          content: m.content_blocks,
        })),
      };
      if (req.tools.length > 0) {
        params.tools = req.tools.map((t, i) => {
          const def: Record<string, unknown> = {
            name: t.name,
            description: t.description,
            input_schema: t.input_schema,
          };
          // Cache-everything-up-to-this-block — only mark the LAST tool.
          if (i === req.tools.length - 1) def.cache_control = { type: 'ephemeral' };
          return def;
        });
      }

      let resp: AnthropicMessage;
      try {
        resp = await cached.create(params, { signal: req.signal });
      } catch (err) {
        // Surface as ProviderHttpError so the loop can decide retryable
        // vs unrecoverable. SDK error class isn't typed here (lazy import);
        // structural sniff for `status` is good enough.
        const status = (err as { status?: number }).status ?? null;
        const message = err instanceof Error ? err.message : String(err);
        throw new ProviderHttpError(name, status, message);
      }

      const usage: ProviderTurnUsage = {
        input_tokens: resp.usage?.input_tokens ?? 0,
        output_tokens: resp.usage?.output_tokens ?? 0,
        cache_read_input_tokens: resp.usage?.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: resp.usage?.cache_creation_input_tokens ?? 0,
      };

      return {
        content_blocks: normaliseBlocks(resp.content),
        usage,
        stop_reason: normaliseStopReason(resp.stop_reason),
      };
    },
  };
}

// ── Block normalisation ─────────────────────────────────────

/**
 * Convert Anthropic's response content array into canonical
 * SubagentContentBlock[]. The shapes overlap heavily — Anthropic uses the
 * same field names (`type`, `text`, `id`, `name`, `input`, `tool_use_id`,
 * `content`, `is_error`) — so this is mostly a structural pass-through
 * with a defensive type guard.
 */
function normaliseBlocks(blocks: Array<Record<string, unknown>>): SubagentContentBlock[] {
  const out: SubagentContentBlock[] = [];
  for (const b of blocks) {
    const type = b.type;
    if (type === 'text' && typeof b.text === 'string') {
      out.push({ type: 'text', text: b.text });
    } else if (type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') {
      out.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input ?? {} });
    } else if (type === 'tool_result' && typeof b.tool_use_id === 'string') {
      out.push({
        type: 'tool_result',
        tool_use_id: b.tool_use_id,
        content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? ''),
        is_error: typeof b.is_error === 'boolean' ? b.is_error : undefined,
      });
    }
    // Unknown block types (thinking, etc.) silently dropped — they don't
    // affect the loop's tool-dispatch + termination logic. Add typed cases
    // here if/when we want to surface them in the transcript.
  }
  return out;
}

function normaliseStopReason(reason: string | undefined): ProviderStopReason {
  switch (reason) {
    case 'end_turn':
    case 'tool_use':
    case 'max_tokens':
    case 'stop_sequence':
      return reason;
    default:
      return 'other';
  }
}

// Auto-register on module load. Other call sites can register a different
// Anthropic-flavoured provider (e.g. with a fixed-key client for testing)
// by calling `registerProvider(makeAnthropicProvider({ name: 'anthropic-test', ... }))`.
registerProvider(makeAnthropicProvider());

export type { AnthropicCreateParams, AnthropicMessage };
