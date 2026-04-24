/**
 * Minions — SOMA's durable priority queue.
 *
 * Public API re-exports. Consumers import from `@soma/minions` (once
 * packaged) or `src/minions/index.js` (within the repo) — never from
 * submodules directly.
 */

export * from './types.js';
export * from './engine.js';
export { openSqliteEngine } from './engine-sqlite.js';
export type { SqliteEngineOpts } from './engine-sqlite.js';
export { calculateBackoff } from './backoff.js';
export { staggerMinuteOffset, staggerSecondOffset } from './stagger.js';
export {
  evaluateQuietHours,
  localHour,
  type QuietHoursConfig,
  type QuietHoursVerdict,
} from './quiet-hours.js';
export { MinionQueue, type TrustedSubmitOpts } from './queue.js';
export { MinionWorker } from './worker.js';
