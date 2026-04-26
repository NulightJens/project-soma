# Agent bootstrap

You're an LLM agent (or a human dev who works like one) opening this repo cold. This page is your shortest path to "I know enough to be useful here." It complements rather than replaces [CLAUDE.md](../../CLAUDE.md) (the operational harness) and [HANDOFF.md](../../HANDOFF.md) (the live state snapshot).

## Read order on first contact

1. [HANDOFF.md](../../HANDOFF.md) — 30-second resume snapshot. Where the codebase is right now, what works, what's broken, what the immediate next moves are.
2. [CLAUDE.md](../../CLAUDE.md) — operating harness. Line limits, ownership zones, verification discipline, when to delegate, when to check in. **Memorise §3 (hard limits) and §6 (security boundaries).**
3. [what-is-soma.md](./what-is-soma.md) — concept layer. Substrate / minions / engines / tools.
4. [PROJECT_SOMA.md §13 chronicle's last 3 entries](../../PROJECT_SOMA.md) — what the previous sessions did and why.
5. `git log --oneline -10` on the active branch — last 10 commits in raw form.
6. The verify block from [HANDOFF.md §2](../../HANDOFF.md) — confirm tests pass and the daemon is up before you write code.

That gets you from "fresh boot" to "ready to act" in under two minutes.

## Mental model

The single most important fact about this codebase: **state lives outside any one process**. When you're tempted to add an in-memory cache or a "session" or a "context object," check first whether the durable queue (`minion_jobs`), file bus (`~/.soma/<inst>/inbox/`), or persisted message log (`minion_subagent_messages`) already gives you what you need. They almost always do.

The second most important fact: **the queue is the integration point**. New features add either (a) a new handler name registered with `MinionWorker.register`, or (b) a new engine registered with `registerEngine`, or (c) a new provider registered with `registerProvider`, or (d) a new tool factory registered with `registerToolFactory`. The framework around them is already built — extend by registering, not by editing the loop.

## Vocabulary you must internalise

If you can't paraphrase these in one sentence each without reading them, slow down and re-read [what-is-soma.md](./what-is-soma.md) before writing code:

- **handler** vs. **engine** vs. **provider** vs. **tool** — four distinct registries, four distinct extension seams.
- **trusted** vs. **untrusted** submitter — the dashboard, the model's `submit_minion` tool, and any external HTTP/MCP bridge are all untrusted. The CLI with `--trusted` and in-process tests are trusted.
- **subscription engine** vs. **api engine** — different cost surfaces (Claude subscription quota vs. pay-per-token API credits), different env gates.
- **`ctx.signal`** vs. **`ctx.shutdownSignal`** — the first fires on timeout/cancel/lock-loss; the second only on worker SIGTERM/SIGINT. Shell + subscription engines subscribe to both; most other handlers only need `ctx.signal`.
- **port-exempt** commits — when porting from gbrain or gstack, the 300-LOC ceiling is waived but every deviation gets a `// SOMA:` annotation.

## Where to make changes

Use this table when you're about to edit something. If your change crosses two zones, the rule is to **pause and ask** before making the change rather than batching everything in one commit.

| Zone | Edit when | Verification before commit |
|---|---|---|
| `src/minions/**` | Adding queue features, handlers, engines, providers, tools | `npx vitest run tests/minions-*.test.ts` |
| `src/cli/**` | Adding `soma <subcommand>` surface | `node dist/cli.js <cmd> --help`; relevant `tests/cli-*.test.ts` |
| `src/daemon/**` | Daemon supervision, agent lifecycle | `npx tsc --noEmit`; manual `soma start` smoke |
| `src/pty/**` | `claude` subprocess spawning, env allowlist | **HITL required** — security surface |
| `dashboard/**` | Web UI | `cd dashboard && npx tsc --noEmit`; eyeball the route in dev server |
| `src/brain/**` (Phase 6+) | Memory layer | (future — see ADR-004) |
| `tests/**` | Tests for whichever zone | `npm test` |
| `templates/**` | Per-agent scaffolds | Manual: `soma add-agent <name> --template <new>` |
| `PROJECT_SOMA.md` | New ADR or chronicle entry | Append-only — never edit a prior ADR |
| `HANDOFF.md` | After every non-trivial commit | Per its §10 update checklist |

## Where NOT to make changes (without HITL)

These surfaces are security-critical. Any change here pauses for explicit operator review:

- `src/pty/agent-pty.ts` env allowlist — anything in there can leak into the spawned `claude` process.
- `src/cli/install.ts` token plumbing — touches OAuth and Keychain.
- `src/minions/handlers/shell.ts` — RCE-adjacent.
- `src/minions/protected-names.ts` — the gate that blocks untrusted submission of high-stakes handlers.
- The Telegram `ALLOWED_USER` check in agent .env files — single-user authentication.
- Anything in `~/.soma/default/orgs/**/.env` or `secrets.env` — gitignored, never echo, never `git add`.

## Verification discipline

> **Every commit ends with output proof.** Not "tests should pass" — show the green count. Not "type-checks ok" — show the silent `npx tsc --noEmit`. The harness is set up so that "I claim X works" without showing the verification is treated as untrusted.

Before any commit:

```bash
npx tsc --noEmit                          # silent = pass
npx vitest run tests/minions-*.test.ts tests/cli-*.test.ts \
  dashboard/src/app/api/intents/parse/__tests__/pattern-parser.test.ts
# → Tests N passed (N) — N must equal the discipline-suite count from HANDOFF
```

If you touched the dashboard:

```bash
(cd dashboard && npx tsc --noEmit)        # silent = pass
```

If you touched a UI route, also exercise it in a browser and report the result. Type checks are not feature checks.

## Commit hygiene

- **Conventional commit prefix.** `soma:` for feature work, `docs:` for docs, `fix:` for bug fixes, `refactor:` for non-functional cleanup.
- **HEREDOC commit messages.** Always pass the message via `git commit -m "$(cat <<'EOF' ... EOF)"` — preserves blank lines + bullet structure.
- **One feature per commit, ≤ 300 LOC** (port commits exempt, must annotate `// SOMA:`).
- **Commit then push to `soma/phase-N-*`.** Never force-push shared branches.
- **After every non-trivial commit:** update HANDOFF.md per its §10. Snapshot to `docs/handoffs/YYYY-MM-DD-NN-topic.md` at phase milestones. Append to PROJECT_SOMA.md §13 chronicle.

## Hub-and-spoke delegation

The session you're in is the **hub** — strategic decisions, architecture, memory consolidation, integration. When you need to read 3+ files or search across multiple directories to answer a question, **spawn a spoke agent** (Explore for fast searches, general-purpose for multi-file research). Don't burn the hub's context on bulk reading. See [CLAUDE.md §7](../../CLAUDE.md).

## Patterns you'll see often

### Registering a new engine

```ts
// In src/minions/handlers/engines/<your-engine>.ts
import { registerEngine, type RunnerEngine } from '../registry.js';

export const myEngine: RunnerEngine = {
  name: 'my-engine',
  async run(ctx, params) {
    // ... implementation ...
    return { engine: 'my-engine', result: '...', /* ... */ };
  },
};

registerEngine(myEngine);
```

Then add a side-effect import in `runner.ts` so it loads.

### Registering a new provider (under the api engine)

```ts
// In src/minions/handlers/engines/api/providers/<your-provider>.ts
import { registerProvider } from './registry-leaf.js';

registerProvider({
  name: 'my-provider',
  rateKey: () => 'my-provider:api',
  async runTurn(req) { /* ... */ },
});
```

Then side-effect import in `providers/index.ts`.

### Registering a new tool

```ts
// In src/minions/handlers/engines/api/tools/<your-tool>.ts
import { registerToolFactory } from './registry-leaf.js';

registerToolFactory('my_tool', (queue) => ({
  name: 'my_tool',
  description: '...',
  input_schema: { type: 'object', properties: {...} },
  idempotent: false,
  async execute(input, ctx) { /* ... */ },
}));
```

Then side-effect import in `tools/registry.ts`.

### Adding a new built-in handler

```ts
// In src/cli/job-handlers.ts BUILTIN_HANDLERS or behind an env gate in resolveBuiltinHandlers
const myHandler: MinionHandler = async (ctx) => { /* ... */ };

export function resolveBuiltinHandlers(): Record<string, MinionHandler> {
  const handlers: Record<string, MinionHandler> = { ...BUILTIN_HANDLERS };
  if (process.env.SOMA_ALLOW_MY_HANDLER === '1') {
    handlers.my_handler = myHandler;
  }
  return handlers;
}
```

If the handler is high-stakes (RCE, network, file I/O), **gate it** behind an env flag AND consider adding the name to `protected-names.ts`.

### TDZ-safe registry pattern

Anywhere a module self-registers at load time, the storage map must live in a leaf module with zero further imports. We've hit this exact issue three times (engines, providers, tools) — the leaf-orchestrator split is in `src/minions/handlers/registry.ts` + `runner.ts` (engines), `providers/registry-leaf.ts` + `providers/index.ts` (providers), `tools/registry-leaf.ts` + `tools/registry.ts` (tools). Use the same pattern for any future registry.

## When you're stuck

| Symptom | Action |
|---|---|
| You're not sure if a behaviour is intentional | `git log -p -- <file>` and read the commit message that introduced it |
| You don't know what donor a piece came from | Search [donor-lineage.md](./donor-lineage.md) |
| The test discipline-suite has fewer cases than HANDOFF claims | Tests added since the last HANDOFF update — check `git log` and update HANDOFF |
| `tsc --noEmit` fails after your change | Read the error from the bottom up — TS error chains often have the actionable diagnostic at the end |
| ESM TDZ error during test load | You hit the registry-storage / self-register cycle — extract to a leaf module |
| A change spans pty / shell / protected-names | **Stop.** Pause and ask the operator before continuing. |

## Writing up your work

When you finish a non-trivial slot:

1. Make the commit (≤300 LOC; port-exempt commits annotated).
2. Push to the active branch.
3. **Update HANDOFF.md** per its §10:
   - §1 Resume in 30s — new branch tip + green signals
   - §3 file map — new files
   - §5 commit timeline — prepend the commit
   - §8 next moves — remove what you did, add what you discovered
4. **Append to PROJECT_SOMA.md §13 chronicle** with: date, what changed, what's next.
5. **At a phase milestone**, snapshot HANDOFF.md to `docs/handoffs/YYYY-MM-DD-NN-topic.md`.
6. **At ~500K context used**, prepare a resume-prompt bundle per [docs/handoffs/TEMPLATE-resume-prompt.md](../handoffs/TEMPLATE-resume-prompt.md) before the window exhausts.

## What good work looks like here

- A focused commit that makes one thing work, with tests that prove it.
- An honest verification report — actual command output, not paraphrase.
- An updated HANDOFF that the next session can read cold.
- A chronicle entry that captures the "why," not just the "what."
- Zero unprompted force-pushes, zero merged-but-failing tests, zero `--trusted` submissions from untrusted surfaces.

If you do all of those, the operator's trust budget grows and you get more autonomy on the next slot. If you skip verification or claim "done" without proof, the budget shrinks and the next slot turns into a HITL checkpoint.

---

Welcome to SOMA. Now go read [HANDOFF.md](../../HANDOFF.md).
