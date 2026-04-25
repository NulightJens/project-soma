/**
 * API engine — Provider abstraction.
 *
 * The 'api' engine runs the multi-turn-with-tools loop with crash-resumable
 * replay. Per ADR-012, only the HTTP call differs across providers — loop,
 * persistence, and replay are provider-neutral. This file defines the seam
 * across that boundary.
 *
 * Storage uses Anthropic's `MessageParam`-shape blocks as the canonical
 * internal representation (see `SubagentContentBlock` in types.ts) because
 * it's a strict superset of the conversation primitives we need. Each
 * provider knows how to translate between this canonical shape and its
 * native API on the way out and back.
 */

import type {
  InboxMessage,
  SubagentContentBlock,
  SubagentMessage,
} from '../../../types.js';

// ── Tool definitions (provider-neutral) ─────────────────────

/**
 * Provider-neutral tool definition. The full registry lands with commit (c);
 * this minimal shape is what providers consume — name, description,
 * JSON-Schema input shape, idempotency hint for replay, and the executor
 * the loop calls when the model emits a tool_use block.
 */
export interface ApiToolDef {
  name: string;
  description: string;
  /** JSON Schema (Draft-7) describing the tool's input. */
  input_schema: Record<string, unknown>;
  /**
   * If true, replay is allowed to re-run a 'pending' tool execution row
   * after a crash. If false, a pending row on resume aborts the run with
   * a clear error — the operator must decide whether to retry by hand.
   */
  idempotent: boolean;
  execute(input: unknown, ctx: ApiToolContext): Promise<unknown>;
}

/** Context handed to tool executors. Keeps tools thin and engine-agnostic. */
export interface ApiToolContext {
  jobId: number;
  signal: AbortSignal;
  /**
   * Read the calling job's inbox (token-fenced). Wired by the loop from
   * MinionJobContext.readInbox so tools never see the lock token directly.
   */
  readOwnInbox(): Promise<InboxMessage[]>;
}

// ── Provider seam ───────────────────────────────────────────

/**
 * One LLM turn. The loop hands the full conversation + tool list; the
 * provider returns the assistant's reply blocks + token usage + a stop
 * reason. Tool dispatch and persistence happen in the loop, not the
 * provider — providers stay HTTP-only.
 */
export interface ProviderTurnRequest {
  model: string;
  system: string;
  /** Conversation so far, as canonical (Anthropic-shape) blocks. */
  messages: SubagentMessage[];
  tools: ApiToolDef[];
  max_tokens: number;
  /** Combined ctx.signal + ctx.shutdownSignal. */
  signal: AbortSignal;
}

export interface ProviderTurnUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export type ProviderStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'other';

export interface ProviderTurnResult {
  /** Provider's reply, normalised to canonical blocks. */
  content_blocks: SubagentContentBlock[];
  usage: ProviderTurnUsage;
  stop_reason: ProviderStopReason;
}

/**
 * Provider — the only thing that crosses the API boundary. Implementations
 * own all SDK / HTTP concerns. The loop knows nothing about Anthropic vs
 * OpenAI vs custom endpoints.
 */
export interface Provider {
  readonly name: string;
  /**
   * Stable identifier for the rate-lease key. The loop acquires
   * `engine.acquireLock(`api:${rateKey}`, ...)` around each turn so a
   * misbehaving provider can't blow past the per-provider concurrency cap.
   */
  rateKey(): string;
  /** One LLM turn. Throws ProviderHttpError on retryable transport errors. */
  runTurn(req: ProviderTurnRequest): Promise<ProviderTurnResult>;
}

// ── Errors ──────────────────────────────────────────────────

/**
 * Retryable provider error — network / 5xx / 429. The loop catches and
 * lets the worker re-claim the job with backoff. Non-retryable errors
 * (400 / 401 / 403) should throw `UnrecoverableError` instead.
 */
export class ProviderHttpError extends Error {
  constructor(
    public provider: string,
    public status: number | null,
    message: string,
  ) {
    super(`provider ${provider}: ${message}`);
    this.name = 'ProviderHttpError';
  }
}
