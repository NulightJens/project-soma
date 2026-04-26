# SOMA — Session Handoff

> Live resume-here snapshot. Updated at the end of every non-trivial session.
> Historical snapshots are kept under `docs/handoffs/YYYY-MM-DD-NNN-topic.md`.
>
> **If you are an AI session opening this repo cold, read in this order:**
> 1. This file (30 seconds to "I know where we are")
> 2. `CLAUDE.md` (operating harness — how we work here)
> 3. `PROJECT_SOMA.md` §13 chronicle last entry (what just happened)
> 4. `git log --oneline origin/soma/phase-1-minions -10` (recent commits)
>
> Full vision and ADRs live in `PROJECT_SOMA.md`. This file is the index.

---

## Resume in 30 seconds

- **What SOMA is:** a personal-to-organizational agent operating system. Persistent 24/7 Claude Code sessions coordinating via a durable priority queue (Minions, ported from gbrain), isolated by git worktrees (WorktreeManager, from gstack — Phase 2), surfaced through Telegram + Next.js dashboard. Forked from cortextOS (upstream); absorbing gbrain (queue + memory) and gstack (subprocess pattern + worktree isolation); graphify as an enrichment pipeline (Phase 6).
- **Current branch:** `soma/phase-1-minions`
- **Last commit:** `2a99638` — "soma: dashboard /jobs/submit UI — Freeform + Advanced tabs (ADR-014)"
- **Green signals:** 202 Minions+CLI+runner+API-engine+API-providers+API-tools+dashboard-pattern-parser vitest cases passing; `npx tsc --noEmit` clean across both the SOMA package AND the `dashboard/` package; `cortextos jobs` CLI verified end-to-end; dashboard `/jobs` route live with plain-language summaries + progressive-disclosure JSON toggle (ADR-014); **dashboard `/jobs/submit` route live** — Freeform tab (deterministic pattern parser → confirmation card → untrusted submit) + Advanced tab (full structured form). Multi-provider API engine: Anthropic (default) + OpenAI-compatible + custom-endpoint via `SOMA_API_CUSTOM_PROVIDERS` env; gated by `SOMA_ALLOW_API_ENGINE=1`. 3 minimal queue-internal tools (submit_minion / send_message / read_own_inbox) registered.
- **Red signals:** none. Phase 1 is ~99% done — only the LLM-routed intent-parser fallback (synchronous Minion using subscription engine) remains as a polish follow-up.
- **Do not:** ingest any Solo Scale handoff content (ADR-009). Build SOMA fully agnostic first.

---

## Verify state (copy-paste)

```bash
cd ~/cortextos
git status                                               # should be clean
git log --oneline -7                                     # confirm at latest dashboard submit-UI commit
npx tsc --noEmit                                         # silent = pass
(cd dashboard && npx tsc --noEmit)                       # silent = pass
npx vitest run tests/minions-*.test.ts tests/cli-*.test.ts dashboard/src/app/api/intents/parse/__tests__/pattern-parser.test.ts  # 202 passed
pm2 list                                                 # soma-daemon + SOMA-dashboard + soma-jobs-worker all online
curl -sI http://localhost:3000/login                     # HTTP/1.1 200 OK
curl -sI http://localhost:3000/jobs/submit               # 307 → /login?callbackUrl=/jobs/submit (route exists, auth-gated)
ls ~/.cortextos                                          # symlink → ~/.soma (post-migration)
```

If any of the above fails, see §9 Environment + §10 Gotchas before proceeding.

---

## Where you are on the roadmap

Phase 0 — fork + foundation ........ **DONE**
Phase 1 — Minions queue ............ **~99% done** ← you are here
Phase 2 — Worktree isolation ....... not started
Phase 3 — Claude-subprocess worker . not started
Phase 4 — Orchestrator rewrite ..... not started
Phase 5 — Skill format unification . not started
Phase 6 — Brain layer .............. not started
Phase 7 — Hardening + Cloudflare ... not started

Phase 1 breakdown — what's done vs. what's next:

| Phase 1 deliverable | Status | File(s) |
|---|---|---|
| `src/minions/` scaffold + README + port-status matrix | ✓ done | `src/minions/README.md` |
| `types.ts` — Minion job + inbox + attachment + context types | ✓ done | `src/minions/types.ts` |
| `schema.sql` — SQLite DDL | ✓ done | `src/minions/schema.sql` |
| `engine.ts` — `QueueEngine` interface | ✓ done | `src/minions/engine.ts` |
| `engine-sqlite.ts` — better-sqlite3 impl | ✓ done | `src/minions/engine-sqlite.ts` |
| `backoff.ts`, `stagger.ts`, `quiet-hours.ts` | ✓ done | `src/minions/*.ts` |
| `queue.ts` — MinionQueue class | ✓ done | `src/minions/queue.ts` |
| `worker.ts` — main loop + handler registry + stall/timeout sweeps | ✓ done | `src/minions/worker.ts` |
| `attachments.ts` helper + queue attachment CRUD + `content` BLOB schema + UNIQUE constraint | ✓ done | `src/minions/attachments.ts`, `src/minions/queue.ts`, `src/minions/schema.sql` |
| `protected-names.ts` gate | ✓ done | `src/minions/protected-names.ts`, gate wired into `MinionQueue.add()` |
| `cortextos jobs` CLI | ✓ done | `src/cli/jobs.ts` + `src/cli/job-handlers.ts`. Subcommands: submit/list/get/cancel/retry/stats/work. Trusted submitter — `--trusted` flag sets `{allowProtectedSubmit: true}`. |
| Daemon integration (PM2 jobs-worker entry) | ✓ done | `src/cli/ecosystem.ts` emits a `cortextos-jobs-worker` PM2 app alongside the daemon. Env: `SOMA_MINIONS_DB`, `SOMA_WORKER_QUEUE`, `SOMA_WORKER_CONCURRENCY`, `SOMA_WORKER_HANDLERS`. |
| Dashboard Jobs page | ✓ done | `dashboard/src/app/(dashboard)/jobs/page.tsx` + `api/jobs` route + `lib/data/minions.ts`. Primary view is plain-language summaries (ADR-014). Progressive disclosure via "Show raw JSON" toggle in the detail sheet. Cancel/retry shell out to `cortextos jobs` CLI so state-machine logic stays in queue.ts. |
| `handlers/shell.ts` | ✓ done | `src/minions/handlers/shell.ts` + `tests/minions-shell-handler.test.ts`. Dual-gated: `SOMA_ALLOW_SHELL_JOBS=1` env flag + protected-names trust check. `resolveBuiltinHandlers()` in `src/cli/job-handlers.ts` is the CLI entry point. |
| Unified `handlers/runner.ts` + `engines/subscription.ts` | ✓ done | Open engine registry (`registerEngine`/`getEngine` in `registry.ts` — leaf module to dodge ESM TDZ). Default `subscription` engine spawns `claude -p --output-format stream-json --verbose`; pure `ingestNDJSONLine` parser + kill ladder on BOTH `ctx.signal` AND `ctx.shutdownSignal`. Registered under `subagent` + `subagent_aggregator` behind `SOMA_ALLOW_SUBAGENT_JOBS=1`. |
| `engines/api.ts` — multi-provider LLM-loop with crash-resumable replay | ✓ done | `src/minions/handlers/engines/api/` (loop.ts, types.ts, providers/registry-leaf.ts + index.ts, providers/anthropic.ts + openai.ts + custom.ts, tools/registry-leaf.ts + builtin.ts). Schema: `minion_subagent_messages` + `minion_subagent_tool_executions` (CREATE IF NOT EXISTS, bootstrap-time). `@anthropic-ai/sdk` dep added; lazy-imported. Provider seam: Anthropic (default) + OpenAI-compatible (covers OpenRouter/Together/Groq/Ollama/vLLM/LM Studio) + custom endpoints via `SOMA_API_CUSTOM_PROVIDERS` env JSON. Tools registry with 3 queue-internal Phase-1 tools (submit_minion / send_message / read_own_inbox). Gated: `SOMA_ALLOW_API_ENGINE=1`. |
| Dashboard submit-UI + intent parser (ADR-014) | ✓ done | `dashboard/src/app/(dashboard)/jobs/submit/page.tsx` — Freeform + Advanced tabs. Untrusted submitter (never sets `--trusted`); protected names render as a "Use the operator CLI" card with the equivalent command pre-filled. Pattern-based deterministic intent parser at `/api/intents/parse` (no LLM, recognises bare-name+JSON, sleep N units, echo phrase, noop). LLM-routed fallback deferred. POST /api/jobs/submit shells out to CLI. |

---

## Mental model snapshot

Core vocabulary (from PROJECT_SOMA §12 glossary + CLAUDE.md):

| Term | Means |
|---|---|
| **orchestrator** / **twin** | top-level AI layer. "Orchestrator" is internal / dev-facing; "twin" is conceptual / business-facing. Same runtime entity. (ADR-007) |
| **brain** | the persistent files representing an agent (markdown identity + soul + goals + skills). Survives process death. |
| **body** | a transient Claude Code process / subprocess instantiating a brain. |
| **minion / job** | a durable row in the queue. Priority-ordered, DAG-aware, stall-rescued. |
| **worker** | an ephemeral process claiming minion jobs and running them, eventually inside an isolated worktree. |
| **worktree** | per-job git worktree for filesystem isolation (Phase 2). |
| **pillar** | one of Memory / Action / Automation / Self-Learning. Routing dimension on every job. |
| **department** | one of Marketing / Sales / Operations / Content / Finance / Product. The other routing dimension. (From the handoff packet — SOMA platform knows the concept; does not ship Solo Scale's specific charters.) |
| **skill** | fat markdown file (gstack/gbrain `SKILL.md` format) an agent invokes. Lives under `templates/` or per-agent `.skills/`. |
| **harness** | this repo's operating rules for Claude Code. See `CLAUDE.md`. |

Routing rule (from gbrain, adopted): **deterministic work → Minion handler; judgment → subagent (Claude subprocess default, API opt-in per ADR-008).**

Engine selection (ADR-008): default worker handler spawns `claude -p --output-format stream-json --verbose`. API subagent (gbrain's full 710-LOC handler with two-phase tool ledger) exists but is **off by default** — requires `engine: 'api'` per-job or `SOMA_DEFAULT_ENGINE=api`.

Integration principle (ADR-012): **synergy not silos.** Don't ship parallel redundant ports. One unified runner handler with engine selection; learnings as typed edges in the brain graph (not a sidecar JSONL); scheduled work as Minion jobs (not a parallel cron); file bus carries messages, Minions carries work items.

Ceiling principle (ADR-011): **don't dumb down.** Preserve every donor's full capability surface — the narrative is the organizing story, not a cap on features.

---

## File map — what's where

### Repo root
| File | Purpose |
|---|---|
| `CLAUDE.md` | Harness — how Claude Code works on this repo. 10 sections: stack, ownership zones, hard limits, local-first, data discipline, env/security, hub-spoke, memory/retros, DB rules, ADR habit. Read at session start. |
| `PROJECT_SOMA.md` | Living source of truth — vision + architecture + 13 ADRs + phased roadmap + chronicle + glossary. ~580 lines. §10 = ADR log, §13 = chronicle. |
| `HANDOFF.md` | **This file.** Resume-here snapshot. |
| `CONTRIBUTING.md` | Contributor guide (skills, agents, org templates). Unchanged from upstream SOMA. |
| `README.md` | Upstream SOMA README — still describes SOMA. SOMA-specific replacement comes with Phase 5 rename. |

### Minions queue (Phase 1)
| File | LOC | Purpose |
|---|---|---|
| `src/minions/README.md` | ~60 | Port-status matrix, backend matrix, adaptations log |
| `src/minions/types.ts` | 324 | All job / inbox / attachment / context types + row mappers |
| `src/minions/schema.sql` | 173 | SQLite DDL for `minion_jobs`, `minion_inbox`, `minion_attachments`, `minion_rate_leases` + indexes + update trigger |
| `src/minions/engine.ts` | 73 | `QueueEngine` interface — `exec/one/all/tx/acquireLock/now/close` |
| `src/minions/engine-sqlite.ts` | 235 | `better-sqlite3` impl. WAL + NORMAL + FK + 5s busy_timeout. Advisory locks via `BEGIN IMMEDIATE` + NULL-owner-job sentinel rows. |
| `src/minions/queue.ts` | 1380 | `MinionQueue` class. Core state-machine methods + worker-support helpers + attachment CRUD + protected-names gate in `add()`. |
| `src/minions/worker.ts` | 385 | `MinionWorker` — concurrent in-process worker. `tick()` + `drain()` surface for tests, full `start()` loop for production. Per-job AbortController + lock renewal + stall/timeout sweeps + quiet-hours defer/skip. |
| `src/minions/attachments.ts` | 110 | Pure `validateAttachment` — filename safety, base64, content-type, size, in-flight duplicate. Returns `NormalizedAttachment` with sha256 + bytes. |
| `src/minions/protected-names.ts` | 40 | Pure constant module. `PROTECTED_JOB_NAMES = {shell, subagent, subagent_aggregator}`. `isProtectedJobName(name)` — trim + membership check. |
| `src/cli/jobs.ts` | 360 | `cortextos jobs` — 7 subcommands (submit / list / get / cancel / retry / stats / work). Plain-language output by default; `--json` for raw. Trusted submitter: `--trusted` sets `allowProtectedSubmit`. |
| `src/cli/job-handlers.ts` | 65 | Built-in handlers: `echo`, `noop`, `sleep`. Minimum set to exercise the queue → worker → result loop end-to-end without shell/subagent risk. |
| `dashboard/src/lib/data/minions.ts` | 195 | Dashboard data layer. Opens Minions SQLite read-only; `listJobs`, `getJob`, `getQueueStats`, and `runCliAction` (shells out to `cortextos jobs` CLI for cancel/retry so state-machine logic stays in `queue.ts`). |
| `dashboard/src/app/api/jobs/route.ts` | 40 | GET /api/jobs — validated filters, 100-default/500-max limit. |
| `dashboard/src/app/api/jobs/[id]/route.ts` | 50 | GET /api/jobs/[id] + POST with `{action: 'cancel' \| 'retry'}`. |
| `dashboard/src/app/(dashboard)/jobs/page.tsx` | 415 | Jobs route. Status-filter pills, auto-refresh every 5s, plain-language one-line summaries per job, detail sheet with progressive-disclosure "Show raw JSON" toggle per ADR-014. Cancel/retry actions. |
| `src/minions/backoff.ts` | 34 | Exponential + fixed backoff with jitter |
| `src/minions/stagger.ts` | 33 | FNV-1a deterministic offset for same-cron decorrelation |
| `src/minions/quiet-hours.ts` | 86 | IANA-tz claim-time window gate |
| `src/minions/index.ts` | 29 | Public API barrel — import from here, not submodules |
| `tests/minions-engine.test.ts` | 193 | 7 vitest cases — schema, CRUD, idempotency, locks, tx |
| `tests/minions-queue.test.ts` | 507 | 34 vitest cases — every state transition, DAG, stall, timeout, pause/resume |
| `tests/minions-worker.test.ts` | 295 | 11 vitest cases — handler registry, claim→run→complete, ctx instrumentation, retry/backoff, UnrecoverableError, SIGKILL rescue smoke |
| `tests/minions-attachments.test.ts` | 295 | 19 vitest cases — pure validation (7) + queue CRUD round-trip (12) including BLOB round-trip, UNIQUE fence, FK cascade on job removal |
| `tests/minions-protected-names.test.ts` | 160 | 13 vitest cases — pure module membership (6) + queue gate (7) including trim-evasion, `allowProtectedSubmit: false` block, opts-spread cannot smuggle trust flag |
| `tests/cli-job-handlers.test.ts` | ~195 | 10 vitest cases — echo result + log, noop, sleep duration + negative-ms rejection + direct-drive AbortSignal path (7) + `resolveBuiltinHandlers` env-gate behavior (3: default excludes shell, `SOMA_ALLOW_SHELL_JOBS=1` includes it, non-"1" value is ignored). |
| `tests/cli-jobs-sigkill-rescue.test.ts` | 135 | 1 regression case — spawns `cortextos jobs work`, waits for claim, `SIGKILL`s the worker, verifies a second worker's stall sweep requeues the orphaned lock (stalled_counter ≥ 1). Complements the in-process stall-rescue test. |
| `src/minions/handlers/shell.ts` | 311 | Shell subprocess handler (ported from gbrain MIT © Garry Tan). Env allowlist `[PATH, HOME, USER, LANG, TZ, NODE_ENV]` + caller override. `/bin/sh -c` absolute path. UTF-8-safe `TailBuffer` for 64KB stdout / 16KB stderr tails. SIGTERM → 5s grace → SIGKILL wired to BOTH `ctx.signal` (timeout/cancel/lock-loss) AND `ctx.shutdownSignal` (worker SIGTERM/SIGINT). |
| `tests/minions-shell-handler.test.ts` | ~165 | 15 vitest cases — validation (7: missing/both cmd-argv, non-string argv, missing/relative cwd, non-object env, non-string env value) + execution (6: cmd happy path, argv happy path, non-zero exit, env-allowlist blocks `process.env` secrets, caller `env` override reaches child, stdout truncation with `[truncated N bytes]` marker) + abort (2: `ctx.signal` + `ctx.shutdownSignal` each trigger kill ladder + throw `aborted:` Error). |
| `src/minions/handlers/registry.ts` | ~80 | Pure engine registry. `register`/`get`/`list`/`resetForTests`. All shared runner types (`RunnerEngine`, `RunnerResult`, `RunnerTokens`, `RunnerToolCall`, `RunnerEngineParams`) live here so engines never import from `runner.ts` (would be a circular-import ESM TDZ). |
| `src/minions/handlers/runner.ts` | ~95 | Unified handler. Validates `data.prompt`, dispatches to engine via `data.engine` → `SOMA_DEFAULT_ENGINE` → `'subscription'` (ADR-008 default). Re-exports registry API. Imports `./engines/*` at the bottom so side-effect auto-registration happens when any consumer imports `runnerHandler`. |
| `src/minions/handlers/engines/subscription.ts` | ~350 | `claude -p --output-format stream-json --verbose --dangerously-skip-permissions` spawn. Prompt via stdin (no shell escaping). Env allowlist mirrors `src/pty/agent-pty.ts` keepVars + `CLAUDE_CODE_OAUTH_TOKEN`. Pure `ingestNDJSONLine(acc, line)` parser + `buildClaudeArgs(params)` CLI-arg builder (both testable without subprocess). Per-turn `ctx.log({type:'llm_turn',...})` + `ctx.log({type:'tool_call',...})` + running `ctx.updateTokens`. SIGTERM→5s→SIGKILL kill ladder wired to both `ctx.signal` and `ctx.shutdownSignal`. Auto-registers via `makeSubscriptionEngine()` at module load. |
| `src/minions/handlers/engines/api.ts` | ~95 | Engine factory + module-level binding. `bindApiEngineQueue(engine)` resolves at handler-run time so the auto-registered engine has a real QueueEngine for `acquireLock(...)` rate leases. `SOMA_ALLOW_API_ENGINE=1` cost-surface gate (separate from SOMA_ALLOW_SUBAGENT_JOBS). Re-exports the loop, registry, provider+tool helpers as the public API. |
| `src/minions/handlers/engines/api/types.ts` | ~120 | `Provider` interface, `ProviderTurnRequest`/`ProviderTurnResult`/`ProviderTurnUsage`/`ProviderStopReason`, `ApiToolDef`/`ApiToolContext` (with `readOwnInbox` callback), `ProviderHttpError` (retryable status discriminator). |
| `src/minions/handlers/engines/api/loop.ts` | ~510 | Provider-neutral multi-turn loop with crash-resumable replay, ported from gbrain handlers/subagent.ts (port-exempt). Replay reconciliation finishes pending tool dispatches before the next provider turn. Per-turn `ctx.log` transcript entries match the subscription engine. Two-phase tool ledger; idempotent-only re-run on resume. Rate leases via `engine.acquireLock(api:<rateKey>, ...)`. |
| `src/minions/handlers/engines/api/providers/registry-leaf.ts` | ~35 | Pure provider registry storage. Leaf module (zero further imports) — same TDZ-avoidance pattern as engine + tool registries. |
| `src/minions/handlers/engines/api/providers/index.ts` | ~30 | Provider barrel. Re-exports the leaf API; side-effect imports anthropic/openai/custom at the bottom. |
| `src/minions/handlers/engines/api/providers/anthropic.ts` | ~190 | Anthropic provider via `@anthropic-ai/sdk` (lazy import). Cache markers on system + last tool-def. Block normalisation both ways. Auto-registers `anthropic` as the default. |
| `src/minions/handlers/engines/api/providers/openai.ts` | ~290 | OpenAI-compatible provider via native `fetch`. Translates SubagentContentBlock ↔ OpenAI Chat shape; tool_use → tool_calls; tool_result → role:tool messages. Used as the factory by custom-endpoint registrations (covers OpenAI/OpenRouter/Together/Groq/Anyscale/Mistral/Perplexity/Ollama/vLLM/LM Studio). |
| `src/minions/handlers/engines/api/providers/custom.ts` | ~140 | `SOMA_API_CUSTOM_PROVIDERS` env-config loader. Strict per-entry validation; bad entries warn rather than crash the daemon. Each entry registers via `makeOpenAiProvider({...})`. |
| `src/minions/handlers/engines/api/tools/registry-leaf.ts` | ~60 | Pure tool registry (factories + bound queue). Same TDZ split. |
| `src/minions/handlers/engines/api/tools/registry.ts` | ~30 | Orchestrator. Re-exports leaf API + side-effect imports `./builtin.js`. |
| `src/minions/handlers/engines/api/tools/builtin.ts` | ~165 | Phase-1 minimal queue-internal tools: `submit_minion(name, data?, queue?, priority?)` (untrusted submit, parented to caller), `send_message(target_job_id, payload)` (parent-or-admin gate enforced by queue.sendMessage), `read_own_inbox()` (via ctx.readOwnInbox). Auto-registers all three at module load. |
| `tests/minions-runner.test.ts` | ~340 | 23 vitest cases — same as before with 3 updated to test `SOMA_ALLOW_API_ENGINE` gate behaviour instead of the old "stub" message. |
| `tests/minions-api-engine.test.ts` | ~430 | 13 vitest cases — env gate (2), validation (3), single-turn happy path (1), tool dispatch + ledger (1), unregistered tool fallback (1), max_turns exit (1), crash-resumable replay (1), provider registry (2), Anthropic block normalisation (1). |
| `tests/minions-api-openai.test.ts` | ~330 | 22 vitest cases — pure translators in both directions (4 + 3), finish-reason mapping (6), runTurn integration via fake fetch (3: bearer auth, body shape, parsing; non-OK → ProviderHttpError; missing auth env), custom-provider loader (6: empty, bad JSON, non-array, per-field validation, full register, duplicate-rejection). |
| `tests/minions-api-tools.test.ts` | ~260 | 17 vitest cases — registry (6), submit_minion (5), send_message (3), read_own_inbox (2), loop integration (1). |

### Dashboard
| File | Purpose |
|---|---|
| `dashboard/src/app/globals.css` | Full monochrome theme bound to shadcn contract (ADR-010) |
| `dashboard/src/app/soma-tokens.css` | Parallel `--soma-*` namespace for SOMA-wrapped surfaces |
| `dashboard/src/app/layout.tsx` | Manrope wired as `--font-manrope`; title = "SOMA" |
| `dashboard/src/components/charts/chart-theme.ts` | Chart palette monochrome ramp; severity.error keeps `#ef4444` |
| 25 component files | Chromatic utilities swept to monochrome + icons + labels (see ADR-010 flagged visual-regression risks) |
| `dashboard/src/app/(dashboard)/jobs/submit/page.tsx` | New submit UI (ADR-014). [Freeform] tab — text → /api/intents/parse → confirmation card → untrusted submit. [Advanced] tab — full structured form. Protected names render the equivalent CLI command instead of submitting. |
| `dashboard/src/app/api/jobs/submit/route.ts` | POST endpoint. Strict validation, protected-name pre-check (returns 422 + cli_command), shells out to `cortextos jobs submit --json`. Untrusted by design — never sets --trusted. |
| `dashboard/src/app/api/jobs/submit/protected-names.ts` | Mirror of src/minions/protected-names.ts so the dashboard doesn't import the SOMA package. Keep in sync. |
| `dashboard/src/app/api/intents/parse/route.ts` | POST endpoint thin wrapper around the pattern parser. |
| `dashboard/src/app/api/intents/parse/pattern-parser.ts` | Deterministic intent parser. Patterns: handler+JSON catch-all, sleep N units, echo phrase, noop. First-match. Refuses protected names. LLM-routed fallback deferred. |
| `dashboard/src/lib/data/cortextos-cli.ts` | CLI resolver helper. Search order: `SOMA_CLI_PATH` env → `<CTX_FRAMEWORK_ROOT>/dist/cli.js` → `soma` on PATH → `cortextos` on PATH. |
| `dashboard/src/app/api/intents/parse/__tests__/pattern-parser.test.ts` | 14 vitest cases — happy paths (7), refusals (3), hint formatting (4). |

### Upstream cortextOS (inherited, not yet rewritten)
| Zone | Status |
|---|---|
| `src/daemon/` | Active — runs the PM2-managed `cortextos-daemon` supervising agents |
| `src/pty/agent-pty.ts` | Active — spawns `claude` via node-pty, reads Keychain for OAuth |
| `src/bus/` | Active — file-based message bus for agents |
| `src/cli/` | Active — `cortextos init/add-agent/start/...` commands |
| `bus/tasks/` | Legacy — file-based task dir. Will deprecate when Minions is daemon-integrated. |

---

## Commit timeline (SOMA work)

```
2a99638  soma: dashboard /jobs/submit UI — Freeform + Advanced tabs (ADR-014)
312f725  soma: dashboard submit + intent-parse API routes (ADR-014, untrusted submitter)
dabd2ea  soma: API tool registry + 3 minimal Phase-1 tools (submit_minion, send_message, read_own_inbox)
9680385  soma: OpenAI-compatible provider + SOMA_API_CUSTOM_PROVIDERS env config
576f4e2  soma: API engine body — multi-turn loop + Anthropic provider port (ADR-008, ADR-012)
2893a3d  docs(handoffs): snapshot HANDOFF.md after ADR-015 infra cutover milestone
2e702f8  docs(handoff): fill in e8aaa2d commit hash for ADR-015 infra cutover
e8aaa2d  soma: infra rename — state dir to .soma, PM2 apps to soma-*, soma bin alias
32e38df  docs(handoff): fill in 78987cf commit hash for unified runner
78987cf  soma: unified runner handler + subscription engine (ADR-008, ADR-012)
4e64183  docs(handoff): fill in 89b3631 + 408de8f commits (rename + shell)
408de8f  soma: port handlers/shell.ts behind SOMA_ALLOW_SHELL_JOBS env gate
89b3631  soma: rebrand display surface to Project SOMA (ADR-015)
f5b9ef6  docs(handoffs): snapshot HANDOFF.md after Phase 1 usable-loop milestone
ccc94d7  docs(handoff): fill in 986102e commit hash for SIGKILL-rescue regression
986102e  soma: SIGKILL-rescue regression against real subprocess worker
75726b3  docs(handoff): fill in 17eb305 commit hash for dashboard Jobs page
17eb305  soma: dashboard Jobs page (ADR-014 progressive disclosure)
d55ada3  docs(handoff): fill in 6c5ae0f commit hash for CLI/handlers/PM2 cluster
6c5ae0f  soma: cortextos jobs CLI + built-in handlers + PM2 jobs-worker
b461ef0  soma: add resume-prompt template + ~500K context handoff protocol
e8852c6  soma: thread Hermes adaptability constraints into phases 1/2/5
50a1bff  docs(handoff): fill in 2218d65 commit hash for protected-names port
2218d65  soma: port protected-names gate (shell + subagent + subagent_aggregator)
bad585c  docs(handoff): fill in 6638568 commit hash for attachments port
6638568  soma: port attachments (validation + CRUD + schema + tests)
bf5165d  soma: ADR-014 — user-facing edge filters both directions
1788ed8  docs(handoff): fill in 4835323 commit hash for worker.ts port
4835323  soma: port MinionWorker (worker.ts) + queue worker-support helpers
d1e5c88  soma: handoff system — HANDOFF.md + docs/handoffs/ + CLAUDE.md updates
608bfdd  soma: port MinionQueue class (queue.ts) with full state-machine coverage
2a328e2  soma: adopt claudecode-harness for CLAUDE.md; ADR-013
1b50cea  soma: phase 1 foundation — SQLite engine + ADR-012 + small modules
3f54b80  soma: full monochrome dashboard restyle + directive recalibration
f613fe3  soma: phase 1 scaffold + monochrome design tokens
8fba559  docs: introduce Project SOMA — fork charter, architecture, roadmap
```

Everything below `8fba559` is upstream cortextOS history (rebased at fork time).

---

## ADR index

Full text in `PROJECT_SOMA.md` §10. Quick reference:

| # | Title | Summary |
|---|---|---|
| 001 | Fork + evolve in place | Not a new repo — keep upstream merge ability. |
| 002 | SQLite default queue backend | zero-config local dev. PGLite/Postgres/D1 later. |
| 003 | Claude subscription primary, API secondary | *superseded by 008* — framing was too soft. |
| 004 | Graphify as enrichment pipeline, gbrain as storage | *revised* — elevated from "optional skill" after ADR-011. |
| 005 | SOMA codename kept; rename deferred | Package/repo stays `cortextos` until Phase 5. |
| 006 | Cloudflare is distribution multiplier, not dep | Tunnel/Workers/R2/D1 opt-in behind pluggable interfaces. |
| 007 | "Orchestrator" internal; "Twin" conceptual | Dev-facing = orchestrator; business-facing = twin. |
| 008 | Subscription-first, API opt-in only | Full gbrain subagent handler ported but gated behind `engine: 'api'`. |
| 009 | Solo Scale instantiation deferred | Build SOMA agnostic first; no handoff content in SOMA. |
| 010 | Full monochrome dashboard restyle | Not token-only — 67 utilities + 3 inline hex + chart palette all swept. |
| 011 | Don't dumb down | Preserve full capability from every donor. Narrative is organizing story, not ceiling. |
| 012 | Synergy not silos | Overlapping concepts integrate into single coherent implementations. No parallel redundant ports. |
| 013 | Adopt claudecode-harness for CLAUDE.md | 10-section operating context template filled in for SOMA stack. |
| 014 | User-facing edge filters both directions | Internals stay complex; human-facing surfaces translate simple input → structured calls and structured output → plain summaries. Complements ADR-011 (doesn't override). |
| 015 | Rebrand display + npm package to SOMA; defer infra rename | Partially supersedes ADR-005. Prose, docs, template markdown, dashboard UI, source comments, npm `name` all rebranded. CLI binary alias, `~/.cortextos/` state dir, PM2 app names, repo dir, GitHub URL deferred to a dedicated migration slot (runbook needed). |

---

## Open threads (blocked / deferred / watching)

| Item | State | Notes |
|---|---|---|
| Commit author identity | ongoing | Commits show `Max Computer <max@Maxs-Mac-mini.local>`. Fix with `git -C ~/cortextos config user.name "Jens Heitmann" && git -C ~/cortextos config user.email "jens@nulight.io"`. Not blocking. |
| `pm2 startup` for reboot persistence | not done | User needs to run the sudo command PM2 prints. Cosmetic for development. |
| Private repo for Solo Scale instantiation | deferred to after Phase 5 | Name TBD — `solo-scale-twin` / `nulight-twin` / other. |
| `/btw` context from earlier session | resolved | User clarified via "taken into account" + "don't dumb down" wording — captured as ADRs 011 + 012. |
| Dashboard visual-regression risks from monochrome sweep | acknowledged | Category badges, mid-tier stability, progress bars, bottleneck section. See ADR-010. |
| Hermes Agent adaptability | posture deferred; foundation protected | Installed at `~/.hermes/hermes-agent` (MIT, Nous Research 2025). Full runtime — Python CLI, 7+ gateway platforms (telegram/discord/slack/whatsapp/signal/homeassistant/qqbot), skills hub, ACP adapter, cron, tool registry, TUI, ~3000 tests. Choosing absorb / interop / replace / ignore is deferred to after Phase 1. Three foundational constraints threaded into current phases so Hermes can drop in later without rework: (1) unified runner uses open engine-registry not closed enum [Phase 1 slot #2]; (2) output parser is a per-engine seam, not hardcoded to `claude -p` NDJSON [same]; (3) Phase 5 skill-format unification scans Hermes skills-hub schema before locking SOMA's. Platform adapters / ACP / TUI / session DB / prompt caching / Hermes-cron are additive and safely deferrable. |
| Attachment CRUD + `attachments.ts` | landed | See `src/minions/attachments.ts` + `queue.ts` CRUD. `minion_attachments.content` BLOB + `UNIQUE (job_id, filename)` live in schema. |
| `protected-names.ts` gate | landed | See `src/minions/protected-names.ts`. Full 3-name set: `shell`, `subagent`, `subagent_aggregator`. Gate enforced in `MinionQueue.add()`. |

---

## Next moves (ranked)

1. **LLM-routed intent-parser fallback** (Phase 1 polish; non-blocking). Today `/api/intents/parse` is the deterministic pattern matcher only. The LLM fallback was deferred from commit (d) to keep the dashboard credential-free and the slot small. Plan: when the deterministic parser returns ok:false, fall through to a synchronous high-priority Minion job (`subscription` engine + system prompt that returns JSON). Server polls the job row until terminal, returns the parsed intent. Adds ~2-3s latency vs. direct API; preserves the dashboard-stays-credential-free invariant. Requires `SOMA_ALLOW_SUBAGENT_JOBS=1` + Claude OAuth.

2. **Phase 2 — Worktree isolation** (next phase). Port gstack's `WorktreeManager` (`/tmp/gstack/lib/worktree.ts`). Each Minion job runs inside its own git worktree so concurrent jobs can't clobber each other's working tree. Touches: worker.ts (worktree create/cleanup hooks around handler invoke), shell handler (resolve `cwd` to the worktree path), brain layer's filesystem ops (Phase 6 will inherit the isolation).

3. **Repo dir + GitHub rename** (Tier D from ADR-015 — operator-driven). Local: `mv ~/cortextos ~/SOMA && ln -s ~/SOMA ~/cortextos`. GitHub: rename `NulightJens/project-soma` → `NulightJens/soma` in repo settings, then `git remote set-url origin git@github.com:NulightJens/soma.git`. Source code already supports both `~/SOMA` and `~/cortextos` as project root via fallback discovery, so the local rename is a no-op the moment you decide. Not blocking anything.

### Starter commands

```bash
# End-to-end subscription-engine smoke (requires `claude` CLI installed + OAuth'd):
cd ~/cortextos
npm run build   # if you haven't rebuilt since the runner landed
export SOMA_ALLOW_SUBAGENT_JOBS=1
TMPDB=$(mktemp -d)/smoke.db
node dist/cli.js jobs submit subagent --trusted \
  --data '{"prompt":"say hi in one word","max_turns":1}' --db "$TMPDB"
node dist/cli.js jobs work --db "$TMPDB" --handlers subagent --poll-interval 500 &
sleep 30 && kill %1
node dist/cli.js jobs get 1 --db "$TMPDB"
# Expect a completed job with a RunnerResult in `result`: engine, result text,
# tool_calls, cost_usd, tokens, turns_used, exit_reason: 'success'.

# End-to-end shell smoke:
export SOMA_ALLOW_SHELL_JOBS=1
TMPDB=$(mktemp -d)/smoke.db
node dist/cli.js jobs submit shell --trusted --data '{"cmd":"echo hi","cwd":"/tmp"}' --db "$TMPDB"
node dist/cli.js jobs work --db "$TMPDB" --handlers shell --poll-interval 500 &
sleep 2 && kill %1
node dist/cli.js jobs get 1 --db "$TMPDB"     # expect exit_code: 0, stdout_tail: "hi\n"

# Dashboard exercise (auth-gated):
curl -sI http://localhost:3000/jobs
# 307 → /login?callbackUrl=/jobs  (expected)

# Discipline:
npx vitest run tests/minions-*.test.ts tests/cli-*.test.ts   # expect 136 passed
(cd dashboard && npx tsc --noEmit)
npx tsc --noEmit
git add <files> && git commit -m "soma: ..." && git push origin soma/phase-1-minions
```

---

## External references

### Donor repos (all MIT — legally clean to combine)
| Repo | Role | Clone path | Key files |
|---|---|---|---|
| `grandamenium/cortextos` | upstream, base fork | `~/cortextos` (our working tree) | `src/daemon/`, `src/pty/agent-pty.ts`, `src/bus/`, `src/cli/` |
| `garrytan/gbrain` | Minions queue + memory | `/tmp/gbrain` | `src/core/minions/queue.ts` (ported), `worker.ts` (next), `handlers/subagent.ts` (Phase 1 later), `src/core/cycle.ts` (Phase 6), `src/core/fail-improve.ts` (Phase 7), `docs/ethos/THIN_HARNESS_FAT_SKILLS.md` |
| `garrytan/gstack` | worktrees + subprocess pattern + skills | `/tmp/gstack` | `lib/worktree.ts` (Phase 2), `test/helpers/session-runner.ts` (Phase 3), `lib/gen-skill-docs.ts` (Phase 5), `autoplan/SKILL.md`, `ETHOS.md` |
| `safishamsi/graphify` | enrichment pipeline | `/tmp/graphify` | `ARCHITECTURE.md`, `graphify/{build,extract,serve}.py` — adopt tree-sitter AST + Leiden clustering + multimodal ingest into brain-enricher (Phase 6). Do NOT adopt as memory backend. |
| `anothervibecoder-s/claudecode-harness` | CLAUDE.md template | `/tmp/claudecode-harness` | `CLAUDE_EXAMPLE.md` — adopted as our `CLAUDE.md`. |

### Reference material (not code)
| Path | Purpose |
|---|---|
| `~/Downloads/solo-scale-handoff-2026-04-23/` | 9-file business packet (Solo Scale north star, departments, brand, voice). **DO NOT INGEST** into SOMA (ADR-009). Used as future reference when Solo Scale twin repo is created. |
| `~/Downloads/solo-scale-handoff-2026-04-23/assets/brand-jens-monochrome.css` | Source of SOMA's dashboard theme (the only file we did ingest — visual tokens, no brand rules). |

### Repos & URLs
- **SOMA fork:** https://github.com/NulightJens/project-soma (public, MIT) — origin
- **Upstream:** https://github.com/grandamenium/cortextos — `upstream` remote (`git fetch upstream`)
- **Current branch:** https://github.com/NulightJens/project-soma/tree/soma/phase-1-minions
- **gbrain:** https://github.com/garrytan/gbrain
- **gstack:** https://github.com/garrytan/gstack
- **graphify:** https://github.com/safishamsi/graphify
- **claudecode-harness:** https://github.com/anothervibecoder-s/claudecode-harness

---

## Environment

### Local state
- `~/cortextos` — working tree (branch: `soma/phase-1-minions`)
- `~/.cortextos/default/` — SOMA state root (agent memories, heartbeats, enabled-agents.json)
- `~/.cortextos/default/config/enabled-agents.json` — toggle agents on/off without removing them
- `~/cortextos/orgs/solo-scale/` — user's personal org (gitignored). `system` agent live, 5 specialists (skool/social-media/brand/content/growth) disabled.
- `~/.pm2/` — PM2 state (`pm2 list`, `pm2 logs cortextos-daemon`)

### Running services
- `pm2` supervisor with `cortextos-daemon` online
- `system` agent (claude PTY, PID visible via `cortextos status`)
- Telegram poller inside the daemon (`@SoloScale_Bot`, chat_id = 6293102218)
- Next.js dev server on `:3000` (PID logged in `~/.cortextos/dashboard.log` at launch; use `pgrep -af "next dev"` to check)

### Dashboard login (dev-only; see `~/.cortextos/default/dashboard.env`)
- URL: http://localhost:3000
- Username: `admin`
- Password: `26b84410dd780434d9fea753`

### Telegram bot
- Bot username: `@SoloScale_Bot`
- Bot token: stored in `~/cortextos/orgs/solo-scale/agents/*/env` and `~/cortextos/orgs/solo-scale/secrets.env` — chmod 600, gitignored. Masked everywhere else.
- User's Telegram ID (chat_id): `6293102218`
- Allowed user set via `ALLOWED_USER=6293102218` in every agent `.env`

---

## Non-obvious gotchas

1. **SQLite ON CONFLICT with partial unique indexes** requires the WHERE predicate in the ON CONFLICT target. `ON CONFLICT (idempotency_key) DO NOTHING` errors; `ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING` works. Postgres tolerates the bare form. Already patched in `queue.ts`.

2. **SQLite doesn't support UPDATE inside a CTE.** gbrain's `handleStalled` uses a 3-way `WITH ... UPDATE ... RETURNING` pattern that won't compile on SQLite. SOMA does it in two passes inside a tx. Same semantics.

3. **Minion timestamps are Unix ms (number), not Date.** Callers converting `new Date(job.delay_until!)` is fine at the boundary, but inside `src/minions/*` everything is numbers. `engine.now()` is the clock — centralized so tests can inject.

4. **Advisory locks use `minion_rate_leases` with `owner_job = NULL`** — the same table serves both job-owned rate leases (FK to `minion_jobs`) and engine-owned advisory locks. Schema allows the FK to be nullable. Don't assume `owner_job` is always set.

5. **Lock-key `LIKE` matching** in `engine-sqlite.ts:acquireLock` uses `ESCAPE '\'` so user-supplied lock keys containing `%` or `_` don't accidentally match other keys. `escapeLike()` helper covers this.

6. **`better-sqlite3` is synchronous under the hood.** Our `QueueEngine` interface is async by contract, but the underlying calls resolve immediately. This is fine for single-process SOMA; the abstraction stays correct for future PGLite/Postgres/D1 adapters that are genuinely async.

7. **tsup `ESM + bundler moduleResolution`** means local imports use `.js` extensions even though source files are `.ts`. All new SOMA modules follow this: `import { x } from './types.js'`. Don't drop the `.js`.

8. **Commits show `Max Computer <max@Maxs-Mac-mini.local>`.** Local git user.name/user.email not set in this repo. See §8 open threads for the fix command. Doesn't block work.

9. **The existing dashboard's `cortextos` sidebar/header branding still references SOMA** — metadata title is `SOMA` but navigation copy wasn't swept. Iterative — rebrand as we rewrite routes.

10. **`orgs/` is gitignored** but `orgs/solo-scale/` exists in the working tree with our live bot tokens. `git status` will never show it; `git add orgs/` is the ONLY way to accidentally commit secrets. `CLAUDE.md` §6 says never use `git add` broader than file-by-file.

11. **Dev server + daemon restart interaction:** the Next.js dev server runs independently of PM2. Restarting the daemon (`pm2 restart cortextos-daemon`) doesn't touch the dashboard. Restarting dashboard: kill the next-dev process, re-run `cortextos dashboard`.

12. **Upstream rebases:** `git fetch upstream && git rebase upstream/main` picks up upstream SOMA fixes. Last rebase was during fork; we picked up 5 fixes for free. Re-do periodically once Phase 1 lands to main.

---

## How to update this file

- At the end of every session that ships a non-trivial commit:
  1. Update §1 "Resume in 30 seconds" — new branch tip, new signals.
  2. Update §3 "Where you are on the roadmap" — check off done items.
  3. Update §4 file map if new files landed.
  4. Prepend a commit line to §5 "Commit timeline".
  5. Update §6 ADR index if a new ADR was added.
  6. Update §8 "Next moves" — remove the one you did, advance the numbering, add any new ones discovered.
  7. Snapshot the updated file into `docs/handoffs/YYYY-MM-DD-NN-<topic>.md` at milestone points (end of a phase, major pivot).
- Keep the file under ~600 lines. If it grows, promote detail to `PROJECT_SOMA.md`.
- This file is a diff-friendly doc. Use bullet lists, tables, fenced commands. No prose essays.

---

*Last updated: 2026-04-25 after the multi-provider API engine + dashboard submit-UI landed. Phase 1 at ~99% — only the LLM-routed intent-parser fallback (synchronous Minion + subscription engine) remains as a polish item. Repo dir + GitHub rename (Tier D) is operator-driven; source code already supports both `~/SOMA` and `~/cortextos` as project root.*
