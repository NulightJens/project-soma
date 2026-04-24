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

- **What SOMA is:** a personal-to-organizational agent operating system. Persistent 24/7 Claude Code sessions coordinating via a durable priority queue (Minions, ported from gbrain), isolated by git worktrees (WorktreeManager, from gstack — Phase 2), surfaced through Telegram + Next.js dashboard. Forked from SOMA; absorbing gbrain (queue + memory) and gstack (subprocess pattern + worktree isolation); graphify as an enrichment pipeline (Phase 6).
- **Current branch:** `soma/phase-1-minions`
- **Last commit:** `608bfdd` — "soma: port MinionQueue class (queue.ts) with full state-machine coverage"
- **Green signals:** 41 Minions vitest cases passing; `npx tsc --noEmit` clean; dashboard runs at `localhost:3000` in full monochrome; `SOMA` daemon running a single enabled agent (`system`) via PM2.
- **Red signals:** none right now. Phase 1 scope is still ~60% done — worker/handlers/CLI pending.
- **Do not:** ingest any Solo Scale handoff content (ADR-009). Build SOMA fully agnostic first.

---

## Verify state (copy-paste)

```bash
cd ~/cortextos
git status                                               # should be clean
git log --oneline -3                                     # confirm at 608bfdd
npx tsc --noEmit                                         # silent = pass
npx vitest run tests/minions-engine.test.ts tests/minions-queue.test.ts  # 41 passed
pm2 list                                                 # cortextos-daemon online
curl -sI http://localhost:3000/login                     # HTTP/1.1 200 OK
```

If any of the above fails, see §9 Environment + §10 Gotchas before proceeding.

---

## Where you are on the roadmap

Phase 0 — fork + foundation ........ **DONE**
Phase 1 — Minions queue ............ **~60% done** ← you are here
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
| `worker.ts` — main loop + handler registry | **next** | — |
| `attachments.ts` helper + queue attachment CRUD | next | — |
| `protected-names.ts` gate | next | — |
| `handlers/shell.ts` | next | — |
| `handlers/runner.ts` — unified subscription + API per ADR-008/012 | next | — |
| `cortextos jobs` CLI | next | `src/cli/` |
| `jobs smoke --sigkill-rescue` regression test | next | `tests/` |
| Daemon integration (PM2 boots `jobs work`) | next | `src/daemon/` |
| Dashboard Queue page | next | `dashboard/` |

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
| `src/minions/queue.ts` | 1160 | `MinionQueue` class. All core state-machine methods. Attachments + protected-names gate TODO. |
| `src/minions/backoff.ts` | 34 | Exponential + fixed backoff with jitter |
| `src/minions/stagger.ts` | 33 | FNV-1a deterministic offset for same-cron decorrelation |
| `src/minions/quiet-hours.ts` | 86 | IANA-tz claim-time window gate |
| `src/minions/index.ts` | 21 | Public API barrel — import from here, not submodules |
| `tests/minions-engine.test.ts` | 193 | 7 vitest cases — schema, CRUD, idempotency, locks, tx |
| `tests/minions-queue.test.ts` | 507 | 34 vitest cases — every state transition, DAG, stall, timeout, pause/resume |

### Dashboard
| File | Purpose |
|---|---|
| `dashboard/src/app/globals.css` | Full monochrome theme bound to shadcn contract (ADR-010) |
| `dashboard/src/app/soma-tokens.css` | Parallel `--soma-*` namespace for SOMA-wrapped surfaces |
| `dashboard/src/app/layout.tsx` | Manrope wired as `--font-manrope`; title = "SOMA" |
| `dashboard/src/components/charts/chart-theme.ts` | Chart palette monochrome ramp; severity.error keeps `#ef4444` |
| 25 component files | Chromatic utilities swept to monochrome + icons + labels (see ADR-010 flagged visual-regression risks) |

### Upstream SOMA (inherited, not yet rewritten)
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
608bfdd  soma: port MinionQueue class (queue.ts) with full state-machine coverage
2a328e2  soma: adopt claudecode-harness for CLAUDE.md; ADR-013
1b50cea  soma: phase 1 foundation — SQLite engine + ADR-012 + small modules
3f54b80  soma: full monochrome dashboard restyle + directive recalibration
f613fe3  soma: phase 1 scaffold + monochrome design tokens
8fba559  docs: introduce Project SOMA — fork charter, architecture, roadmap
```

Everything below `8fba559` is upstream SOMA history (rebased at fork time).

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

---

## Open threads (blocked / deferred / watching)

| Item | State | Notes |
|---|---|---|
| Commit author identity | ongoing | Commits show `Max Computer <max@Maxs-Mac-mini.local>`. Fix with `git -C ~/cortextos config user.name "Jens Heitmann" && git -C ~/cortextos config user.email "jens@nulight.io"`. Not blocking. |
| `pm2 startup` for reboot persistence | not done | User needs to run the sudo command PM2 prints. Cosmetic for development. |
| Private repo for Solo Scale instantiation | deferred to after Phase 5 | Name TBD — `solo-scale-twin` / `nulight-twin` / other. |
| `/btw` context from earlier session | resolved | User clarified via "taken into account" + "don't dumb down" wording — captured as ADRs 011 + 012. |
| Dashboard visual-regression risks from monochrome sweep | acknowledged | Category badges, mid-tier stability, progress bars, bottleneck section. See ADR-010. |
| Hermes Agent install | parked | Installed at `~/.hermes/` but not configured. Decision on whether SOMA absorbs Hermes patterns or replaces it deferred. |
| Attachment CRUD + `attachments.ts` | deferred one pass | Next-up in Phase 1. Quick port. |
| `protected-names.ts` gate | deferred one pass | Next-up in Phase 1. Quick port. |

---

## Next moves (ranked)

1. **Port `worker.ts`** (~415 LOC from `/tmp/gbrain/src/core/minions/worker.ts`). Main loop: `claim → run handler → renewLock periodically → complete/fail`. SIGTERM wires into `ctx.shutdownSignal`. Handler registry with `register(name, handler)`. Writes `tests/minions-worker.test.ts` with handler-registration tests + sigkill rescue smoke.

2. **Port `attachments.ts` helper + wire queue attachment methods.** `validateAttachment` (size/base64/filename/duplicate checks) then `addAttachment/listAttachments/getAttachment/deleteAttachment` on `MinionQueue`. Schema update: `minion_attachments` needs a `content BLOB` column and `UNIQUE (job_id, filename)` constraint. Write tests.

3. **Port `protected-names.ts` gate.** 28 LOC trivial. Wire into `MinionQueue.add()`. Default protected set: `['shell']`. Test: unauthenticated submit of `shell` rejects; trusted submit with flag allows.

4. **Port `handlers/shell.ts`** (~311 LOC). env-allowlist subprocess handler. SIGTERM → 5s → SIGKILL. Renames env gate from `GBRAIN_ALLOW_SHELL_JOBS` → `SOMA_ALLOW_SHELL_JOBS`.

5. **Port `handlers/subagent.ts`** (~710 LOC, gbrain's Anthropic SDK path) + **gstack `claude -p` NDJSON pattern** into a single **unified `handlers/runner.ts`** per ADR-012. Engine selection: `subscription` (default, subprocess) vs `api` (Anthropic SDK, two-phase tool ledger). Shared code: transcript persistence, turn budgeting, cache discipline.

6. **`cortextos jobs` CLI.** Subcommands: `submit | list | work | cancel | replay | smoke | prune | attach | stats`. Uses `src/cli/commander` pattern. Wire `jobs work` to PM2 ecosystem.

7. **`jobs smoke --sigkill-rescue`** regression test. Submits a sleepy handler, SIGKILLs the worker mid-run, re-starts worker, confirms job re-enters `waiting` and re-claims successfully.

8. **Daemon integration.** Edit `ecosystem.config.js` generator in `src/cli/ecosystem.ts` to include a `cortextos-jobs-worker` entry alongside the daemon. Worker pool size configurable per-instance.

9. **Dashboard Queue page.** New Next.js route `dashboard/src/app/(dashboard)/jobs/page.tsx`. Lists jobs with filter by status/queue/name/priority. Per-job detail drawer with transcript, attachments, inbox. Cancel/retry/pause actions. Uses SOMA monochrome from day one.

### Starter commands

```bash
# Resume at next move #1
cd ~/cortextos
cat /tmp/gbrain/src/core/minions/worker.ts   # read first
# Then port to src/minions/worker.ts with SOMA adaptations annotated.

# After each port, the discipline:
npx vitest run tests/minions-*.test.ts
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
- **SOMA fork:** https://github.com/NulightJens/cortextos (public, MIT) — origin
- **Upstream:** https://github.com/grandamenium/cortextos — `upstream` remote (`git fetch upstream`)
- **Current branch:** https://github.com/NulightJens/cortextos/tree/soma/phase-1-minions
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

*Last updated: 2026-04-23 (late-evening) after commit `608bfdd`. Next update expected after `worker.ts` port lands.*
