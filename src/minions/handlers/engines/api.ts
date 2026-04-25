/**
 * API engine — Anthropic / OpenAI-compatible / custom-endpoint LLM loops
 * with crash-resumable replay and a pluggable Provider seam.
 *
 * Engine surface (`run(ctx, params)`) is provider-neutral; per-job
 * `data.provider` selects which Provider handles the actual HTTP call.
 * Default provider: `anthropic`. Other providers (commit (b)) self-register
 * from their own modules.
 *
 * Engine env-gate: registered unconditionally so `data.engine='api'` always
 * routes deterministically; `SOMA_ALLOW_API_ENGINE=1` is the CLI-side gate
 * that includes the runner handler in `resolveBuiltinHandlers()` (analogous
 * to the subscription / shell gates).
 */

import type { QueueEngine } from '../../engine.js';
import type { MinionJobContext } from '../../types.js';
import { UnrecoverableError } from '../../types.js';
import { registerEngine, type RunnerEngine } from '../registry.js';
import { runApiLoop, type ApiLoopDeps } from './api/loop.js';
// Side-effect import: ensures the default 'anthropic' provider registers.
import './api/providers/index.js';

// ── QueueEngine binding ─────────────────────────────────────
//
// The API engine needs a QueueEngine for `acquireLock(...)` rate leases.
// The engine instance isn't available at module-load time (registration
// fires before the worker is constructed). The worker calls
// `bindApiEngineQueue(engine)` once at construction; tests inject their
// own. The runtime resolution happens inside `run()`, by which point the
// binding is always set in production paths.

let BOUND_ENGINE: QueueEngine | null = null;

export function bindApiEngineQueue(engine: QueueEngine): void {
  BOUND_ENGINE = engine;
}

/** Test-only. Resets the binding so each test starts clean. */
export function unbindApiEngineQueueForTests(): void {
  BOUND_ENGINE = null;
}

// ── Engine factory ──────────────────────────────────────────

export interface ApiEngineDeps extends Partial<ApiLoopDeps> {
  /** Override the default queue-engine resolver. Tests inject their own. */
  resolveEngine?: () => QueueEngine | null;
}

export function makeApiEngine(deps: ApiEngineDeps = {}): RunnerEngine {
  const resolveEngine = deps.resolveEngine ?? (() => BOUND_ENGINE);
  // Tests pass deps.engine explicitly, which also signals "skip the env
  // cost-surface gate" — the test's own provider stub controls cost.
  const isTestPath = deps.engine != null;
  return {
    name: 'api',
    async run(ctx: MinionJobContext) {
      if (!isTestPath && process.env.SOMA_ALLOW_API_ENGINE !== '1') {
        throw new UnrecoverableError(
          "api: engine is gated. Set SOMA_ALLOW_API_ENGINE=1 to allow API-key-based " +
            "LLM calls. (Distinct from SOMA_ALLOW_SUBAGENT_JOBS which gates the runner " +
            "handler registration; this gate covers API-key cost specifically.)",
        );
      }
      const engine = deps.engine ?? resolveEngine();
      if (!engine) {
        throw new UnrecoverableError(
          'api: queue engine not bound. The worker should call bindApiEngineQueue(engine) ' +
            'at construction time. Tests should pass deps.engine explicitly.',
        );
      }
      return runApiLoop(ctx, {
        engine,
        resolveProvider: deps.resolveProvider,
        leaseTimeoutMs: deps.leaseTimeoutMs,
      });
    },
  };
}

// Default registration. Engine selection (data.engine='api') routes here.
registerEngine(makeApiEngine());

// Re-export the binding helpers + factory so tests + worker can reach them
// via the same import path.
export { runApiLoop } from './api/loop.js';
export type { ApiEngineJobData, ApiLoopDeps } from './api/loop.js';
export type { Provider, ApiToolDef, ProviderTurnRequest, ProviderTurnResult } from './api/types.js';
export {
  registerProvider,
  getProvider,
  listProviders,
  resetProviderRegistryForTests,
} from './api/providers/index.js';
export {
  registerToolFactory,
  listToolFactories,
  resetToolFactoriesForTests,
  bindToolRegistryQueue,
  unbindToolRegistryQueueForTests,
  getDefaultTools,
} from './api/tools/registry.js';
