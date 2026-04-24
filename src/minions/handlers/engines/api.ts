/**
 * API engine — stub.
 *
 * The full port (from gbrain's 710-LOC `handlers/subagent.ts`) is deferred
 * to a follow-up slot per ADR-015's phased approach. Reasons:
 *   - Requires new schema: `minion_subagent_messages` + `minion_subagent_tool_executions`
 *     for crash-resumable multi-turn replay.
 *   - Requires the Anthropic SDK as a dep + `ANTHROPIC_API_KEY` handling.
 *   - Requires a SOMA-native tool registry (gbrain's `buildBrainTools` +
 *     `filterAllowedTools` are not ported yet).
 *
 * This stub registers the engine name so the `data.engine = 'api'` path is
 * well-defined: jobs opting into it get a clear UnrecoverableError pointing
 * at the subscription engine as the usable default. That keeps the registry
 * seam live without pretending the implementation ships yet.
 */

import { UnrecoverableError } from '../../types.js';
import { registerEngine, type RunnerEngine } from '../registry.js';

export const apiEngine: RunnerEngine = {
  name: 'api',
  async run() {
    throw new UnrecoverableError(
      "runner: 'api' engine is not yet ported. Use engine:'subscription' (default) " +
        'or set SOMA_DEFAULT_ENGINE=subscription. The Anthropic-SDK path lands in a ' +
        'follow-up slot — tracked in HANDOFF.md §8.',
    );
  },
};

registerEngine(apiEngine);
