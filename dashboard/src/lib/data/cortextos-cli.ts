/**
 * Resolves the cortextos / soma CLI for shell-out from the dashboard.
 *
 * Search order:
 *   1. SOMA_CLI_PATH env var (explicit path to dist/cli.js)
 *   2. <CTX_FRAMEWORK_ROOT>/dist/cli.js (developer machine)
 *   3. `node` + `<CTX_FRAMEWORK_ROOT>/dist/cli.js` symlinked
 *   4. `soma` on PATH
 *   5. `cortextos` on PATH (legacy alias)
 *
 * Returns the spawn argv. The caller passes the subcommand-specific args
 * via `args` (e.g. `['jobs', 'submit', 'echo', '--data', '{}']`).
 */

import { existsSync } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { CTX_FRAMEWORK_ROOT } from '@/lib/config';

const run = promisify(execFile);

export interface CliInvocation {
  bin: string;
  args: string[];
}

export function resolveCliInvocation(args: string[]): CliInvocation {
  const explicit = process.env.SOMA_CLI_PATH;
  if (explicit && existsSync(explicit)) {
    return { bin: 'node', args: [explicit, ...args] };
  }
  const fallback = path.join(CTX_FRAMEWORK_ROOT, 'dist', 'cli.js');
  if (existsSync(fallback)) {
    return { bin: 'node', args: [fallback, ...args] };
  }
  // Otherwise rely on PATH. `soma` first (preferred post-rebrand), falling
  // back to `cortextos`.
  return { bin: 'soma', args };
}

export interface RunCliResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export async function runCli(
  args: string[],
  opts: { timeoutMs?: number; cwd?: string } = {},
): Promise<RunCliResult> {
  const invocation = resolveCliInvocation(args);
  try {
    const { stdout, stderr } = await run(invocation.bin, invocation.args, {
      timeout: opts.timeoutMs ?? 15_000,
      maxBuffer: 2 * 1024 * 1024,
      cwd: opts.cwd ?? CTX_FRAMEWORK_ROOT,
    });
    return { ok: true, stdout, stderr };
  } catch (err) {
    const e = err as Error & { stdout?: string; stderr?: string; code?: string };
    if (e.code === 'ENOENT' && invocation.bin === 'soma') {
      // Final fallback: try `cortextos` as the bin name.
      try {
        const { stdout, stderr } = await run('cortextos', invocation.args, {
          timeout: opts.timeoutMs ?? 15_000,
          maxBuffer: 2 * 1024 * 1024,
          cwd: opts.cwd ?? CTX_FRAMEWORK_ROOT,
        });
        return { ok: true, stdout, stderr };
      } catch (err2) {
        const e2 = err2 as Error & { stderr?: string };
        return { ok: false, stdout: '', stderr: e2.stderr || e2.message };
      }
    }
    return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr || e.message };
  }
}
