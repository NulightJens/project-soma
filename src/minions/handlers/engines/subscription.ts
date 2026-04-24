/**
 * Subscription engine — spawns `claude -p` as a subprocess and streams the
 * NDJSON transcript back through ctx.log / ctx.updateTokens.
 *
 * Per ADR-008 this is SOMA's default LLM path. Uses the Claude CLI's own
 * OAuth story: macOS Keychain by default, `CLAUDE_CODE_OAUTH_TOKEN` env var
 * for headless. No Anthropic API key required; billing hits the user's
 * subscription instead of the API.
 *
 * Shutdown: subscribes to BOTH `ctx.signal` (timeout/cancel/lock-loss) and
 * `ctx.shutdownSignal` (worker SIGTERM/SIGINT). Either triggers the same
 * kill sequence — SIGTERM → 5s → SIGKILL — mirroring the shell handler.
 *
 * Env allowlist matches `src/pty/agent-pty.ts`'s allowlist (the established
 * precedent for claude spawns in this repo) plus `CLAUDE_CODE_OAUTH_TOKEN`
 * for headless auth.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type { MinionJobContext } from '../../types.js';
import { UnrecoverableError } from '../../types.js';
import {
  registerEngine,
  type RunnerEngine,
  type RunnerEngineParams,
  type RunnerResult,
  type RunnerToolCall,
  type RunnerTokens,
} from '../registry.js';

// ── Config ──────────────────────────────────────────────────

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TURNS = 20;
const KILL_GRACE_MS = 5000;

/** Env vars passed through to the `claude -p` child. Mirrors
 *  src/pty/agent-pty.ts's keepVars + CLAUDE_CODE_OAUTH_TOKEN for headless
 *  auth when Keychain isn't available. */
const CLAUDE_ENV_ALLOWLIST = [
  'PATH', 'HOME', 'USER', 'SHELL', 'TERM', 'LANG', 'LC_ALL',
  'TMPDIR', 'TEMP', 'TMP', 'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'NODE_PATH', 'COMSPEC', 'SystemRoot', 'USERPROFILE',
] as const;

// ── Event types (shape of NDJSON emitted by claude -p) ──────

export interface ClaudeAssistantBlock {
  type: 'text' | 'tool_use' | string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

export interface ClaudeAssistantEvent {
  type: 'assistant';
  message?: {
    content?: ClaudeAssistantBlock[];
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

export interface ClaudeResultEvent {
  type: 'result';
  subtype?: string;
  is_error?: boolean;
  result?: string;
  num_turns?: number;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

// ── Accumulator (pure, for testability) ─────────────────────

export interface TranscriptAccumulator {
  transcript: unknown[];
  tool_calls: RunnerToolCall[];
  assistant_turns: number;
  tokens: RunnerTokens;
  result: ClaudeResultEvent | null;
}

export function createAccumulator(): TranscriptAccumulator {
  return {
    transcript: [],
    tool_calls: [],
    assistant_turns: 0,
    tokens: { input: 0, output: 0, cache_read: 0, cache_create: 0 },
    result: null,
  };
}

/**
 * Parse one NDJSON line and fold it into the accumulator. Malformed lines
 * are silently skipped so the parser doesn't abort on a single corrupt
 * event. Pure — no I/O, no side effects.
 */
export function ingestNDJSONLine(acc: TranscriptAccumulator, line: string): TranscriptAccumulator {
  const trimmed = line.trim();
  if (!trimmed) return acc;
  let event: unknown;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return acc;
  }
  if (typeof event !== 'object' || event === null) return acc;

  acc.transcript.push(event);
  const e = event as { type?: string } & Record<string, unknown>;

  if (e.type === 'assistant') {
    const evt = e as unknown as ClaudeAssistantEvent;
    acc.assistant_turns += 1;
    const content = evt.message?.content ?? [];
    for (const item of content) {
      if (item.type === 'tool_use') {
        acc.tool_calls.push({
          tool: item.name ?? 'unknown',
          input: item.input ?? {},
        });
      }
    }
    const usage = evt.message?.usage;
    if (usage) {
      if (typeof usage.input_tokens === 'number') acc.tokens.input += usage.input_tokens;
      if (typeof usage.output_tokens === 'number') acc.tokens.output += usage.output_tokens;
      if (typeof usage.cache_read_input_tokens === 'number') {
        acc.tokens.cache_read += usage.cache_read_input_tokens;
      }
      if (typeof usage.cache_creation_input_tokens === 'number') {
        acc.tokens.cache_create += usage.cache_creation_input_tokens;
      }
    }
  }

  if (e.type === 'result') {
    acc.result = e as unknown as ClaudeResultEvent;
  }

  return acc;
}

// ── CLI arg builder (pure, for testability) ─────────────────

export function buildClaudeArgs(params: RunnerEngineParams): string[] {
  const model = (params.model as string | undefined) ?? DEFAULT_MODEL;
  const maxTurns = (params.max_turns as number | undefined) ?? DEFAULT_MAX_TURNS;
  const args: string[] = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
    '--max-turns', String(maxTurns),
    '--model', model,
  ];
  if (Array.isArray(params.allowed_tools) && params.allowed_tools.length > 0) {
    args.push('--allowed-tools', ...(params.allowed_tools as string[]));
  }
  if (typeof params.system === 'string' && params.system.length > 0) {
    args.push('--append-system-prompt', params.system);
  }
  return args;
}

// ── Env builder ─────────────────────────────────────────────

export function buildChildEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of CLAUDE_ENV_ALLOWLIST) {
    const v = process.env[key];
    if (typeof v === 'string') env[key] = v;
  }
  return env;
}

// ── Engine implementation ───────────────────────────────────

/** Allow tests to inject a fake spawner. Not exported from the runner public API. */
export interface SubscriptionDeps {
  /** Binary to spawn. Defaults to 'claude'. Tests use a fake shell script. */
  binary?: string;
  /** Override spawn env (tests). Defaults to `buildChildEnv()`. */
  envOverride?: Record<string, string>;
}

/** Factory that produces a RunnerEngine instance. Factory makes tests easy:
 *  a test can construct its own instance pointed at a fake binary and
 *  register it under a different name without touching the module-global
 *  registry. */
export function makeSubscriptionEngine(deps: SubscriptionDeps = {}): RunnerEngine {
  const binary = deps.binary ?? 'claude';
  return {
    name: 'subscription',
    async run(ctx: MinionJobContext, params: RunnerEngineParams): Promise<RunnerResult> {
      if (typeof params.prompt !== 'string' || params.prompt.length === 0) {
        throw new UnrecoverableError('subscription: prompt is required');
      }
      const args = buildClaudeArgs(params);
      const env = deps.envOverride ?? buildChildEnv();
      const cwd = (typeof params.cwd === 'string' && params.cwd.length > 0) ? params.cwd : process.cwd();
      const startedAt = Date.now();

      let proc: ChildProcess;
      try {
        proc = spawn(binary, args, {
          cwd,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        throw err instanceof Error ? err : new Error(String(err));
      }

      // Pipe prompt via stdin — avoids shell escaping issues entirely.
      try {
        proc.stdin?.write(params.prompt);
        proc.stdin?.end();
      } catch {
        // stdin may be unavailable if the process died instantly; fall through
        // to the exit handler which will surface the error.
      }

      const acc = createAccumulator();

      // Stdout: NDJSON line-by-line. We buffer partial lines.
      let stdoutBuf = '';
      proc.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString('utf8');
        // Split on newline, keeping the trailing partial line in the buffer.
        const parts = stdoutBuf.split('\n');
        stdoutBuf = parts.pop() ?? '';
        for (const line of parts) {
          if (!line.trim()) continue;
          const preIngestTurns = acc.assistant_turns;
          const preIngestToolCount = acc.tool_calls.length;
          ingestNDJSONLine(acc, line);
          // Emit structured transcript entries at turn boundaries + tool
          // use events. Cheap per-turn updates let the dashboard show
          // progress in real time via minion_jobs.stacktrace.
          if (acc.assistant_turns > preIngestTurns) {
            void ctx.log({
              type: 'llm_turn',
              model: (params.model as string | undefined) ?? DEFAULT_MODEL,
              tokens_in: acc.tokens.input,
              tokens_out: acc.tokens.output,
              ts: new Date().toISOString(),
            });
          }
          for (let i = preIngestToolCount; i < acc.tool_calls.length; i++) {
            const call = acc.tool_calls[i];
            void ctx.log({
              type: 'tool_call',
              tool: call.tool,
              args_size: JSON.stringify(call.input ?? null).length,
              result_size: 0,
              ts: new Date().toISOString(),
            });
          }
        }
        // Update token rollup on the job row each batch so the dashboard
        // reflects running totals, not just the final result.
        void ctx.updateTokens({
          input: acc.tokens.input,
          output: acc.tokens.output,
          cache_read: acc.tokens.cache_read,
        });
      });

      // Stderr is stashed on the accumulator's transcript for debugging.
      let stderrBuf = '';
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString('utf8');
      });

      // Kill ladder — both ctx.signal and ctx.shutdownSignal wired the
      // same way as shell.ts: SIGTERM → 5s grace → SIGKILL.
      let killTimer: ReturnType<typeof setTimeout> | null = null;
      let killReason = '';
      const onAbort = (label: string) => () => {
        if (killTimer !== null) return;
        killReason = label;
        if (!proc.killed) {
          try { proc.kill('SIGTERM'); } catch { /* already exited */ }
        }
        killTimer = setTimeout(() => {
          if (!proc.killed) {
            try { proc.kill('SIGKILL'); } catch { /* already exited */ }
          }
        }, KILL_GRACE_MS);
      };
      const sigAbort = onAbort('signal');
      const shutdownAbort = onAbort('shutdown');
      ctx.signal.addEventListener('abort', sigAbort);
      ctx.shutdownSignal.addEventListener('abort', shutdownAbort);
      if (ctx.signal.aborted) sigAbort();
      if (ctx.shutdownSignal.aborted) shutdownAbort();

      const exitCode: number = await new Promise<number>((resolve, reject) => {
        proc.on('error', (err) => reject(err));
        proc.on('close', (code, signal) => {
          // Drain any trailing buffered stdout line.
          if (stdoutBuf.trim()) {
            ingestNDJSONLine(acc, stdoutBuf);
          }
          if (code !== null) resolve(code);
          else if (signal === 'SIGTERM') resolve(143);
          else if (signal === 'SIGKILL') resolve(137);
          else resolve(-1);
        });
      }).finally(() => {
        if (killTimer !== null) clearTimeout(killTimer);
        ctx.signal.removeEventListener('abort', sigAbort);
        ctx.shutdownSignal.removeEventListener('abort', shutdownAbort);
      });

      const duration_ms = Date.now() - startedAt;

      // Classify exit reason. Prefer the result line if present — it's the
      // engine's own self-report.
      let exit_reason = 'unknown';
      if (killReason === 'signal' || killReason === 'shutdown') {
        exit_reason = 'aborted';
      } else if (acc.result) {
        if (acc.result.subtype && acc.result.is_error && acc.result.subtype === 'success') {
          exit_reason = 'error_api';
        } else if (acc.result.subtype) {
          exit_reason = acc.result.subtype;
        } else {
          exit_reason = 'success';
        }
      } else if (exitCode === 0) {
        exit_reason = 'success';
      } else {
        exit_reason = `exit_${exitCode}`;
      }

      // Final tokens from result event override running totals when available
      // (result's usage is authoritative).
      if (acc.result?.usage) {
        const u = acc.result.usage;
        if (typeof u.input_tokens === 'number') acc.tokens.input = u.input_tokens;
        if (typeof u.output_tokens === 'number') acc.tokens.output = u.output_tokens;
        if (typeof u.cache_read_input_tokens === 'number') {
          acc.tokens.cache_read = u.cache_read_input_tokens;
        }
        if (typeof u.cache_creation_input_tokens === 'number') {
          acc.tokens.cache_create = u.cache_creation_input_tokens;
        }
      }

      // Abort-triggered kill → throw so worker catch classifies as retry or
      // dead per its rules (shell handler pattern).
      if (exit_reason === 'aborted') {
        const ref = killReason === 'shutdown' ? 'shutdown' : (ctx.signal.reason as Error | undefined)?.message ?? 'signal';
        throw new Error(`aborted: ${ref}`);
      }

      // Non-success result without a 'result' line is a hard engine failure;
      // throw so the worker can retry.
      if (!acc.result && exitCode !== 0) {
        const stderrSnippet = stderrBuf.slice(-500);
        throw new Error(`subscription: claude -p exited ${exitCode}${stderrSnippet ? `: ${stderrSnippet}` : ''}`);
      }

      return {
        engine: 'subscription',
        result: acc.result?.result ?? '',
        transcript: acc.transcript,
        tool_calls: acc.tool_calls,
        cost_usd: acc.result?.total_cost_usd ?? 0,
        tokens: acc.tokens,
        turns_used: acc.result?.num_turns ?? acc.assistant_turns,
        exit_reason,
        duration_ms,
      };
    },
  };
}

// Register the production engine on module import. Tests that need isolation
// should call `resetRegistryForTests()` and then `registerEngine(...)` with
// their own fake before driving the runner handler.
registerEngine(makeSubscriptionEngine());
