# Project SOMA

> **Digital twins of agent brains.** A persistent, prioritized, context-isolated multi-agent system built by forking cortextOS and absorbing the strongest primitives from gbrain, gstack, and graphify.

| | |
|---|---|
| **Codename** | SOMA (after the game *SOMA* by Frictional Games — digital continuity of consciousness) |
| **Started** | 2026-04-23 |
| **Owner** | Jens Heitmann (nulight) |
| **Upstream fork** | grandamenium/cortextos (MIT) |
| **Destination** | nulight/cortextos (fork + evolve in place, rename deferred) |
| **License** | MIT (preserved from upstream; all sources MIT) |
| **Status** | Phase 0 — planning + documentation |

---

## Table of contents

1. [Vision](#1-vision)
2. [Genesis & naming](#2-genesis--naming)
3. [Core concept](#3-core-concept-digital-twins-of-agent-brains)
4. [Architecture](#4-architecture)
5. [Source components & attribution](#5-source-components--attribution)
6. [Cloudflare integration plan](#6-cloudflare-integration-plan)
7. [cortextOS-specific improvements](#7-cortextos-specific-improvements)
8. [Agnostic distribution model](#8-agnostic-distribution-model)
9. [Implementation roadmap](#9-implementation-roadmap)
10. [Decisions log (ADRs)](#10-decisions-log-adrs)
11. [Open questions](#11-open-questions)
12. [Glossary](#12-glossary)
13. [Chronicle](#13-chronicle)

---

## 1. Vision

SOMA is a personal-to-organizational agent operating system that:

- Runs **24/7** with crash recovery and context-window rotation.
- Works a **prioritized sequential task queue** — deterministic work claimed by workers, long-horizon judgment delegated to persistent orchestrators.
- Isolates every unit of work in its own **git worktree** so multiple agents never step on each other.
- Delegates heavy reasoning to **Claude Code subprocesses** using the user's subscription (flat-rate), reserves the metered API for cheap routing/planning.
- Persists shared memory in a **markdown-first, graph-backed** knowledge layer so agents compound their understanding over time.
- Exposes a **Telegram / dashboard / iOS control plane** usable from anywhere.
- Optionally sits behind **Cloudflare** (Tunnel, Workers, D1, R2, Durable Objects) for remote access and eventual distribution.
- Ships an **agnostic distribution** — any user can clone, configure, and run their own SOMA instance without leaking the original operator's identity or data.

The mental model: a town of agents, each with a workshop (worktree), a shared library (memory), a dispatcher (queue), a switchboard (bus), and a phone line to the user (Telegram). The town runs itself; the user supervises.

---

## 2. Genesis & naming

**2026-04-23.** The project started as a Telegram-controllable agent setup using cortextOS + Hermes Agent (Nous Research). After installing both and bringing a cortextOS `system` orchestrator online with a shared bot (`@SoloScale_Bot`), the question shifted from "how do we configure this" to "how do we build the *right* system."

Research into **gbrain** and **gstack** (both by Garry Tan, YC) revealed that each project independently solves one slice of what SOMA needs:

- cortextOS solves persistent process management + Telegram UX.
- gbrain solves durable task queueing + knowledge memory.
- gstack solves git-worktree isolation + Claude subprocess delegation.

No single project does all three, and graphify (safishamsi) adds a fourth axis — code cartography — worth adopting at the skill layer. Combining them deliberately rather than hoping they interoperate gives us SOMA.

**Why the name SOMA.** In the Frictional Games title *SOMA*, the core premise is that consciousness can be transferred — a brain scan produces a digital twin that believes itself continuous with the original. SOMA the project pursues the operational analog: an agent's working mind (context, memory, in-flight tasks, skills, voice) is reified in files on disk and rows in a queue, so when any single Claude Code session dies — compaction timeout, 71-hour rotation, OS crash — the next process picks up the scan and continues without apparent discontinuity.

---

## 3. Core concept: digital twins of agent brains

A SOMA **agent** is *not* a Claude Code process. A SOMA agent is a bundle of markdown files (identity, soul, goals, guardrails), a set of skills (gstack-style SKILL.md + frontmatter), an inbox on the file bus, and a row in the agent registry. The actual Claude Code processes that *embody* the agent are ephemeral — they are scanned in when needed, complete a turn or a task, and disappear. The brain is the files. The body is the process. When the body dies, a new body is cast from the same scan.

Consequences:

- **Agents outlive processes.** A crashed agent resumes mid-conversation on the next tick.
- **Multiple embodiments are trivial.** One agent brain can fan out to N worktrees in parallel (different facets of the same role).
- **Roles are composable.** The `social-media` agent and `content` agent can share 80% of their skill files and diverge only on voice + goals.
- **Handoff is native.** Moving work between agents is moving rows in the queue plus cross-links between brain files.

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Control plane: Telegram · iOS · Dashboard (Next.js) · CLI        │
│                        (inherited from cortextOS)                │
└──────────────────────┬───────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────┐
│ Orchestrator agents (persistent Claude Code PTY, PM2-managed)    │
│  - User-facing conversation                                      │
│  - Decompose requests into Minion jobs                           │
│  - Poll queue status, report, escalate                           │
└──────────────────────┬───────────────────────────────────────────┘
                       │ submit_job(priority, payload, parent?)
┌──────────────────────▼───────────────────────────────────────────┐
│ Minions: durable priority queue (ported from gbrain)             │
│  Backend: SQLite (dev) · PGLite (prod) · D1 (cloud, opt)         │
│  - Priority asc · delay_until · parent-child DAG                 │
│  - Stall rescue · idempotency · quiet hours · rate leases        │
└──────────────────────┬───────────────────────────────────────────┘
                       │ claim
┌──────────────────────▼───────────────────────────────────────────┐
│ Worker pool (PM2-managed · concurrency-bounded)                  │
│  Each tick:                                                      │
│    1. Claim next job by priority                                 │
│    2. Allocate git worktree (gstack WorktreeManager)             │
│    3. Branch: route by job.kind                                  │
│         deterministic → Node/TS handler (cheap API or local)     │
│         judgment      → spawn `claude -p` in worktree            │
│         interactive   → hand to persistent orchestrator          │
│    4. Harvest patch · dedup by SHA · commit to branch            │
│    5. Mark complete · emit heartbeat · post child_done           │
└──────────────────────┬───────────────────────────────────────────┘
                       │ reads/writes
┌──────────────────────▼───────────────────────────────────────────┐
│ Brain layer: markdown memory + typed graph + vector index        │
│  (gbrain-lite: pages-of-record + pgvector)                       │
│  Optional: graphify codebase maps per worktree                   │
└──────────────────────┬───────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────┐
│ Skill layer: fat markdown (gstack SKILL.md frontmatter)          │
│  triggers · allowed-tools · mutating · voice aliases             │
│  {{PREAMBLE}} + {{GBRAIN_CONTEXT_LOAD}} template injection       │
└──────────────────────────────────────────────────────────────────┘
```

**Routing rule** (lifted verbatim from gbrain):
> Deterministic same-input-same-output work → Minion handler.
> Judgment → subagent (Claude Code subprocess or API call).

This keeps token cost tuned to task shape and maps cleanly to the user's stated intent: "orchestration via APIs, workhorse via Claude."

### Key components (expanded)

| Component | Purpose | Source | Backend |
|---|---|---|---|
| **cortextos-daemon** | Process supervisor, file bus, Telegram poller, heartbeat | cortextOS (inherited) | Node + PM2 |
| **Minions queue** | Durable prioritized task queue with DAGs | gbrain (ported) | SQLite → PGLite → D1 |
| **WorktreeManager** | Per-job git worktree allocation + patch harvest | gstack (ported) | Node + git |
| **claude-subprocess handler** | Workhorse reasoning via subscription | gstack pattern | subprocess + NDJSON stream |
| **Brain layer** | Shared typed-graph memory + embeddings | gbrain-lite (ported) | SQLite/PGLite + pgvector |
| **Skill registry** | Fat-markdown dispatch w/ frontmatter | gstack format | filesystem |
| **Codebase map** (opt) | Tree-sitter AST graph per worktree | graphify (vendored) | JSON files, MCP |
| **Telegram poller** | User control plane | cortextOS (inherited) | HTTP long-poll |
| **Dashboard** | Web UI | cortextOS (inherited) | Next.js |
| **Tunnel** (opt) | Remote access | cortextOS + Cloudflare | cloudflared |

---

## 5. Source components & attribution

All four sources are **MIT-licensed** — legally clean to combine and redistribute.

### cortextOS — upstream
- **Repo:** github.com/grandamenium/cortextos
- **License:** MIT (c) 2026 Cortext LLC
- **Role:** base fork. Inherit wholesale.
- **Keep:** daemon, PM2 config, file bus, Telegram poller, PTY agent spawn (`src/pty/agent-pty.ts`), dashboard, install/init/add-agent CLIs, `knowledge-base/` scaffold.
- **Drop over time:** file-based task directory (replaced by Minions), orchestrator template's implicit coordination model (replaced by explicit queue).

### gbrain — memory + queue donor
- **Repo:** github.com/garrytan/gbrain
- **License:** MIT
- **Version observed:** v0.18.2 (2026-04-23)
- **Port into SOMA:**
  - `src/core/minions/queue.ts` + `worker.ts` + `handlers/*` (the durable queue)
  - `src/core/cycle.ts` (the `runCycle` 6-phase continuous maintenance primitive with `yieldBetweenPhases` hook)
  - `src/core/fail-improve.ts` (log LLM fallbacks → auto-derive deterministic regex paths)
  - `rate-leases.ts` (advisory-lock-based Anthropic concurrency cap)
  - Page-of-record + compiled-truth + timeline format for brain files
- **Read for philosophy:** `docs/ethos/THIN_HARNESS_FAT_SKILLS.md`
- **Leave behind:** multi-provider embedding abstraction (we can reintroduce later); `gbrain jobs work`'s Postgres-only assumption (we'll abstract to pluggable engine).

### gstack — workflow + isolation donor
- **Repo:** github.com/garrytan/gstack
- **License:** MIT
- **Version observed:** v1.6.4.0 (2026-04-23)
- **Port into SOMA:**
  - `lib/worktree.ts` `WorktreeManager` (designed to be imported)
  - `test/helpers/session-runner.ts` NDJSON stream parser for `claude -p --output-format stream-json`
  - `lib/gen-skill-docs.ts` SKILL.md templating (`{{PREAMBLE}}`, `{{GBRAIN_CONTEXT_LOAD}}`)
  - `/freeze` directory-scope edit lock skill
  - SKILL.md frontmatter schema (`triggers`, `allowed-tools`, `mutating`, voice aliases)
  - Continuous checkpoint mode (`WIP:` commits with `[gstack-context]` body)
  - Learnings JSONL per project
- **Adopt philosophy:** "thin harness, fat skills" — intelligence lives in markdown, not TS.
- **Leave behind:** browse daemon binary (Bun); OpenClaw/Cursor/Gemini-CLI adapters (we target Claude Code + API, agnostic distribution can add hosts later).

### graphify — codebase cartography (optional per-worktree skill)
- **Repo:** github.com/safishamsi/graphify
- **License:** MIT
- **Version observed:** v0.5.0 (2026-04-23 — pre-1.0, churning daily)
- **Use pattern:** *Not* as memory backend — gbrain's typed graph + pgvector is richer. Instead, treat graphify as a **vendored CLI skill** any worker can invoke on entering a new repo. Produces `graphify-out/GRAPH_REPORT.md` and optional MCP stdio server.
- **Lift two ideas into the brain layer:**
  1. Per-edge confidence tags `EXTRACTED | INFERRED | AMBIGUOUS`
  2. Tree-sitter AST extraction (25 languages) as a first-pass enricher that writes typed nodes into the brain
- **Defer:** adopting graphify as a platform component — it's too young and single-maintainer to depend on structurally.

---

## 6. Cloudflare integration plan

Cloudflare is a **distribution multiplier**, not a dependency. SOMA must run fully local (single Mac) and fully cloud (globally distributed) from the same codebase.

### Tier 1 — adopt immediately
- **Cloudflare Tunnel** (already in cortextOS via `cortextos tunnel`). Keep. Lets the dashboard and any webhook endpoints be reachable from the user's phone without port forwarding.

### Tier 2 — adopt when distributing
- **Cloudflare Workers** — public API surface for the agnostic distribution. Every SOMA instance gets a Worker subdomain; Worker auths incoming webhooks (Telegram, Stripe, GitHub, etc.) and forwards to the local daemon via Tunnel.
- **Cloudflare R2** — shared artifact storage for worktree harvests when multiple machines run the same SOMA org. One bucket per instance; harvest patches uploaded with SHA-addressed keys.
- **Cloudflare D1** — SQLite at the edge. Minions queue can back to D1 for fully-cloud deployments; local SQLite for dev; PGLite for on-premise production. Pluggable engine from day one (gbrain pattern).

### Tier 3 — evaluate later
- **Durable Objects** — one DO per worker or per agent brain for multi-node coordination. Only matters if SOMA scales beyond single-host.
- **Workers AI** — edge-hosted small models (Llama, Mistral) for routing/classification decisions that don't need Claude quality. Cost gate: free tier covers moderate use.
- **Queues** — Cloudflare's managed queue. Alternative to Minions polling loop when running cloud-native. Minions' durability model (lock_until + stalled_counter) already beats what Queues alone provide, so likely *integrate* (Minions layer on top of Queues) rather than replace.
- **KV** — config and session state that needs edge read latency. Probably unused.
- **Zero Trust Access** — gate the dashboard behind CF Access for organizations (SSO, MFA). For agnostic distribution this is how we do "secure remote admin" without rolling our own auth.

### Proposed engine abstraction

```ts
interface QueueEngine {
  kind: 'sqlite' | 'pglite' | 'postgres' | 'd1';
  submitJob(spec: JobSpec): Promise<JobId>;
  claimNext(workerId: string): Promise<Job | null>;
  // ...
}
```

One interface, four impls. Same rule for the brain layer (memory backend) and the artifact sink (filesystem / R2).

---

## 7. cortextOS-specific improvements

Things we'll fix as we fork:

1. **Replace ad-hoc file-bus tasks with Minions queue** — current cortextOS tasks live as JSON files in `bus/tasks/`. No priority, no retry, no DAG. Keep the file bus for *messages* (lightweight, pub/sub-y) and move *work items* to Minions. Clear split of concerns.
2. **Shift specialists from persistent PTY to ephemeral workers** — right now 6 agents = 6 Claude Code sessions burning context rotation. After SOMA, 1 persistent orchestrator PTY + N ephemeral subprocess workers pulled from the queue. Specialists become *skill bundles*, not processes.
3. **Unify identity / skill formats** — currently `IDENTITY.md`, `SOUL.md`, `GOALS.md`, `GUARDRAILS.md` per agent. Move to gstack SKILL.md frontmatter + gbrain page-of-record format. Auto-generated from templates with placeholder injection.
4. **Introduce `{{PREAMBLE}}` pattern** — every skill invocation gets update checks, session counting, learnings search, timeline log prepended automatically. Gstack proved this works.
5. **Add git-worktree isolation** — cortextOS has zero filesystem isolation today. Adding WorktreeManager removes a whole class of race-condition bugs.
6. **Port `runCycle` as the overnight maintenance primitive** — replaces any ad-hoc "run stuff at night" patterns.
7. **Add `fail-improve` telemetry** — every LLM fallback logged; regex patterns auto-derived from repeated failures; 87% deterministic goal (gbrain's reported result).
8. **Split "configured" vs "enabled" vs "running"** explicitly in the registry — cortextOS conflates these, which confused us on first run (all 6 agents were enabled by default even though only `system` was intended to start).
9. **Keychain fallback for headless deployments** — cortextOS spawns `claude` which reads macOS Keychain. For Linux/Docker/cloud distribution, we need `CLAUDE_CODE_OAUTH_TOKEN` env var path documented + `claude setup-token` wizard.
10. **Dashboard: surface the queue** — add pages for Minions job list, worktree status, memory search, skill catalog.

---

## 8. Agnostic distribution model

Goal: any user with a Claude Code subscription can `curl | bash` SOMA and have their own instance running in 5 minutes, with zero hardcoded references to nulight / Solo Scale / Jens.

Implementation:

- **Scrub all branding** from the fork. No `SoloScale` strings, no hardcoded bot usernames, no default org names beyond `default`.
- **Parameterize the install.mjs** to ask: org name, time zone, Telegram bot token, LLM provider (subscription vs API), Cloudflare integration yes/no.
- **Ship three reference org templates**: `solo` (one orchestrator, one worker), `team` (orchestrator + 5 specialists, like our current layout), `studio` (heavy multi-agent fanout with gbrain memory). Users pick on install.
- **Keep the nulight-specific `solo-scale` org** as a private addition in our working tree but *not* committed to the public distribution. Separate branch or submodule.
- **Publish to npm** as `@soma/cli` (or similar). One `npx @soma/cli init` command.
- **Document the Claude Code subscription path** vs the Anthropic-API-key path as a first-class choice in install.
- **License all original SOMA code MIT** to match the sources.

---

## 9. Implementation roadmap

### Phase 0 — Fork + foundation (current)
- [x] Research gbrain, gstack, graphify
- [x] Write PROJECT_SOMA.md (this file)
- [ ] Run `gh auth login` (user action)
- [ ] Fork grandamenium/cortextos → nulight/cortextos
- [ ] Update `origin` remote on local `~/cortextos`
- [ ] Commit + push SOMA doc to `main` or `soma/phase-0` branch
- [ ] Open tracking issues for phases 1–7

### Phase 1 — Minions queue + full handler suite (expanded per ADR-011)
- [x] Add `src/minions/` directory scaffold (README, types, schema, engine interface).
- [ ] **QueueEngine** — SQLite impl via `better-sqlite3` first; PGLite adapter second; Postgres and D1 stubs so the contract is exercised.
- [ ] **Port `queue.ts`** (~1150 LOC) — full status machine, priority claim, idempotency dedup, stall detection, cascade cancel, parent-child DAG, inbox, attachments, rate-leases, quiet-hours, stagger, backoff.
- [ ] **Port `worker.ts`** (~415 LOC) — concurrency-bounded claim loop, graceful SIGTERM → `ctx.shutdownSignal`, lock renewal, stalled sweep.
- [ ] **Port `handlers/shell.ts`** — env allowlist, SIGTERM → 5s → SIGKILL sequence, `GBRAIN_ALLOW_SHELL_JOBS` → `SOMA_ALLOW_SHELL_JOBS`.
- [ ] **Port `handlers/subagent.ts`** (710 LOC) — Anthropic SDK subagent with two-phase tool ledger, durable replay, prompt-cache discipline. Gated behind explicit opt-in per ADR-008.
- [ ] **Port `handlers/subagent-aggregator.ts`** — claims after all children resolve, synthesizes aggregate output.
- [ ] **New `handlers/claude-subprocess.ts`** (default per ADR-008) — spawns `claude -p --output-format stream-json --verbose` in allocated worktree; NDJSON parser lifted from `gstack/test/helpers/session-runner.ts`.
- [ ] **Port supporting modules** — `backoff.ts`, `quiet-hours.ts`, `stagger.ts`, `transcript.ts`, `attachments.ts`, `rate-leases.ts` (advisory lock → `BEGIN IMMEDIATE` on SQLite).
- [ ] CLI: `cortextos jobs submit | list | work | cancel | replay | smoke | prune | attach`.
- [ ] **Port `jobs smoke --sigkill-rescue`** as regression test.
- [ ] Integrate with daemon: daemon boots a `jobs work` process under PM2; existing `bus/tasks/*.json` migrator deprecates the file-based task system.
- [ ] Dashboard: new Queue page — job list with filtering by status/pillar/department/queue name, per-job detail (transcript, attachments, inbox), cancel/retry/pause actions. Uses SOMA monochrome from day one.

### Phase 2 — Worktree isolation (1 week)
- [ ] Copy `gstack/lib/worktree.ts` verbatim (with attribution); swap log sink.
- [ ] Add `worktree_allocate` handler: creates `~/.cortextos/<instance>/worktrees/<job_id>` on branch `soma/job/<job_id>`.
- [ ] Patch harvester: diff base → head, content-SHA dedup to `~/.cortextos/<instance>/harvests/`.
- [ ] `/freeze` skill equivalent as a job flag.

### Phase 3 — claude-subprocess worker (1 week)
- [ ] `claude-subprocess` handler spawns `claude -p --output-format stream-json --verbose` in worktree `cwd`.
- [ ] NDJSON stream parser lifted from `gstack/test/helpers/session-runner.ts`.
- [ ] Timeout + graceful cancel via `ctx.shutdownSignal`.
- [ ] Concurrency cap via rate-leases (port from gbrain).
- [ ] Mode selector: subscription (spawn) vs API (`MessagesClient`) — one handler, two modes.

### Phase 4 — Orchestrator rewrite (1 week)
- [ ] System agent's main loop: poll inbox → decompose → `submit_job` → poll status → reply to Telegram.
- [ ] Specialists converted from PTY to skill-bundle + job handler.
- [ ] Cascade the 5 disabled cortextos specialists (skool/social-media/brand/content/growth) into skill sets invoked by the system orchestrator.

### Phase 5 — Skill format unification (1 week)
- [ ] Adopt gstack SKILL.md frontmatter schema.
- [ ] Port `gen-skill-docs` with `{{PREAMBLE}}` + `{{BRAIN_CONTEXT_LOAD}}` injection.
- [ ] Migrate existing `templates/` (agent, orchestrator, analyst) to new format.
- [ ] CI: diff-exit-code guard on generated skills.

### Phase 6 — Brain layer (2–3 weeks)
- [ ] Port gbrain page-of-record format + directory layout.
- [ ] Port typed graph edges (with confidence tags lifted from graphify).
- [ ] Pluggable embeddings: OpenAI (default) + local fallback.
- [ ] Optional: integrate graphify as a per-worktree skill.

### Phase 7 — Hardening, Cloudflare, distribution (ongoing)
- [ ] Port `fail-improve.ts` telemetry loop.
- [ ] D1 adapter behind `QueueEngine`.
- [ ] R2 adapter behind `HarvestSink`.
- [ ] Worker for public webhook ingress.
- [ ] Distribution polish: brand scrub, install parameterization, three org templates, npm publish.

---

## 10. Decisions log (ADRs)

### ADR-001: Fork + evolve in place (not new repo)
**Date:** 2026-04-23
**Context:** Two options — fork cortextos and evolve, or start a new repo that pulls from all three.
**Decision:** Fork cortextos. Rename deferred.
**Rationale:** Preserves ability to pull upstream bugfixes. Cortextos has the most runtime code already working (PM2, daemon, Telegram, dashboard). gbrain/gstack are donors, not bases.
**Consequences:** We inherit cortextos's commit history and issue references. If we ever want to submit improvements back upstream, the path exists.

### ADR-002: SQLite as default queue backend (not Postgres)
**Date:** 2026-04-23
**Context:** gbrain's Minions is Postgres-native. SOMA needs a default that works on a fresh Mac install without spinning up a database.
**Decision:** SQLite via `better-sqlite3` as default. PGLite adapter second. Postgres + D1 as cloud options.
**Rationale:** Zero-config local dev. Same SQL surface as Postgres for most of Minions' queries. Migration story is clean (same schema, different driver).
**Consequences:** A few Postgres-specific features (advisory locks, JSONB operators) need SQLite-equivalent implementations. Rate-leases' advisory lock becomes a `BEGIN IMMEDIATE` transaction.

### ADR-003: Claude Code subscription is primary, API is secondary
**Date:** 2026-04-23
**Context:** SOMA targets subscription users first; API users second.
**Decision:** Default worker handler spawns `claude -p` subprocess. API handler exists as opt-in via `--engine api` flag or per-job routing.
**Rationale:** Flat-rate cost scales better for a 24/7 system. Cheap API models (Haiku) are still useful for routing/classification only — not for bulk reasoning.
**Consequences:** Distribution must document Keychain (Mac) + `CLAUDE_CODE_OAUTH_TOKEN` (headless) paths. Rate limits are per-account and will eventually bite; we mitigate with rate-leases.

### ADR-004 (revised 2026-04-23): Graphify as enrichment pipeline, gbrain as storage backbone
**Date:** 2026-04-23 (revision of original "skill, not backend" decision after "don't dumb down" directive)
**Context:** Graphify was first scoped as an optional skill to avoid coupling to a pre-1.0 tool. On reflection — per the "preserve finesse" directive (ADR-011) — that under-adopted its real capabilities.
**Decision:** Treat graphify as a set of **first-class enrichment pipelines** that write into gbrain's graph storage:
  - Tree-sitter AST extraction for 25 languages → typed call-graph nodes in the brain
  - Leiden community detection → cluster labels on the brain's graph
  - Multimodal ingest (PDF / image / video / Whisper) → typed nodes with provenance
  - God-node analytics + GRAPH_REPORT.md → surfaced as a memory view
  - Interactive HTML graph viz → dashboard integration
Keep gbrain's Postgres/SQLite + pgvector as the authoritative store. Graphify is never the backend; its pipelines are first-class writers into the gbrain schema.
**Rationale:** Graphify's extraction + clustering capabilities are real gaps in gbrain. Treating them as skills would waste them. The structural risk (pre-1.0, Python-only) is mitigated by pinning a tag, vendoring behind a `brain-enricher` interface, and keeping storage under gbrain.
**Consequences:** SOMA's brain layer has a pluggable `EnrichmentPipeline` interface. Graphify is one pipeline. SOMA can add its own first-party enrichers (e.g., TypeScript-specific, org-memory-specific) behind the same interface. A `brain-enricher` directory at `src/brain/enrichers/` holds them.

### ADR-005: Keep "SOMA" as codename, defer rename
**Date:** 2026-04-23
**Context:** User confirmed SOMA as the project name but asked not to rename the fork repo or packages yet.
**Decision:** Codebase is called "SOMA" in docs, configs, and new modules. Package/repo names stay `cortextos` until a rename pass happens later.
**Rationale:** Avoid a big-bang rename before the new architecture is stable. Renaming touches every file; easier to do once after Phase 5.
**Consequences:** Slight mismatch between internal naming and package names during phases 1–5. Documented here so it's not confusing.

### ADR-006: Cloudflare is distribution multiplier, not runtime dependency
**Date:** 2026-04-23
**Context:** User asked about incorporating Cloudflare.
**Decision:** SOMA runs fully local by default. Cloudflare (Tunnel, Workers, R2, D1) are opt-in adapters behind pluggable interfaces.
**Rationale:** Keeping local-first preserves the solo-founder / personal-KB use case. Cloud adapters add reach without coupling.
**Consequences:** Engine interfaces (QueueEngine, HarvestSink, MemoryStore, IngressAdapter) must be thoughtful from day one.

### ADR-007: "Orchestrator" preserved as internal term; Twin is the conceptual intent
**Date:** 2026-04-23
**Context:** Handoff's "Twin Principle" (§01) names the top-level AI layer a "digital twin" and explicitly says it IS the orchestrator reading the packet. User confirmed that the Twin naming is the conceptual intent but the codebase should keep "orchestrator" for internal reference to avoid a big-bang rename.
**Decision:** Code, configs, logs, APIs, and agent templates use `orchestrator`. External-facing documentation (PROJECT_SOMA.md §1–3, future user-facing copy) explains that the orchestrator IS the twin — same entity, two names for two audiences.
**Rationale:** Stable internal vocabulary across phases; avoid churn in every file that references the orchestrator role.
**Consequences:** Every developer-facing surface uses "orchestrator." Every business-facing surface (installer prompts, onboarding UX, handoff ingestion) says "twin" or "your business's twin." Both names refer to the same runtime process.

### ADR-008: Subscription-first execution; API is opt-in backup
**Date:** 2026-04-23
**Context:** Directive from user: prioritize the Claude Code subscription path first; the Anthropic API is a backup or opt-in choice.
**Decision:**
  - **Default worker handler** spawns `claude -p --output-format stream-json --verbose` subprocesses in the allocated worktree (gstack pattern). No API key required.
  - **API handler** (gbrain's Anthropic SDK subagent with two-phase tool ledger, 710 LOC) is **ported in full** — but gated behind an explicit opt-in: per-job flag `engine: 'api'`, per-org default `SOMA_DEFAULT_ENGINE=api`, or CLI flag `--engine api`.
  - Routing rule: if no explicit engine is specified, every job runs via subprocess. The API handler is never silently used.
  - Rate-leases (gbrain's concurrency cap primitive) apply to both handlers — subscription has per-account rate limits too.
**Rationale:** Supersedes ADR-003's softer "secondary" framing. API is not just "second-preference" — it is off-by-default and requires an explicit opt-in. Preserves the full API handler's capabilities (two-phase tool ledger, durable replay, etc.) without making it a stealth default that burns tokens.
**Consequences:** Installer asks once: "subscription or API?" Default is subscription. Per-job opt-in is surfaced in the CLI and dashboard. Documentation leads with subscription; API is a "power user" section.

### ADR-009: Solo Scale instantiation deferred; build the agnostic platform first
**Date:** 2026-04-23
**Context:** The user wants two SOMA deployments: (a) a private one modeled on the Solo Scale handoff, and (b) a public, sterile agnostic distribution. Direct instruction: "Do not ingest or build anything for solo scale right now, We just need to build the SOMA project first and then modify to solo scale."
**Decision:**
  - All Phase 1–5 work happens on the public `NulightJens/cortextos` fork with **zero Solo Scale content**.
  - No handoff ingestion, no 6-canonical-department wiring, no pdf-generator / skool-agent / motion-canvas / solo-scale-writer integration, no brand-solo-scale tokens.
  - The handoff files stay at `~/Downloads/solo-scale-handoff-2026-04-23` as reference material; PROJECT_SOMA.md does not ingest them.
  - Solo Scale instantiation becomes its own project, started **after** SOMA Phase 5 (orchestrator rewrite) lands. At that point a private repo (e.g., `solo-scale-twin`) consumes SOMA as a submodule and layers in the handoff.
**Rationale:** Keeps the platform honest: anything that gets built into SOMA must be useful to *any* twin-shaped business, not just Solo Scale. Enforces the agnostic-distribution goal at the code level. Prevents accidental entanglement.
**Consequences:** PROJECT_SOMA.md's roadmap and §8 agnostic-distribution section are the contract until SOMA Phase 5. The private Solo Scale repo is a downstream concern, not a SOMA concern.

### ADR-010: Full monochrome dashboard restyle (not token-only)
**Date:** 2026-04-23
**Context:** User directive: "modify Cortexos Full UI into the monochrome system that was given." Initial scope was token-layer only; this was insufficient — 67 chromatic Tailwind utilities across 23 component files + 3 inline hex values + 1 chart palette file all needed conversion.
**Decision:** Full restyle in one pass:
  - `globals.css` — OKLCH gold/mustard tokens → hex monochrome tokens bound to the shadcn contract. Destructive red is the one chromatic exception.
  - `soma-tokens.css` — parallel `--soma-*` namespace (still present for explicit SOMA-wrapped surfaces).
  - `layout.tsx` — body font default swapped Sora → Manrope; metadata title cortextOS → SOMA.
  - All 25 component files swept: success/warning/info/category → monochrome + icon + label; destructive retained.
  - `chart-theme.ts` — gold/blue/purple/pink/green palette → monochrome ramp `[#15171a, #4b4d52, #808286, #b4b5b8, #e5e7eb, #999999]`; severity `error` kept as `#ef4444`.
  - 3 lingering inline hex values (urgent badge, markdown link color, cost-tracking chart) all converted.
**Rationale:** "Full UI" means full UI. Partial token-layer work leaves the dashboard speaking two visual languages, which violates the brand's monochrome rule.
**Consequences:** Known visual-regression risks (flagged by the sweep agent): `category-badge.tsx` categories now differ by label only; `fleet-health.tsx` mid-tier stability reads similarly to healthy; `goal-item.tsx` amber progress bars now look like any filled bar; `bottleneck-section.tsx` visual prominence reduced. Addressable iteratively if felt in real use.

### ADR-011: Don't dumb down — preserve the finesse of every donor system
**Date:** 2026-04-23
**Context:** Load-bearing directive from user: *"do not reduce functionality of the system to match the narrative, effectively do not make the system dumber to adhere to intended narrative."*
**Decision:** Every capability from every donor system ports **in full**, not as a subset. Narrative-driven simplification is banned. Specifically:
  - gbrain: port the entire Minions package (queue, worker, all handlers including the 710-LOC subagent handler with two-phase tool ledger, aggregator, transcript, rate-leases, quiet-hours, stagger, backoff), `runCycle` with `yieldBetweenPhases`, `fail-improve` loop, page-of-record + timeline format, typed graph with confidence tags, pgvector hybrid search.
  - gstack: port `WorktreeManager`, `session-runner` NDJSON parser, `{{PREAMBLE}}` template pipeline, `gen-skill-docs`, continuous-checkpoint `WIP:` commits, learnings JSONL, `/freeze` + `/guard` + `/careful` scope locks, sidebar-agent, pair-agent ref system (`@e1`/`@c1`), cross-model second opinions, intent classifier.
  - graphify: elevated to first-class enrichment pipeline (see revised ADR-004) — tree-sitter AST, Leiden clustering, multimodal ingest, god-nodes.
  - cortextOS: PM2 daemon + crash recovery + 71-hour rotation + file bus + Telegram poller all preserved.
**Rationale:** The Twin Principle is the organizing narrative. It is not a ceiling on capability. A dumber twin is a worse twin. Every donor system solves a real problem; discarding capabilities to fit a cleaner story compounds into a weaker platform.
**Consequences:** Phase-level scope expands. Phase 1 alone now includes the full gbrain subagent handler (gated per ADR-008 but ported in full). Phase 6 (brain) is larger than initially sketched. Phase lengths in §9 are indicative — real work expands to match capability preservation.

---

## 11. Open questions

- **Q1 — Fork destination:** is `nulight` a GitHub org or a personal account? `gh auth login` will clarify.
- **Q2 — Repo rename timing:** after Phase 5, rename `cortextos` → `soma` (or `soma-os`)? Defer.
- **Q3 — Distribution name:** the public agnostic package name. `soma-os`? `@soma/cli`? Reserve early.
- **Q4 — Graphify adoption depth:** vendor as git submodule vs npm dep (it's Python, so neither — pip install in a venv). Likely pin to a tag and document.
- **Q5 — Telemetry opt-in:** gstack has an opt-in Supabase telemetry pipeline. Do we ship the same pattern or stay zero-telemetry?
- **Q6 — Multi-tenancy:** is a SOMA instance ever shared across humans, or always single-user? Currently single-user; multi-tenancy is a "not now" but affects schema choices.
- **Q7 — iOS app:** cortextOS mentions "Native iOS app coming soon." Do we build this or defer?

---

## 12. Glossary

| Term | Meaning |
|---|---|
| **Agent** | Bundle of markdown (identity, goals, guardrails) + skills + inbox + registry row. *Not* a process. |
| **Brain** | The persistent files representing an agent's mind. Survives process death. |
| **Body** | The transient Claude Code process or subprocess instantiating a brain for a turn. |
| **Embodiment** | One body of one brain. Multiple embodiments of the same brain can run in parallel. |
| **Orchestrator** | A persistent PTY agent with user-facing conversation and decomposition duties. |
| **Worker** | An ephemeral subprocess that claims a Minion job, runs it in a worktree, reports back. |
| **Minion** | A single job row in the queue. |
| **Worktree** | A git worktree allocated per job for filesystem isolation. |
| **Skill** | A fat markdown file (SKILL.md + frontmatter) that the agent invokes to accomplish work. |
| **Harness** | The thin runtime (this codebase) that executes skills. "Thin harness, fat skills." |
| **Scan** | The persistent files of a brain — the "digital twin" in SOMA's naming metaphor. |

---

## 13. Chronicle

Linear journal. Append-only. Each entry: date, one-line summary, what happened, what it changed.

### 2026-04-23 — Project begins
- cortextOS + Hermes installed earlier today for Telegram-controllable agents.
- Brought up cortextOS `solo-scale` org with `system` orchestrator; 5 specialists (skool, social-media, brand, content, growth) configured but disabled.
- Discovered `ALLOWED_USER` security gate; added to all agent `.env` files; `system` online in Telegram as @SoloScale_Bot.
- Researched gbrain (Garry Tan): found Minions queue + markdown-first memory + `runCycle` maintenance primitive.
- Researched gstack (Garry Tan): found WorktreeManager + `claude -p` subprocess pattern + fat-markdown skills.
- Researched graphify (Safi Shamsi): promising codebase-cartography tool but too young to depend on structurally; adopt as skill, not platform.
- User named the project **SOMA**.
- Decided to fork + evolve cortextos rather than start fresh.
- `gh auth login` completed as `NulightJens`.
- Forked grandamenium/cortextos → NulightJens/cortextos. Remotes: `origin` = fork, `upstream` = original.
- Rebased local branch onto upstream `main`, picked up 5 upstream fixes (telegram validation, cron gap detection, HTML parse mode, cron boot, IPC hard-restart).
- Committed PROJECT_SOMA.md to `main` (commit `8fba559`).
- Started branch `soma/phase-1-minions`.
- **Design system adopted.** User supplied Jens personal monochrome brand (`brand-jens-monochrome.css` + `03-brand-jens-personal.md`). Visual tokens only — brand/voice rules explicitly excluded per user direction. Decision: add SOMA tokens as a parallel namespace (`--soma-*`) alongside the existing cortextOS gold theme so new SOMA UI can adopt immediately without restyling the legacy dashboard. Full theme cut-over deferred to a dedicated commit when enough SOMA UI exists to justify the churn.
  - `dashboard/src/app/soma-tokens.css` added — light + dark `--soma-*` palette, `.soma` wrapper class with `var(--font-manrope)`, surface/CTA data-attribute helpers.
  - Manrope wired into `dashboard/src/app/layout.tsx` alongside existing Sora + JetBrains_Mono.
- **Phase 1 scaffold.** `src/minions/` created with port plan, types, schema, engine interface.
  - `src/minions/README.md` — port status table file-by-file, backend matrix, list of adaptations from gbrain (Date→number, JSONB→TEXT, advisory lock→BEGIN IMMEDIATE, subagent handler split into `claude-subprocess`).
  - `src/minions/types.ts` — core job/inbox/attachment/context types. Anthropic-specific subagent/tool types deliberately omitted; SOMA's subprocess handler will have its own types.
  - `src/minions/schema.sql` — SQLite DDL for `minion_jobs`, `minion_inbox`, `minion_attachments`, `minion_rate_leases`, plus claim/stall/parent/idempotency indexes and an `updated_at` refresh trigger.
  - `src/minions/engine.ts` — `QueueEngine` interface (`sqlite | pglite | postgres | d1`). Phase 1 ships SQLite impl only; other adapters fill the interface later.
- `tsc --noEmit` clean for whole repo.
- **Next up:** port `queue.ts` + `worker.ts` + `backoff.ts` + `quiet-hours.ts` into the SQLite engine, wire `cortextos jobs` CLI, port `jobs smoke --sigkill-rescue` as regression test.

### 2026-04-23 (afternoon) — Directive recalibration + full dashboard monochrome
- **User directive: "do not reduce functionality of the system to match the narrative."** Captured as ADR-011. Every donor system's capabilities now port in full; narrative-driven simplification is banned. Phase 1 scope expanded accordingly: full gbrain subagent handler (710 LOC) ports alongside `claude-subprocess` handler per ADR-008.
- **ADR-004 revised.** Graphify elevated from "optional skill" to first-class enrichment pipeline writing into gbrain storage. Tree-sitter AST (25 languages), Leiden clustering, multimodal ingest, god-node analytics.
- **ADR-007 added.** `orchestrator` is the internal term; `twin` is the conceptual intent. Dev-facing surfaces use `orchestrator`; business-facing surfaces use `twin`.
- **ADR-008 added** (supersedes ADR-003's framing). Subscription-first, API **opt-in only** — default worker handler spawns `claude -p`. API subagent is ported in full but gated behind explicit `--engine api` / `SOMA_DEFAULT_ENGINE=api` / per-job flag.
- **ADR-009 added.** Solo Scale instantiation deferred. SOMA built fully agnostic on `NulightJens/cortextos`; no handoff ingestion, no 6-department wiring, no Solo Scale content. Private repo (future `solo-scale-twin`) consumes SOMA after Phase 5 lands.
- **ADR-010 added.** Full dashboard monochrome restyle executed (not token-only):
  - `globals.css` — OKLCH gold/mustard → hex monochrome bound to shadcn contract.
  - `soma-tokens.css` — parallel `--soma-*` namespace preserved.
  - `layout.tsx` — body font Sora → Manrope; metadata cortextOS → SOMA.
  - 25 component files swept (67 chromatic utilities replaced with monochrome + icons + labels, semantic meaning preserved via `IconCheck` / `IconAlertTriangle` / `IconAlertCircle` / shape variation for status dots).
  - `chart-theme.ts` — chromatic palette → monochrome ramp; `severity.error` kept as `#ef4444` per ADR.
  - 3 inline hex values (urgent badge, markdown link color, cost-tracking chart) all converted.
  - `tsc --noEmit` clean.
  - Flagged visual-regression risks (category badges, mid-tier stability, progress bars, bottleneck section) documented in ADR-010.
- **Research ingestion complete.** All 9 handoff files read + brand tokens inspected. Twin Principle (§01) confirmed as conceptual alignment with SOMA's "brain = files, body = process" metaphor — the name SOMA maps directly onto the handoff's thesis. No handoff content ingested into code or memory per ADR-009.
- **Phase 1 port in progress** under expanded scope. Full gbrain Minions package + both handler paths + supporting modules + queue dashboard page.
