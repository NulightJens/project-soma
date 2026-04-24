/**
 * Runner engine registry — pure data structure, zero dependencies on
 * engine implementations.
 *
 * Split out of `runner.ts` to break the ESM circular-import dead lock:
 * when engines auto-register at module load, they import from here
 * (a leaf module), not from runner.ts. This preserves the "import the
 * engine module, it self-registers" ergonomic without tripping on
 * temporal-dead-zone errors that bit us when the registry lived
 * alongside the runner's engine imports.
 */

import type { MinionJobContext } from '../types.js';

// ── Shared types ────────────────────────────────────────────

export interface RunnerEngineParams {
  prompt: string;
  model?: string;
  max_turns?: number;
  allowed_tools?: string[];
  system?: string;
  cwd?: string;
  [extra: string]: unknown;
}

export interface RunnerTokens {
  input: number;
  output: number;
  cache_read: number;
  cache_create: number;
}

export interface RunnerToolCall {
  tool: string;
  input: unknown;
  output?: string;
}

export interface RunnerResult {
  engine: string;
  result: string;
  transcript: unknown[];
  tool_calls: RunnerToolCall[];
  cost_usd: number;
  tokens: RunnerTokens;
  turns_used: number;
  exit_reason: string;
  duration_ms: number;
}

export interface RunnerEngine {
  readonly name: string;
  run(ctx: MinionJobContext, params: RunnerEngineParams): Promise<RunnerResult>;
}

// ── Registry ────────────────────────────────────────────────

const REGISTRY = new Map<string, RunnerEngine>();

export function registerEngine(engine: RunnerEngine): void {
  if (REGISTRY.has(engine.name)) {
    throw new Error(`runner: engine '${engine.name}' is already registered`);
  }
  REGISTRY.set(engine.name, engine);
}

export function getEngine(name: string): RunnerEngine | undefined {
  return REGISTRY.get(name);
}

export function listEngines(): string[] {
  return [...REGISTRY.keys()].sort();
}

/** Test-only. Clears the registry so each test can start from known state. */
export function resetRegistryForTests(): void {
  REGISTRY.clear();
}
