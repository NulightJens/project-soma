/**
 * Quiet-hours gate — evaluated at claim time, not dispatch.
 *
 * Dispatch-time gating is wrong because a job queued outside a quiet
 * window can become claimable during the window. Claim-time enforcement
 * is correct: every claim re-checks current wall-clock in the job's
 * configured IANA timezone.
 *
 * Verdicts:
 *   - 'allow'   — outside window; run now
 *   - 'skip'    — inside a `skip`-policy window; drop the job
 *   - 'defer'   — inside a `defer`-policy window; re-queue for later
 *
 * Pure function. No engine, no side effects. The worker consumes the
 * verdict.
 *
 * Ported verbatim from gbrain (MIT © Garry Tan).
 *
 * SOMA: caller passes `now` as a Date for ergonomics. Internal SOMA
 * timestamps are Unix ms (number) — convert at the boundary via
 * `new Date(nowMs)`.
 */

export interface QuietHoursConfig {
  /** 0–23; window starts at this local hour inclusive. */
  start: number;
  /** 0–23; window ends at this local hour exclusive. */
  end: number;
  /** IANA timezone, e.g. "America/Los_Angeles". */
  tz: string;
  /** 'skip' drops the event; 'defer' re-queues for later. Default: 'defer'. */
  policy?: 'skip' | 'defer';
}

export type QuietHoursVerdict = 'allow' | 'skip' | 'defer';

/**
 * Evaluate a quiet-hours config against a reference wall time. Returns
 * 'allow' when `now` is outside the configured window, or 'skip'/'defer'
 * according to policy when inside.
 *
 * Wrap-around windows are supported: `{start: 22, end: 7}` = 10pm–7am.
 */
export function evaluateQuietHours(
  cfg: QuietHoursConfig | null | undefined,
  now: Date = new Date(),
): QuietHoursVerdict {
  if (!cfg) return 'allow';
  if (!isValidConfig(cfg)) return 'allow';

  const hour = localHour(now, cfg.tz);
  if (hour === null) return 'allow'; // unknown tz → fail-open; safer than hard-blocking every job

  const inWindow =
    cfg.start <= cfg.end
      ? hour >= cfg.start && hour < cfg.end
      : hour >= cfg.start || hour < cfg.end; // wrap-around

  if (!inWindow) return 'allow';
  return cfg.policy === 'skip' ? 'skip' : 'defer';
}

function isValidConfig(cfg: QuietHoursConfig): boolean {
  if (!Number.isInteger(cfg.start) || cfg.start < 0 || cfg.start > 23) return false;
  if (!Number.isInteger(cfg.end) || cfg.end < 0 || cfg.end > 23) return false;
  if (cfg.start === cfg.end) return false;
  if (typeof cfg.tz !== 'string' || cfg.tz.length === 0) return false;
  return true;
}

/** Return the hour (0-23) of `when` in the given IANA timezone, or null on failure. */
export function localHour(when: Date, tz: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      hour: 'numeric',
    }).formatToParts(when);
    const hh = parts.find((p) => p.type === 'hour')?.value ?? '';
    const n = parseInt(hh, 10);
    if (!Number.isFinite(n)) return null;
    return n % 24;
  } catch {
    return null;
  }
}
