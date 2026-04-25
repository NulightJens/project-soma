/**
 * Provider registry — pure data structure, leaf module.
 *
 * Split out of `index.ts` to break ESM TDZ when providers self-register at
 * module load (same pattern as `handlers/registry.ts` for engines). When
 * `anthropic.ts` calls `registerProvider(...)` at the bottom of its module,
 * its imports must already have run — that means the registry's storage
 * map must live in a module with NO further import-graph traversal.
 */

import type { Provider } from '../types.js';

const REGISTRY = new Map<string, Provider>();

export function registerProvider(provider: Provider): void {
  if (REGISTRY.has(provider.name)) {
    throw new Error(`api: provider '${provider.name}' is already registered`);
  }
  REGISTRY.set(provider.name, provider);
}

export function getProvider(name: string): Provider | undefined {
  return REGISTRY.get(name);
}

export function listProviders(): string[] {
  return [...REGISTRY.keys()].sort();
}

/** Test-only. Resets the registry so each test starts clean. */
export function resetProviderRegistryForTests(): void {
  REGISTRY.clear();
}
