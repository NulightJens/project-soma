/**
 * Unified runner handler — the single entry point for LLM-loop jobs in SOMA.
 *
 * Design goals (per ADR-008 + ADR-012 + Hermes-adaptability open thread):
 *   - **Open engine registry.** `registerEngine(impl)` / `getEngine(name)` —
 *     exported from `./registry.js` as a leaf module so engines can
 *     auto-register without tripping ESM circular-import dead locks.
 *   - **Engine selection per-job.** `data.engine` wins; fallback is
 *     `SOMA_DEFAULT_ENGINE`; ultimate fallback is `'subscription'` (claude
 *     -p), per ADR-008.
 *   - **Shared seams.** Prompt/model/max_turns/allowed_tools/system/cwd are
 *     standardised at this layer. Engines are free to consume extra per-
 *     engine fields from `data`. Output shape (`RunnerResult`) is the same
 *     across engines so downstream consumers don't have to branch.
 *   - **Protected-names registration.** Handler registered under both
 *     `subagent` and `subagent_aggregator` (see src/cli/job-handlers.ts)
 *     so the gate in MinionQueue.add() blocks untrusted submissions.
 */

import type { MinionHandler, MinionJobContext } from '../types.js';
import { UnrecoverableError } from '../types.js';
import { getEngine, listEngines } from './registry.js';

// Re-export the registry surface so `./runner.js` remains a one-stop import
// for consumers that want both the handler and the registry API.
export {
  registerEngine,
  getEngine,
  listEngines,
  resetRegistryForTests,
} from './registry.js';
export type {
  RunnerEngine,
  RunnerEngineParams,
  RunnerResult,
  RunnerTokens,
  RunnerToolCall,
} from './registry.js';

export interface RunnerHandlerData {
  prompt: string;
  engine?: string;
  model?: string;
  max_turns?: number;
  allowed_tools?: string[];
  system?: string;
  cwd?: string;
  [extra: string]: unknown;
}

function defaultEngineName(): string {
  return process.env.SOMA_DEFAULT_ENGINE ?? 'subscription';
}

export const runnerHandler: MinionHandler = async (ctx: MinionJobContext) => {
  const data = (ctx.data ?? {}) as unknown as RunnerHandlerData;

  if (typeof data.prompt !== 'string' || data.prompt.length === 0) {
    throw new UnrecoverableError('runner: data.prompt is required (non-empty string)');
  }

  const engineName = data.engine ?? defaultEngineName();
  const engine = getEngine(engineName);
  if (!engine) {
    throw new UnrecoverableError(
      `runner: unknown engine '${engineName}'. Registered: [${listEngines().join(', ')}]. ` +
        `Set data.engine explicitly or SOMA_DEFAULT_ENGINE.`,
    );
  }

  return engine.run(ctx, data);
};

// ── Default-engine side-effect registration ─────────────────
//
// Engines self-register at module-load. Importing them here means any
// consumer that imports runnerHandler gets a populated registry without
// having to remember to import each engine individually.

import './engines/subscription.js';
import './engines/api.js';
