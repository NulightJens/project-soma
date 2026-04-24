/**
 * Built-in job handlers for `cortextos jobs work`.
 *
 * These are intentionally minimal — the real workhorse handlers (shell
 * subprocess, subagent / unified runner) land as separate ports in later
 * Phase 1 slots. The trivial set here lets the full queue → worker →
 * handler → result loop be exercised end-to-end before any RCE or API
 * surface ships.
 *
 * Add a handler: define the function, export it in BUILTIN_HANDLERS.
 * Callers wire their own handlers via `worker.register(name, fn)` — this
 * registry is only consulted by the CLI's `--handlers` flag.
 */

import type { MinionHandler } from '../minions/index.js';

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
