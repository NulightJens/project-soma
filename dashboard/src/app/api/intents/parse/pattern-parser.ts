/**
 * Deterministic intent parser — no LLM, no network, no allocations beyond
 * the regex matches. Pattern set is intentionally small + explicit so the
 * operator always knows what mapping fired.
 *
 * Format of every successful parse:
 *   { ok: true, intent: { name, data, queue?, priority? }, hint, source }
 *
 * `hint` is a short plain-language summary of what we resolved to, shown
 * in the confirmation card so the operator can accept/edit/cancel.
 * `source` records which pattern matched, mostly for telemetry and tests.
 *
 * Add a pattern: append to PATTERNS in priority order. Earlier entries
 * win on tie (the matcher is first-match, not best-match).
 */

export interface IntentPayload {
  name: string;
  data?: Record<string, unknown>;
  queue?: string;
  priority?: number;
}

export interface ParseSuccess {
  ok: true;
  intent: IntentPayload;
  hint: string;
  source: string;
}

export interface ParseFailure {
  ok: false;
  error: string;
  /** Suggestions surfaced to the operator when nothing matched. */
  suggestions: string[];
}

export type ParseResult = ParseSuccess | ParseFailure;

interface Pattern {
  name: string;
  test: (input: string) => RegExpExecArray | null;
  build: (m: RegExpExecArray, raw: string) => IntentPayload;
  hint: (intent: IntentPayload) => string;
}

const PATTERNS: Pattern[] = [
  // ── Bare handler name + JSON object ─────────────────────
  // "echo {\"msg\":\"hi\"}", "noop", "sleep {\"ms\":1000}"
  {
    name: 'handler+json',
    test: (s) => /^([a-zA-Z_][a-zA-Z0-9_]*)\s*(\{.*\})?\s*$/.exec(s.trim()),
    build: (m) => {
      const handler = m[1];
      const data: Record<string, unknown> = m[2] ? JSON.parse(m[2]) : {};
      return { name: handler, data };
    },
    hint: (i) => Object.keys(i.data ?? {}).length > 0
      ? `Submit handler '${i.name}' with payload ${JSON.stringify(i.data)}`
      : `Submit handler '${i.name}' with no payload`,
  },

  // ── "sleep N (seconds|ms)" ──────────────────────────────
  {
    name: 'sleep',
    test: (s) => /^sleep\s+(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|ms|millis(?:econds?)?)?\s*$/i.exec(s.trim()),
    build: (m) => {
      const n = parseFloat(m[1]);
      const unit = (m[2] ?? 'ms').toLowerCase();
      const ms = unit.startsWith('s') ? Math.round(n * 1000) : Math.round(n);
      return { name: 'sleep', data: { ms } };
    },
    hint: (i) => `Sleep handler — pause ${(i.data as { ms: number }).ms}ms`,
  },

  // ── "echo (message)" ────────────────────────────────────
  {
    name: 'echo',
    test: (s) => /^echo(?:\s+(.+))?$/i.exec(s.trim()),
    build: (m) => ({ name: 'echo', data: m[1] ? { msg: m[1] } : {} }),
    hint: (i) =>
      'msg' in (i.data ?? {})
        ? `Echo handler — returns ${JSON.stringify((i.data as { msg: unknown }).msg)} as the result`
        : 'Echo handler — returns an empty payload as the result',
  },

  // ── "noop" ─────────────────────────────────────────────
  {
    name: 'noop',
    test: (s) => /^noop\s*$/i.exec(s.trim()),
    build: () => ({ name: 'noop', data: {} }),
    hint: () => "Noop handler — returns empty result; useful for smoke-testing the queue's claim+complete path",
  },
];

const SUGGESTIONS = [
  '"noop" — submit a no-op job',
  '"echo hello" — echo handler with msg=hello',
  '"sleep 5 seconds" — pause for 5 seconds',
  '"<handler-name> {\\"key\\":\\"value\\"}" — any registered handler with JSON data',
  'Use the Advanced tab for full control over queue, priority, retry policy, etc.',
];

export function parseIntent(text: string): ParseResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, error: 'empty input', suggestions: SUGGESTIONS };

  for (const p of PATTERNS) {
    const m = p.test(trimmed);
    if (!m) continue;
    try {
      const intent = p.build(m, trimmed);
      // Defensive: never produce an intent with a protected name from the
      // freeform parser. Operators must use the Advanced tab + CLI for those.
      if (['shell', 'subagent', 'subagent_aggregator'].includes(intent.name)) {
        return {
          ok: false,
          error: `'${intent.name}' is a protected handler — use the Advanced tab and the operator CLI to submit it.`,
          suggestions: SUGGESTIONS,
        };
      }
      return { ok: true, intent, hint: p.hint(intent), source: p.name };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: `pattern '${p.name}' matched but parsing failed: ${message}`,
        suggestions: SUGGESTIONS,
      };
    }
  }

  return {
    ok: false,
    error: "couldn't parse this phrase into a known job pattern. Try one of:",
    suggestions: SUGGESTIONS,
  };
}
