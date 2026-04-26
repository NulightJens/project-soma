# Architecture

Component map, data flow, key file paths. Each section links to the ADR that introduced the design when relevant — the ADR log lives in [PROJECT_SOMA.md §10](../../PROJECT_SOMA.md).

## Component map

```
                       ┌──────────────────────────────────┐
   Telegram   ─────►   │       soma-daemon (PM2)          │
   (operator)          │                                  │
                       │  ┌────────────┐  ┌────────────┐  │
                       │  │ agent PTY  │  │ agent PTY  │  │  ← `claude` subprocesses
                       │  │  (system)  │  │ (analyst)  │  │     via node-pty
                       │  └────────────┘  └────────────┘  │
                       │           ▲       ▲              │
                       │           │       │              │
   Phone   ────────►   │      ┌────┴───────┴────┐         │
   (Telegram)          │      │   file bus      │         │  ← atomic-write
                       │      │  (events,       │         │     filesystem messages
                       │      │   approvals)    │         │
                       │      └─────────────────┘         │
                       │           ▲                       │
                       └───────────┼───────────────────────┘
                                   │
                                   │  IPC (Unix socket)
                                   │
                       ┌───────────┴──────────────────────┐
   Browser  ────►      │  SOMA-dashboard (PM2)            │
                       │  Next.js 16 + Tailwind v4        │
                       │  - /jobs (list)                   │
                       │  - /jobs/submit (Freeform/Adv)    │
                       │  - /agents, /experiments, ...     │
                       └──────────────────────────────────┘
                                   │
                                   │  shell-out: `soma jobs ...`
                                   ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │                     soma-jobs-worker (PM2)                          │
   │                                                                     │
   │   poll loop  ─►  claim ─►  handler dispatch                         │
   │                              │                                     │
   │                              ▼                                     │
   │   ┌───────────────────────────────────────────────────────┐        │
   │   │  Handlers (job.name → fn)                             │        │
   │   │   echo / noop / sleep        (always on)              │        │
   │   │   shell                       (SOMA_ALLOW_SHELL_JOBS) │        │
   │   │   subagent / subagent_aggreg. (SOMA_ALLOW_SUBAGENT)   │        │
   │   └───────────────────────────────────────────────────────┘        │
   │                              │                                     │
   │                              ▼ (subagent only)                     │
   │   ┌───────────────────────────────────────────────────────┐        │
   │   │  runnerHandler — dispatches by data.engine            │        │
   │   │                                                       │        │
   │   │   subscription engine    api engine                   │        │
   │   │      │                       │                        │        │
   │   │      ▼                       ▼                        │        │
   │   │   spawn `claude -p`     Provider seam                 │        │
   │   │   parse NDJSON           ├── anthropic (SDK)          │        │
   │   │                          ├── openai (fetch)           │        │
   │   │                          └── custom (env config)      │        │
   │   └───────────────────────────────────────────────────────┘        │
   └─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │                       Minions queue (SQLite)                        │
   │                                                                     │
   │   minion_jobs                  ← the queue itself                   │
   │   minion_inbox                 ← per-job message inbox              │
   │   minion_attachments           ← BLOB storage per job               │
   │   minion_rate_leases           ← engine-owned advisory locks        │
   │   minion_subagent_messages     ← API engine: replay log             │
   │   minion_subagent_tool_executions ← API engine: two-phase ledger    │
   └─────────────────────────────────────────────────────────────────────┘
```

## Process supervision

PM2 supervises three Node processes. None of them shares an event loop — work flows between them through the SQLite queue or Unix sockets, never through shared memory.

| App | Script | Role |
|---|---|---|
| `soma-daemon` | `dist/daemon.js` | Owns agent registry, spawns/restarts agent PTYs, polls Telegram, runs cron, serves IPC over `~/.soma/default/daemon.sock` |
| `SOMA-dashboard` | `npm run dev` (in `dashboard/`) | Next.js dev server. Reads the queue DB read-only; writes flow through `soma jobs ...` shell-outs |
| `soma-jobs-worker` | `dist/cli.js jobs work` | Polls the queue, claims one job at a time (configurable concurrency), dispatches to a handler, persists the result |

ADRs: [ADR-001](../../PROJECT_SOMA.md) (fork in place), [ADR-015](../../PROJECT_SOMA.md) (PM2 app naming + state-dir layout).

## State directories

```
~/.soma/<instance>/                       # canonical (was ~/.cortextos before ADR-015)
├── minions.db                            # SQLite queue + inbox + attachments + subagent state
├── daemon.sock                           # Unix socket: dashboard ↔ daemon IPC
├── dashboard.env                         # auto-generated NextAuth credentials
├── config/
│   └── enabled-agents.json               # which agents the daemon should keep alive
├── orgs/
│   └── <org>/
│       ├── secrets.env
│       └── agents/
│           └── <agent>/
│               ├── .env                  # per-agent env (BOT_TOKEN, ALLOWED_USER, etc.)
│               ├── IDENTITY.md
│               ├── SOUL.md
│               ├── GOALS.md
│               └── MEMORY.md
├── state/
│   └── <agent>/
│       ├── heartbeat.json
│       └── (agent-specific transient state)
├── inbox/<agent>/                        # per-agent file-bus messages
└── logs/<agent>/                         # rolling logs
```

`~/.cortextos` symlinks to `~/.soma` for backward compat with any external script that hadn't migrated.

## Data flow walkthroughs

### 1. Operator submits a job from the dashboard

```
1. User opens /jobs/submit, types "sleep 5 seconds" in Freeform tab.
2. POST /api/intents/parse → pattern matcher → {name: 'sleep', data: {ms: 5000}}.
3. UI renders confirmation card. User clicks "Confirm and submit".
4. POST /api/jobs/submit → validates input (no protected names), spawns
   `soma jobs submit sleep --data '{"ms":5000}' --json`.
5. CLI: openSqliteEngine → MinionQueue.add(...) (untrusted; protected-name
   gate runs but the name isn't protected so it passes).
6. Row inserted into minion_jobs with status='waiting', priority=0.
7. CLI emits the new job's JSON; Next.js route forwards it to the UI;
   UI redirects to /jobs?focus=<id>.
8. soma-jobs-worker poll loop sees the new row on next tick, claims it
   (status → 'active', lock_token = uuid, lock_until = now + 30s).
9. Handler dispatch: data.name === 'sleep', so sleepHandler runs;
   awaits 5000ms with cooperative abort wiring.
10. On return: queue.completeJob(id, lockToken, {slept_ms: 5000}).
11. /jobs page auto-refreshes (5s interval) and shows status='completed'.
```

ADR: [ADR-014](../../PROJECT_SOMA.md) (user-facing-edge filter — Freeform parser + structured Advanced fallback).

### 2. Subagent calls the api engine with the OpenAI provider

```
1. Operator submits via CLI:
   soma jobs submit subagent --trusted --data '{
     "engine": "api",
     "provider": "openai",
     "model": "gpt-4o-mini",
     "prompt": "Hello"
   }'
2. Worker claims; handler = runnerHandler (registered under 'subagent'
   when SOMA_ALLOW_SUBAGENT_JOBS=1).
3. runnerHandler reads data.engine='api' → getEngine('api') → api engine.
4. api engine checks SOMA_ALLOW_API_ENGINE=1 (cost-surface gate).
5. runApiLoop() — checks ctx.subagent (worker wired it), loads any prior
   messages (none on first run), persists seed user message.
6. Provider lookup: getProvider('openai') → makeOpenAiProvider() instance.
7. engine.acquireLock('api:openai:chat', 30000) — rate-lease around the
   outbound call.
8. provider.runTurn() — fetches OPENAI_API_KEY from env, builds
   /v1/chat/completions request body, fetches, parses choice[0].message.
9. Token usage extracted; ctx.updateTokens(...) writes to minion_jobs.
10. Assistant message persisted to minion_subagent_messages.
11. No tool_use blocks → loop exits with stop_reason='end_turn',
    final_text from content_blocks.
12. queue.completeJob(...) with the RunnerResult shape; row → 'completed'.
```

ADR: [ADR-008](../../PROJECT_SOMA.md) (subscription-first, api opt-in), [ADR-012](../../PROJECT_SOMA.md) (Provider seam).

### 3. A subagent submits a child job mid-loop using the `submit_minion` tool

```
1. Subagent is in mid-conversation; the model emits a tool_use block:
   {tool: "submit_minion", input: {name: "echo", data: {msg: "hello"}}}.
2. Loop intercepts, looks up the tool factory in the registry → bound to
   the live MinionQueue at worker construction.
3. submitMinion executor calls queue.add('echo', {msg:'hello'}, {parent_job_id: ctx.jobId})
   — UNTRUSTED (no allowProtectedSubmit), so 'shell'/'subagent'/'subagent_aggregator'
   would bounce. 'echo' is fine.
4. Two-phase ledger: minion_subagent_tool_executions row inserted with
   status='pending', then updated to 'complete' with {job_id, status: 'waiting'}.
5. Result is wrapped as a tool_result content block, fed into the next
   provider turn.
6. (Independently) The worker eventually claims the new echo job, runs
   it, posts a child_done message into the parent's minion_inbox.
7. The parent subagent can read it via the `read_own_inbox` tool.
```

ADR: [ADR-014](../../PROJECT_SOMA.md) (untrusted submitter invariant), tools detail in [src/minions/handlers/engines/api/tools/builtin.ts](../../src/minions/handlers/engines/api/tools/builtin.ts).

## Key file paths

### Substrate (cortextOS upstream — still active)

| File | Purpose |
|---|---|
| `src/daemon/index.ts` | Daemon entry point; spawns agent supervisors, telegram poller, IPC server |
| `src/daemon/agent-manager.ts` | Per-agent lifecycle: spawn PTY, watch heartbeat, restart on death |
| `src/pty/agent-pty.ts` | `claude` subprocess via `node-pty`; reads OAuth from Keychain or env |
| `src/bus/` | File-bus message types + atomic-write helpers |
| `src/cli/index.ts` | Commander root; registers all `soma <subcommand>` |
| `src/cli/ecosystem.ts` | Generates `ecosystem.config.js` from current org/agent state |

### Minions queue (Phase 1 ports)

| File | LOC | Purpose |
|---|---|---|
| `src/minions/types.ts` | ~400 | All job/inbox/attachment/subagent types + row mappers |
| `src/minions/schema.sql` | ~230 | DDL: 6 tables + indexes + update trigger |
| `src/minions/engine.ts` | ~75 | `QueueEngine` interface (sqlite/pglite/postgres/d1) |
| `src/minions/engine-sqlite.ts` | ~235 | better-sqlite3 implementation; advisory locks via `BEGIN IMMEDIATE` |
| `src/minions/queue.ts` | ~1500 | `MinionQueue` class — state machine + helpers + subagent persistence |
| `src/minions/worker.ts` | ~440 | `MinionWorker` — claim/run/complete loop + ctx wiring |
| `src/minions/attachments.ts` | ~110 | Pure validation; CRUD lives in queue.ts |
| `src/minions/protected-names.ts` | ~40 | Constant + helper; gate enforced in queue.add |
| `src/minions/handlers/shell.ts` | ~310 | Shell handler (env-allowlisted, kill-laddered) |
| `src/minions/handlers/registry.ts` | ~80 | Engine registry (leaf module) |
| `src/minions/handlers/runner.ts` | ~95 | Unified handler — dispatches by data.engine |

### LLM-loop engines

| File | Purpose |
|---|---|
| `src/minions/handlers/engines/subscription.ts` | claude CLI subprocess + NDJSON parser; default engine (ADR-008) |
| `src/minions/handlers/engines/api.ts` | API engine factory + queue binding + cost-surface gate |
| `src/minions/handlers/engines/api/loop.ts` | Provider-neutral multi-turn loop with crash-resumable replay |
| `src/minions/handlers/engines/api/types.ts` | `Provider`, `ApiToolDef`, `ProviderHttpError` |
| `src/minions/handlers/engines/api/providers/registry-leaf.ts` | Provider registry storage (TDZ-safe leaf) |
| `src/minions/handlers/engines/api/providers/anthropic.ts` | Anthropic SDK provider (lazy-imported) |
| `src/minions/handlers/engines/api/providers/openai.ts` | OpenAI-compatible provider (native fetch) |
| `src/minions/handlers/engines/api/providers/custom.ts` | `SOMA_API_CUSTOM_PROVIDERS` env loader |
| `src/minions/handlers/engines/api/tools/registry-leaf.ts` | Tool factory registry (TDZ-safe leaf) |
| `src/minions/handlers/engines/api/tools/builtin.ts` | `submit_minion`, `send_message`, `read_own_inbox` |

### Dashboard

| File | Purpose |
|---|---|
| `dashboard/src/app/(dashboard)/jobs/page.tsx` | List + auto-refresh + status filters + detail sheet (ADR-014) |
| `dashboard/src/app/(dashboard)/jobs/submit/page.tsx` | Freeform + Advanced submit UI |
| `dashboard/src/app/api/jobs/route.ts` | GET /api/jobs (list + stats) |
| `dashboard/src/app/api/jobs/[id]/route.ts` | GET + POST per-job (action: cancel \| retry) |
| `dashboard/src/app/api/jobs/submit/route.ts` | POST untrusted submit; shells out to CLI |
| `dashboard/src/app/api/intents/parse/route.ts` | POST freeform-text → structured intent |
| `dashboard/src/app/api/intents/parse/pattern-parser.ts` | Deterministic pattern matcher |
| `dashboard/src/components/ui/soma-mark.tsx` | Brand mark SVG (black circle + triangle) |
| `dashboard/src/lib/data/minions.ts` | Read-only better-sqlite3 access to the queue DB |
| `dashboard/src/lib/data/cortextos-cli.ts` | CLI resolver for shell-outs |

## Test surfaces

| Suite | Coverage |
|---|---|
| `tests/minions-engine.test.ts` | SQLite engine: schema, CRUD, idempotency, locks, tx |
| `tests/minions-queue.test.ts` | All MinionQueue state transitions + DAG + stall + cancel |
| `tests/minions-worker.test.ts` | Worker registry, claim/run/complete, retry, SIGKILL rescue |
| `tests/minions-attachments.test.ts` | Pure validation + queue CRUD round-trip |
| `tests/minions-protected-names.test.ts` | Membership + queue gate + trim-evasion |
| `tests/minions-shell-handler.test.ts` | Shell handler validation + execution + abort |
| `tests/minions-runner.test.ts` | Engine registry + dispatch + subscription engine integration |
| `tests/minions-api-engine.test.ts` | API loop + Anthropic provider + replay reconciliation |
| `tests/minions-api-openai.test.ts` | OpenAI translators + custom-endpoint loader |
| `tests/minions-api-tools.test.ts` | Tool registry + 3 builtin tools against real queue |
| `tests/cli-job-handlers.test.ts` | Built-in handler behaviour |
| `tests/cli-jobs-sigkill-rescue.test.ts` | Real subprocess SIGKILL → stall sweep regression |
| `dashboard/.../pattern-parser.test.ts` | Deterministic intent parser |

Discipline: 202/202 pass after Phase 1 closeout. Run with `npx vitest run tests/minions-*.test.ts tests/cli-*.test.ts dashboard/src/app/api/intents/parse/__tests__/pattern-parser.test.ts`.

## Where decisions live

| You want to know... | Read |
|---|---|
| Why a thing was built this way | [PROJECT_SOMA.md §10 ADR log](../../PROJECT_SOMA.md) |
| What changed yesterday | [PROJECT_SOMA.md §13 chronicle](../../PROJECT_SOMA.md) |
| What state we're in right now | [HANDOFF.md](../../HANDOFF.md) |
| How to write code on this repo | [CLAUDE.md](../../CLAUDE.md) |
| What the donor codebases gave us | [donor-lineage.md](./donor-lineage.md) |

Next reading: [agent-bootstrap.md](./agent-bootstrap.md) if you're about to make changes.
