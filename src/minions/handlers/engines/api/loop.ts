/**
 * API engine — provider-neutral multi-turn loop with crash-resumable replay.
 *
 * Ported from gbrain `src/core/minions/handlers/subagent.ts` (MIT © Garry
 * Tan). SOMA adaptations annotated with `// SOMA:`.
 *
 * Major deviations from the original:
 *   - Storage flows through `subagent.*` (job-scoped MinionQueue helpers)
 *     instead of inline `engine.executeRaw`. Same SQL semantics; the SQL
 *     itself lives in queue.ts per ADR-012.
 *   - Anthropic-SDK usage replaced with the `Provider` seam — the loop
 *     never sees the SDK. Anthropic provider is the default; OpenAI-
 *     compatible + custom-endpoint providers register themselves later
 *     (commit (b)).
 *   - Rate leases use `engine.acquireLock(api:<rateKey>, timeoutMs)`
 *     (already in SOMA) instead of gbrain's separate `subagent_rate_leases`
 *     table. Same effective behaviour: bounded concurrency per provider.
 *   - Per-turn `ctx.log({type:'llm_turn', ...})` + `ctx.log({type:'tool_call', ...})`
 *     transcript entries match the subscription-engine convention so the
 *     dashboard surfaces both engines uniformly.
 *   - Tool registry deferred to commit (c). For this commit, the loop
 *     accepts an optional explicit tool list from the caller; if absent,
 *     runs without tools (pure-prompt agents).
 */

import type { QueueEngine } from '../../../engine.js';
import type {
  MinionJobContext,
  SubagentContentBlock,
  SubagentMessage,
  SubagentToolExec,
} from '../../../types.js';
import { UnrecoverableError } from '../../../types.js';
import type { RunnerResult } from '../../registry.js';
import { getProvider } from './providers/index.js';
import { getDefaultTools } from './tools/registry.js';
import { ProviderHttpError, type ApiToolDef, type Provider } from './types.js';

// ── Defaults ────────────────────────────────────────────────

export const DEFAULT_MODEL = 'claude-sonnet-4-6';
export const DEFAULT_MAX_TURNS = 20;
export const DEFAULT_MAX_TOKENS = 4096;
export const DEFAULT_SYSTEM = 'You are a helpful assistant running as a SOMA subagent.';
export const DEFAULT_PROVIDER = 'anthropic';
export const DEFAULT_LEASE_TIMEOUT_MS = 30_000;

// ── Per-job-data shape ──────────────────────────────────────

export interface ApiEngineJobData {
  prompt: string;
  /** Provider name. Defaults to `SOMA_API_DEFAULT_PROVIDER` env or `'anthropic'`. */
  provider?: string;
  model?: string;
  max_turns?: number;
  max_tokens?: number;
  system?: string;
  /** Per-job tool allow-list. When absent, the full registered tool set
   *  (built via getDefaultTools) is used. Useful for narrowing the agent's
   *  capability surface per job. */
  allowed_tools?: string[];
  /** Pre-resolved tool list — bypasses the registry. Tests use this; the
   *  production path goes through getDefaultTools(allowed_tools). */
  tools?: ApiToolDef[];
}

// ── Loop deps (injectable for tests) ────────────────────────

export interface ApiLoopDeps {
  /** QueueEngine — used for `acquireLock(...)` rate leases around each turn. */
  engine: QueueEngine;
  /** Provider lookup. Default: registry getProvider. */
  resolveProvider?: (name: string) => Provider | undefined;
  /** Lease timeout ms. */
  leaseTimeoutMs?: number;
}

// ── Public entrypoint ───────────────────────────────────────

export async function runApiLoop(
  ctx: MinionJobContext,
  deps: ApiLoopDeps,
): Promise<RunnerResult> {
  const t0 = Date.now();
  const data = (ctx.data ?? {}) as unknown as ApiEngineJobData;
  if (!data.prompt || typeof data.prompt !== 'string' || data.prompt.length === 0) {
    throw new UnrecoverableError("api: data.prompt is required (non-empty string)");
  }

  if (!ctx.subagent) {
    throw new UnrecoverableError(
      'api: ctx.subagent is required. The MinionWorker wires it; if you reached ' +
        'this from a hand-rolled ctx, build a stub via subagent: { ... } satisfying SubagentApi.',
    );
  }
  const subagent = ctx.subagent;

  const providerName = data.provider ?? process.env.SOMA_API_DEFAULT_PROVIDER ?? DEFAULT_PROVIDER;
  const resolveProvider = deps.resolveProvider ?? getProvider;
  const provider = resolveProvider(providerName);
  if (!provider) {
    throw new UnrecoverableError(
      `api: unknown provider '${providerName}'. ` +
        `Set data.provider to one of the registered providers, or SOMA_API_DEFAULT_PROVIDER.`,
    );
  }

  const model = data.model ?? DEFAULT_MODEL;
  const maxTurns = data.max_turns ?? DEFAULT_MAX_TURNS;
  const maxTokens = data.max_tokens ?? DEFAULT_MAX_TOKENS;
  const system = data.system ?? DEFAULT_SYSTEM;
  // Resolution order: explicit data.tools (tests / advanced) →
  // registry's default factories filtered by allowed_tools → empty list.
  const tools: ApiToolDef[] = data.tools ?? getDefaultTools({ allowed: data.allowed_tools });
  const leaseTimeoutMs = deps.leaseTimeoutMs ?? DEFAULT_LEASE_TIMEOUT_MS;
  const rateKey = `api:${provider.rateKey()}`;

  // ── Replay: rebuild conversation from persisted state ─────
  const persisted = await subagent.loadMessages();
  const priorTools = await subagent.loadToolExecs();
  const priorToolByUseId = new Map(priorTools.map((t) => [t.tool_use_id, t]));

  let messages: SubagentMessage[];
  let nextMessageIdx: number;

  if (persisted.length === 0) {
    // First run: persist seed user message.
    const seed: SubagentMessage = {
      message_idx: 0,
      role: 'user',
      content_blocks: [{ type: 'text', text: data.prompt }],
      tokens_in: null,
      tokens_out: null,
      tokens_cache_read: null,
      tokens_cache_create: null,
      model: null,
    };
    await subagent.appendMessage(seed);
    messages = [seed];
    nextMessageIdx = 1;
  } else {
    messages = persisted;
    nextMessageIdx = persisted.length;
  }

  // Token rollup from prior turns.
  const tokenTotals = { in: 0, out: 0, cache_read: 0, cache_create: 0 };
  let assistantTurns = 0;
  for (const m of persisted) {
    tokenTotals.in += m.tokens_in ?? 0;
    tokenTotals.out += m.tokens_out ?? 0;
    tokenTotals.cache_read += m.tokens_cache_read ?? 0;
    tokenTotals.cache_create += m.tokens_cache_create ?? 0;
    if (m.role === 'assistant') assistantTurns++;
  }

  // Replay reconciliation: if the last persisted message is an assistant
  // with tool_use blocks AND no synthesised user follow-up exists, finish
  // those tools now so the next provider call sees a consistent state.
  const last = messages[messages.length - 1];
  if (last && last.role === 'assistant') {
    const pendingUses = last.content_blocks.filter(
      (b): b is Extract<SubagentContentBlock, { type: 'tool_use' }> => b.type === 'tool_use',
    );
    if (pendingUses.length > 0) {
      const synthesised: SubagentContentBlock[] = [];
      for (const use of pendingUses) {
        const result = await reconcileTool(
          ctx, subagent, last.message_idx, use, tools, priorToolByUseId,
        );
        synthesised.push(result);
      }
      const userIdx = nextMessageIdx++;
      const userMsg: SubagentMessage = {
        message_idx: userIdx,
        role: 'user',
        content_blocks: synthesised,
        tokens_in: null,
        tokens_out: null,
        tokens_cache_read: null,
        tokens_cache_create: null,
        model: null,
      };
      await subagent.appendMessage(userMsg);
      messages.push(userMsg);
    }
  }

  // ── Main loop ────────────────────────────────────────────
  let stopReason: string = 'error';
  let finalText = '';
  const transcriptToolCalls: { tool: string; input: unknown; output?: string }[] = [];

  while (true) {
    if (assistantTurns >= maxTurns) {
      stopReason = 'max_turns';
      break;
    }
    if (ctx.signal.aborted || ctx.shutdownSignal.aborted) {
      throw new Error('api: aborted before turn');
    }

    // Rate lease around the outbound call. acquireLock throws if it can't
    // get the lease within timeoutMs — the worker handles re-claim with
    // backoff. SOMA: gbrain has a separate subagent_rate_leases table; we
    // reuse the existing minion_rate_leases advisory-lock surface.
    const releaseLease = await deps.engine.acquireLock(rateKey, leaseTimeoutMs);
    let providerResult;
    try {
      providerResult = await provider.runTurn({
        model,
        system,
        messages,
        tools,
        max_tokens: maxTokens,
        signal: mergeSignals(ctx.signal, ctx.shutdownSignal),
      });
    } catch (err) {
      await releaseLease().catch(() => {});
      if (err instanceof ProviderHttpError) {
        // 4xx (other than 408/429) is unrecoverable — config / auth /
        // bad request. 5xx + 408 + 429 + transport error → retry.
        const status = err.status ?? 0;
        const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
        if (!retryable) {
          throw new UnrecoverableError(`api provider ${err.provider}: HTTP ${status} — ${err.message}`);
        }
      }
      throw err;
    }
    await releaseLease().catch(() => {});

    const usage = providerResult.usage;
    tokenTotals.in += usage.input_tokens;
    tokenTotals.out += usage.output_tokens;
    tokenTotals.cache_read += usage.cache_read_input_tokens;
    tokenTotals.cache_create += usage.cache_creation_input_tokens;

    await ctx.updateTokens({
      input: usage.input_tokens,
      output: usage.output_tokens,
      cache_read: usage.cache_read_input_tokens,
    });
    await ctx.log({
      type: 'llm_turn',
      model,
      tokens_in: usage.input_tokens,
      tokens_out: usage.output_tokens,
      ts: new Date().toISOString(),
    });

    // Persist assistant message BEFORE tool dispatch so a crash mid-tool
    // sees a consistent conversation on resume.
    const assistantIdx = nextMessageIdx++;
    const assistantMsg: SubagentMessage = {
      message_idx: assistantIdx,
      role: 'assistant',
      content_blocks: providerResult.content_blocks,
      tokens_in: usage.input_tokens,
      tokens_out: usage.output_tokens,
      tokens_cache_read: usage.cache_read_input_tokens,
      tokens_cache_create: usage.cache_creation_input_tokens,
      model,
    };
    await subagent.appendMessage(assistantMsg);
    messages.push(assistantMsg);
    assistantTurns++;

    const toolUses = providerResult.content_blocks.filter(
      (b): b is Extract<SubagentContentBlock, { type: 'tool_use' }> => b.type === 'tool_use',
    );
    if (toolUses.length === 0) {
      stopReason = providerResult.stop_reason === 'tool_use' ? 'end_turn' : providerResult.stop_reason;
      finalText = providerResult.content_blocks
        .filter((b): b is Extract<SubagentContentBlock, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      break;
    }

    // Dispatch tools. Two-phase persist (pending → complete/failed).
    const toolResults: SubagentContentBlock[] = [];
    for (const use of toolUses) {
      if (ctx.signal.aborted || ctx.shutdownSignal.aborted) {
        throw new Error('api: aborted during tool dispatch');
      }
      const def = tools.find((t) => t.name === use.name);
      if (!def) {
        await subagent.markToolExecFailed({
          message_idx: assistantIdx,
          tool_use_id: use.id,
          tool_name: use.name,
          input: use.input,
          error: `tool "${use.name}" is not in the registry for this subagent`,
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: `tool "${use.name}" is not available`,
          is_error: true,
        });
        continue;
      }

      // Replay: trust prior settled rows verbatim.
      const prior = priorToolByUseId.get(use.id);
      if (prior?.status === 'complete') {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: stringify(prior.output),
        });
        continue;
      }
      if (prior?.status === 'failed') {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: prior.error ?? 'tool failed',
          is_error: true,
        });
        continue;
      }
      if (prior?.status === 'pending' && !def.idempotent) {
        throw new UnrecoverableError(
          `api: non-idempotent tool "${use.name}" pending on resume; cannot safely re-run`,
        );
      }

      // Fresh dispatch (or idempotent replay).
      await subagent.appendToolExecPending({
        message_idx: assistantIdx,
        tool_use_id: use.id,
        tool_name: use.name,
        input: use.input,
      });
      const argsSize = JSON.stringify(use.input ?? {}).length;
      try {
        const output = await def.execute(use.input, makeToolCtx(ctx));
        await subagent.markToolExecComplete({ tool_use_id: use.id, output });
        const outStr = stringify(output);
        await ctx.log({
          type: 'tool_call',
          tool: use.name,
          args_size: argsSize,
          result_size: outStr.length,
          ts: new Date().toISOString(),
        });
        transcriptToolCalls.push({ tool: use.name, input: use.input, output: outStr });
        toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: outStr });
      } catch (e) {
        const errText = e instanceof Error ? (e.stack ?? e.message) : String(e);
        await subagent.markToolExecFailed({
          message_idx: assistantIdx,
          tool_use_id: use.id,
          tool_name: use.name,
          input: use.input,
          error: errText,
        });
        await ctx.log({
          type: 'tool_call',
          tool: use.name,
          args_size: argsSize,
          result_size: errText.length,
          ts: new Date().toISOString(),
        });
        transcriptToolCalls.push({ tool: use.name, input: use.input, output: errText });
        toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: errText, is_error: true });
      }
    }

    // Append the synthesised user turn so replay picks it up consistently.
    const userIdx = nextMessageIdx++;
    const userMsg: SubagentMessage = {
      message_idx: userIdx,
      role: 'user',
      content_blocks: toolResults,
      tokens_in: null,
      tokens_out: null,
      tokens_cache_read: null,
      tokens_cache_create: null,
      model: null,
    };
    await subagent.appendMessage(userMsg);
    messages.push(userMsg);
  }

  return {
    engine: 'api',
    result: finalText,
    transcript: messages.map((m) => ({
      message_idx: m.message_idx,
      role: m.role,
      content_blocks: m.content_blocks,
    })),
    tool_calls: transcriptToolCalls,
    cost_usd: 0,
    tokens: {
      input: tokenTotals.in,
      output: tokenTotals.out,
      cache_read: tokenTotals.cache_read,
      cache_create: tokenTotals.cache_create,
    },
    turns_used: assistantTurns,
    exit_reason: stopReason,
    duration_ms: Date.now() - t0,
  };
}

// ── Helpers ─────────────────────────────────────────────────

async function reconcileTool(
  ctx: MinionJobContext,
  subagent: NonNullable<MinionJobContext['subagent']>,
  messageIdx: number,
  use: { id: string; name: string; input: unknown },
  tools: ApiToolDef[],
  priorToolByUseId: Map<string, SubagentToolExec>,
): Promise<SubagentContentBlock> {
  const prior = priorToolByUseId.get(use.id);
  if (prior?.status === 'complete') {
    return { type: 'tool_result', tool_use_id: use.id, content: stringify(prior.output) };
  }
  if (prior?.status === 'failed') {
    return {
      type: 'tool_result',
      tool_use_id: use.id,
      content: prior.error ?? 'tool failed',
      is_error: true,
    };
  }
  const def = tools.find((t) => t.name === use.name);
  if (!def) {
    await subagent.markToolExecFailed({
      message_idx: messageIdx,
      tool_use_id: use.id,
      tool_name: use.name,
      input: use.input,
      error: `tool "${use.name}" is not in the registry for this subagent`,
    });
    return {
      type: 'tool_result',
      tool_use_id: use.id,
      content: `tool "${use.name}" is not available`,
      is_error: true,
    };
  }
  if (prior?.status === 'pending' && !def.idempotent) {
    throw new UnrecoverableError(
      `api: non-idempotent tool "${use.name}" pending on resume; cannot safely re-run`,
    );
  }
  await subagent.appendToolExecPending({
    message_idx: messageIdx,
    tool_use_id: use.id,
    tool_name: use.name,
    input: use.input,
  });
  try {
    const output = await def.execute(use.input, makeToolCtx(ctx));
    await subagent.markToolExecComplete({ tool_use_id: use.id, output });
    return { type: 'tool_result', tool_use_id: use.id, content: stringify(output) };
  } catch (e) {
    const errText = e instanceof Error ? (e.stack ?? e.message) : String(e);
    await subagent.markToolExecFailed({
      message_idx: messageIdx,
      tool_use_id: use.id,
      tool_name: use.name,
      input: use.input,
      error: errText,
    });
    return { type: 'tool_result', tool_use_id: use.id, content: errText, is_error: true };
  }
}

function makeToolCtx(ctx: MinionJobContext): import('./types.js').ApiToolContext {
  return {
    jobId: ctx.id,
    signal: ctx.signal,
    readOwnInbox: () => ctx.readInbox(),
  };
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  // SOMA: AbortSignal.any is Node ≥ 20.10. We require Node ≥ 20 in
  // package.json; the manual fallback is kept for older 20.x patch versions.
  const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === 'function') return anyFn([a, b]);
  const ac = new AbortController();
  if (a.aborted || b.aborted) ac.abort();
  else {
    a.addEventListener('abort', () => ac.abort(), { once: true });
    b.addEventListener('abort', () => ac.abort(), { once: true });
  }
  return ac.signal;
}
