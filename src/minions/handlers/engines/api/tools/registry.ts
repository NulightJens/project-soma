/**
 * Tool registry orchestrator — re-exports the leaf API + auto-loads the
 * built-in tool factories.
 *
 * Storage and the registration API live in `./registry-leaf.js` (a leaf
 * module with no further imports). Side-effect imports of tool modules at
 * the bottom of THIS file ensure a populated registry whenever any consumer
 * imports from this orchestrator — without tripping the TDZ that bites
 * when the registry storage and the side-effect imports live in the same
 * module (we hit this with engines and providers; same fix applies here).
 *
 * The full brain-derived tool registry (gbrain's `buildBrainTools`) lands
 * in Phase 6 alongside the typed-edge brain layer. Phase 1 ships only
 * queue-internal tools — no shell, no file I/O, no network.
 */

export {
  registerToolFactory,
  listToolFactories,
  resetToolFactoriesForTests,
  bindToolRegistryQueue,
  unbindToolRegistryQueueForTests,
  getBoundQueueForTests,
  getDefaultTools,
  type ToolFactory,
} from './registry-leaf.js';

// Side-effect import — auto-register the Phase-1 built-in tools.
import './builtin.js';
