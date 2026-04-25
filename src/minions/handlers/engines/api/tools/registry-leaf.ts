/**
 * Tool registry — leaf module (storage + register/list API only, zero
 * imports from sibling modules). Same TDZ-avoidance pattern as
 * `handlers/registry.ts` and `providers/registry.ts`.
 *
 * `tools/registry.ts` re-exports from here AND triggers the side-effect
 * imports (builtin.ts) at the bottom.
 */

import type { MinionQueue } from '../../../../queue.js';
import type { ApiToolDef } from '../types.js';

export type ToolFactory = (queue: MinionQueue) => ApiToolDef;

const FACTORIES = new Map<string, ToolFactory>();
let BOUND_QUEUE: MinionQueue | null = null;

export function registerToolFactory(name: string, factory: ToolFactory): void {
  if (FACTORIES.has(name)) {
    throw new Error(`api tools: factory '${name}' is already registered`);
  }
  FACTORIES.set(name, factory);
}

export function listToolFactories(): string[] {
  return [...FACTORIES.keys()].sort();
}

export function resetToolFactoriesForTests(): void {
  FACTORIES.clear();
  BOUND_QUEUE = null;
}

export function bindToolRegistryQueue(queue: MinionQueue): void {
  BOUND_QUEUE = queue;
}

export function unbindToolRegistryQueueForTests(): void {
  BOUND_QUEUE = null;
}

export function getBoundQueueForTests(): MinionQueue | null {
  return BOUND_QUEUE;
}

export function getDefaultTools(opts: { queue?: MinionQueue; allowed?: string[] } = {}): ApiToolDef[] {
  const queue = opts.queue ?? BOUND_QUEUE;
  if (!queue) return [];
  const all: ApiToolDef[] = [];
  for (const [name, factory] of FACTORIES) {
    if (opts.allowed && !opts.allowed.includes(name)) continue;
    all.push(factory(queue));
  }
  return all;
}
