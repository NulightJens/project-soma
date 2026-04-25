/**
 * OpenAI-compatible provider — covers OpenAI itself plus every "OpenAI-shape"
 * endpoint: OpenRouter, Together, Groq, Mistral, Anyscale, Perplexity, and
 * local servers (Ollama, vLLM, LM Studio, llama.cpp). They all speak the
 * same `/v1/chat/completions` JSON.
 *
 * Implementation deliberately uses `fetch` rather than the openai npm SDK:
 *   - Keeps custom-endpoint providers (commit b's `SOMA_API_CUSTOM_PROVIDERS`
 *     env-config) free of an SDK pin.
 *   - One translation layer; one wire format; one HTTP path.
 *   - Same lazy-cost story as the Anthropic provider — providers don't load
 *     anything unless their runTurn() actually fires.
 *
 * Translation (canonical SubagentContentBlock ↔ OpenAI Chat Completions):
 *   - text block        ↔ string `content`
 *   - tool_use block    ↔ assistant.tool_calls[].function (name + JSON args)
 *   - tool_result block ↔ separate `role: "tool"` message with tool_call_id
 *
 * Note on multi-message split: a single canonical user message may contain
 * multiple tool_result blocks. OpenAI requires one tool message per result,
 * so the translator splits them. Order is preserved.
 */

import type {
  Provider,
  ProviderTurnRequest,
  ProviderTurnResult,
  ProviderTurnUsage,
  ProviderStopReason,
} from '../types.js';
import { ProviderHttpError } from '../types.js';
import type { SubagentContentBlock, SubagentMessage } from '../../../../types.js';
import { registerProvider } from './registry.js';

// ── Wire-format types (subset we use) ───────────────────────

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

interface OpenAiChatRequest {
  model: string;
  max_tokens?: number;
  messages: OpenAiMessage[];
  tools?: Array<{
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }>;
}

interface OpenAiChatResponse {
  choices: Array<{
    message: { content: string | null; tool_calls?: OpenAiToolCall[] };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    /** Some providers expose cache stats under this name. */
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

// ── Factory ─────────────────────────────────────────────────

export interface OpenAiProviderDeps {
  /** Provider name in the registry. Defaults to `'openai'`. */
  name?: string;
  /** Rate-lease key for `engine.acquireLock(api:<rateKey>, ...)`. Defaults `'openai:chat'`. */
  rateKey?: string;
  /** Base URL for the chat completions endpoint. Defaults `https://api.openai.com/v1`. */
  baseUrl?: string;
  /** Auth header name. Defaults `'Authorization'`. */
  authHeader?: string;
  /** Format string for the auth header value. `${KEY}` replaced with the env-var value. Defaults `'Bearer ${KEY}'`. */
  authValueTemplate?: string;
  /** Env var holding the API key. Defaults `'OPENAI_API_KEY'`. */
  authEnvVar?: string;
  /** Inject for tests — overrides global fetch. */
  fetchImpl?: typeof fetch;
  /** Extra headers (e.g. OpenRouter `HTTP-Referer`). */
  extraHeaders?: Record<string, string>;
}

export function makeOpenAiProvider(deps: OpenAiProviderDeps = {}): Provider {
  const name = deps.name ?? 'openai';
  const rateKey = deps.rateKey ?? `${name}:chat`;
  const baseUrl = (deps.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const authHeader = deps.authHeader ?? 'Authorization';
  const authValueTemplate = deps.authValueTemplate ?? 'Bearer ${KEY}';
  const authEnvVar = deps.authEnvVar ?? 'OPENAI_API_KEY';
  const fetchImpl = deps.fetchImpl ?? fetch;

  return {
    name,
    rateKey: () => rateKey,
    async runTurn(req: ProviderTurnRequest): Promise<ProviderTurnResult> {
      const apiKey = process.env[authEnvVar];
      if (!apiKey) {
        throw new ProviderHttpError(
          name,
          null,
          `${authEnvVar} env var not set — cannot call provider '${name}'`,
        );
      }

      const body: OpenAiChatRequest = {
        model: req.model,
        max_tokens: req.max_tokens,
        messages: messagesToOpenAi(req.system, req.messages),
      };
      if (req.tools.length > 0) {
        body.tools = req.tools.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
          },
        }));
      }

      let resp: Response;
      try {
        resp = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [authHeader]: authValueTemplate.replace('${KEY}', apiKey),
            ...(deps.extraHeaders ?? {}),
          },
          body: JSON.stringify(body),
          signal: req.signal,
        });
      } catch (err) {
        // Network / abort / DNS — surface as retryable.
        const message = err instanceof Error ? err.message : String(err);
        throw new ProviderHttpError(name, null, message);
      }

      if (!resp.ok) {
        let detail = '';
        try {
          detail = await resp.text();
        } catch {
          /* ignore */
        }
        throw new ProviderHttpError(name, resp.status, `HTTP ${resp.status} — ${detail.slice(0, 500)}`);
      }

      let parsed: OpenAiChatResponse;
      try {
        parsed = (await resp.json()) as OpenAiChatResponse;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ProviderHttpError(name, resp.status, `invalid JSON: ${message}`);
      }

      const choice = parsed.choices?.[0];
      if (!choice) {
        throw new ProviderHttpError(name, resp.status, 'response had no choices[0]');
      }

      const usage: ProviderTurnUsage = {
        input_tokens: parsed.usage?.prompt_tokens ?? 0,
        output_tokens: parsed.usage?.completion_tokens ?? 0,
        cache_read_input_tokens: parsed.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        cache_creation_input_tokens: 0,
      };

      return {
        content_blocks: openAiAssistantToBlocks(choice.message),
        usage,
        stop_reason: normaliseFinishReason(choice.finish_reason),
      };
    },
  };
}

// ── Translation: canonical → OpenAI ─────────────────────────

function messagesToOpenAi(system: string, msgs: SubagentMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: 'system', content: system }];
  for (const msg of msgs) {
    if (msg.role === 'user') {
      // Split a user message into one role:user (text portion) plus
      // separate role:tool messages (one per tool_result block).
      const textParts: string[] = [];
      const toolParts: OpenAiMessage[] = [];
      for (const block of msg.content_blocks) {
        if (block.type === 'text') textParts.push(block.text);
        else if (block.type === 'tool_result') {
          toolParts.push({
            role: 'tool',
            tool_call_id: block.tool_use_id,
            content: block.content,
          });
        }
      }
      if (textParts.length > 0) {
        out.push({ role: 'user', content: textParts.join('\n') });
      }
      out.push(...toolParts);
    } else {
      // assistant
      const textParts: string[] = [];
      const toolCalls: OpenAiToolCall[] = [];
      for (const block of msg.content_blocks) {
        if (block.type === 'text') textParts.push(block.text);
        else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: typeof block.input === 'string'
                ? block.input
                : JSON.stringify(block.input ?? {}),
            },
          });
        }
      }
      const content = textParts.length > 0 ? textParts.join('\n') : null;
      const m: OpenAiMessage = { role: 'assistant', content };
      if (toolCalls.length > 0) m.tool_calls = toolCalls;
      out.push(m);
    }
  }
  return out;
}

// ── Translation: OpenAI → canonical ─────────────────────────

function openAiAssistantToBlocks(
  message: { content: string | null; tool_calls?: OpenAiToolCall[] },
): SubagentContentBlock[] {
  const blocks: SubagentContentBlock[] = [];
  if (message.content && message.content.length > 0) {
    blocks.push({ type: 'text', text: message.content });
  }
  if (message.tool_calls) {
    for (const call of message.tool_calls) {
      let parsedArgs: unknown = {};
      try {
        parsedArgs = JSON.parse(call.function.arguments);
      } catch {
        // Malformed JSON args — preserve the raw string so the model can
        // see what it produced and self-correct on the next turn.
        parsedArgs = { __raw: call.function.arguments };
      }
      blocks.push({
        type: 'tool_use',
        id: call.id,
        name: call.function.name,
        input: parsedArgs,
      });
    }
  }
  return blocks;
}

function normaliseFinishReason(reason: string | undefined): ProviderStopReason {
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    default:
      return 'other';
  }
}

// Auto-register the default OpenAI-flavoured provider. Custom endpoints
// register additional providers via `loadCustomProviders()` (custom.ts).
registerProvider(makeOpenAiProvider());

// Re-export translators for tests + custom.ts factory.
export { messagesToOpenAi, openAiAssistantToBlocks, normaliseFinishReason };
