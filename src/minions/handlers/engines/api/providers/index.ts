/**
 * Provider registry orchestrator — re-exports the leaf registry + auto-loads
 * the default `anthropic` provider.
 *
 * Storage and the registration API live in `./registry.js` (a leaf module
 * with no further imports). Side-effect imports of provider modules at the
 * bottom of THIS file ensure a populated registry whenever any consumer
 * imports from this barrel — without tripping the TDZ that bit us when
 * the registry storage and the side-effect imports lived in the same module.
 */

export {
  registerProvider,
  getProvider,
  listProviders,
  resetProviderRegistryForTests,
} from './registry.js';

// Side-effect imports — auto-register built-in providers + load custom
// providers from env config.
import './anthropic.js';
import './openai.js';
import './custom.js';

// Re-export the custom-provider loader so operators / tests can rerun it
// after mutating SOMA_API_CUSTOM_PROVIDERS without forcing a process restart.
export { loadCustomProvidersFromEnv } from './custom.js';
export type { CustomProviderEntry } from './custom.js';
export { makeOpenAiProvider } from './openai.js';
