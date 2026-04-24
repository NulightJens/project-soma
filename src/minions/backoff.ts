/**
 * Retry backoff.
 *
 * - Exponential: 2^(attempts_made − 1) × backoff_delay
 * - Fixed:       backoff_delay
 *
 * `backoff_jitter` is a factor in [0, 1] applied symmetrically: the final
 * delay lands in `[delay × (1 − jitter), delay × (1 + jitter)]`. BullMQ-
 * style jitter parameter, Sidekiq-style base formula.
 *
 * Ported verbatim from gbrain (MIT © Garry Tan). No SOMA adaptations.
 */

import type { MinionJob } from './types.js';

export function calculateBackoff(
  job: Pick<MinionJob, 'backoff_type' | 'backoff_delay' | 'backoff_jitter' | 'attempts_made'>,
): number {
  const { backoff_type, backoff_delay, backoff_jitter, attempts_made } = job;

  let delay: number;
  if (backoff_type === 'exponential') {
    delay = Math.pow(2, Math.max(attempts_made - 1, 0)) * backoff_delay;
  } else {
    delay = backoff_delay;
  }

  if (backoff_jitter > 0) {
    const jitterRange = delay * backoff_jitter;
    delay += Math.random() * jitterRange * 2 - jitterRange;
  }

  return Math.max(delay, 0);
}
