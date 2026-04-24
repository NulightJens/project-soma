/**
 * Protected job names — side-effect-free constant module.
 *
 * Ported from gbrain's `src/core/minions/protected-names.ts`
 * (MIT © Garry Tan). No behavioural deviations.
 *
 * Names in this set require an explicit `trusted.allowProtectedSubmit: true`
 * opt-in when passed to `MinionQueue.add()`. Trust is granted by the SOMA
 * CLI path and by trusted in-process callers (daemon, planner, tests that
 * want to exercise shell/subagent handlers directly). Untrusted callers —
 * the dashboard submit form, Telegram bot, future MCP/HTTP bridges, skills
 * running inside subagent handlers — can never submit these names, so an
 * in-process handler compromise can't chain to a `queue.add('shell', ...)`.
 *
 * Why all three names, not just 'shell':
 *   - `shell` runs an arbitrary subprocess in the worker's environment.
 *     Compromise = RCE.
 *   - `subagent` and `subagent_aggregator` call the Anthropic API (gbrain's
 *     full 710-LOC handler with two-phase tool ledger). In SOMA these
 *     names are reserved ahead of handler landing per ADR-008 (subscription
 *     primary; `engine: 'api'` or `SOMA_DEFAULT_ENGINE=api` unlocks the API
 *     path). Pre-protecting ensures the gate ships alongside the handler,
 *     not after it. Compromise = quota burn + leaked keys if mis-handled.
 *
 * This file must stay pure — no imports from handlers, no filesystem, no
 * env reads. Queue core imports it; side effects here would be paid by
 * every queue user at module-load time.
 */

export const PROTECTED_JOB_NAMES: ReadonlySet<string> = new Set([
  'shell',
  'subagent',
  'subagent_aggregator',
]);

/** Check a job name against the protected set. Normalizes whitespace first. */
export function isProtectedJobName(name: string): boolean {
  return PROTECTED_JOB_NAMES.has(name.trim());
}
