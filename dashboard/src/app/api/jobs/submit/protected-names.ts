/**
 * Mirror of the SOMA package's PROTECTED_JOB_NAMES check, duplicated here
 * so the dashboard doesn't have to import from the cortextos package at
 * build time. Keep in sync with `src/minions/protected-names.ts`.
 *
 * SOMA's authoritative gate is in MinionQueue.add(); this is a UX-layer
 * pre-check to give the user a 422 + CLI command before we spawn a
 * subprocess that would just fail.
 */

export const PROTECTED_JOB_NAMES = ['shell', 'subagent', 'subagent_aggregator'] as const;

export function isProtectedJobName(name: string): boolean {
  return (PROTECTED_JOB_NAMES as readonly string[]).includes(name.trim());
}
