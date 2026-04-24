/**
 * Built-in job handlers for `cortextos jobs work`.
 *
 * Two tiers:
 *   - BUILTIN_HANDLERS: always-on core set (echo / noop / sleep). Safe to run
 *     by default; no RCE, no network, no secrets. Exercises the queue → worker
 *     → handler → result loop end-to-end.
 *   - resolveBuiltinHandlers(): core set PLUS any handlers gated behind an
 *     environment flag. Today that's just `shell` (gated by
 *     `SOMA_ALLOW_SHELL_JOBS=1`); the unified runner will join it later.
 *
 * CLI `--handlers <list>` consults `resolveBuiltinHandlers()` so operators can
 * opt into `shell` with an env var, and so a helpful error surfaces if they
 * try `--handlers shell` without the gate set.
 *
 * Add a handler: define the function, export it. If it's safe to run by
 * default, add it to BUILTIN_HANDLERS. If it's RCE-adjacent or needs
 * credentials, gate it inside resolveBuiltinHandlers() behind an env check.
 */

import type { MinionHandler } from '../minions/index.js';
import { shellHandler } from '../minions/handlers/shell.js';

/**
 * `echo` — returns its input verbatim. Useful for proving the state
 * machine + daemon integration without touching the network.
 */
const echoHandler: MinionHandler = async (ctx) => {
  await ctx.log(`echo received data: ${JSON.stringify(ctx.data)}`);
  return { echoed: ctx.data, attempt: ctx.attempts_made + 1 };
};

/**
 * `noop` — returns empty. Lets operators smoke-test claim + complete
 * without sending any payload.
 */
const noopHandler: MinionHandler = async () => {
  return {};
};

/**
 * `sleep` — wait `data.ms` milliseconds then return. Cooperative: aborts
 * on ctx.signal. Used to exercise timeouts, lock renewal over long runs,
 * and the SIGKILL-rescue path (kill the worker mid-sleep, restart,
 * confirm re-claim).
 */
const sleepHandler: MinionHandler = async (ctx) => {
  const ms = Number((ctx.data as { ms?: unknown }).ms ?? 1000);
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`sleep handler: data.ms must be a non-negative number, got ${ctx.data.ms}`);
  }
  await ctx.log(`sleeping for ${ms}ms`);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    ctx.signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error(`aborted after signal: ${ctx.signal.reason}`));
      },
      { once: true },
    );
  });
  return { slept_ms: ms };
};

export const BUILTIN_HANDLERS: Record<string, MinionHandler> = {
  echo: echoHandler,
  noop: noopHandler,
  sleep: sleepHandler,
};

/**
 * Return the full set of built-in handlers available for this process, which
 * is BUILTIN_HANDLERS plus any env-gated handlers whose flag is currently set.
 *
 * Today: `shell` joins when `process.env.SOMA_ALLOW_SHELL_JOBS === '1'`.
 * The gate is checked lazily on each call so tests can flip the env var
 * mid-run without re-importing the module.
 *
 * The shell handler is dual-gated: this registry check keeps it off by default
 * at the worker entry point, and MinionQueue.add()'s protected-names check
 * (see src/minions/protected-names.ts) blocks submission from untrusted
 * callers regardless of whether the handler is registered.
 */
export function resolveBuiltinHandlers(): Record<string, MinionHandler> {
  const handlers: Record<string, MinionHandler> = { ...BUILTIN_HANDLERS };
  if (process.env.SOMA_ALLOW_SHELL_JOBS === '1') {
    handlers.shell = shellHandler;
  }
  return handlers;
}
