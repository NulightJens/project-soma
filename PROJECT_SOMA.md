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

### ADR-013: Adopt claudecode-harness pattern for SOMA's CLAUDE.md
**Date:** 2026-04-23
**Context:** User surfaced `github.com/anothervibecoder-s/claudecode-harness` — a published CLAUDE.md template for running Claude Code on high-stakes SaaS work without quota hits or hallucinated success. Nine numbered sections (platform + ownership + hard limits + deployment + data discipline + security + hub-spoke + memory/retros + DB rules) — distils principles SOMA was going to invent anyway.
**Decision:** Adopt the harness structure for SOMA's repo-root `CLAUDE.md`. Fill each placeholder with SOMA-specific content (stack, ownership zones, verify commands, memory paths, ADR pointer). The harness becomes part of SOMA's own working discipline (how Claude Code works on the SOMA codebase) AND, later, the template SOMA generates for every user org via `cortextos init` (§8 agnostic distribution).
**Rationale:**
  - Zero-cost adoption of a battle-tested operational pattern.
  - Harness principles map 1:1 onto SOMA concepts we already have: Hub & Spoke → orchestrator + subagents; ownership matrix → department routing; memory/retros → Memory pillar + chronicle; hard limits → job-size gates in Minions.
  - Gives every Claude Code session that opens this repo the same operating context without re-deriving rules each time.
**Consequences:**
  - `CLAUDE.md` (previously a short contributing stub — content preserved in `CONTRIBUTING.md`) is replaced with the full harness.
  - Future: `templates/claude-md/` will ship a parameterizable harness template that `cortextos init` writes into every new org. Users get the harness pattern for their own business out of the box.
  - Multi-Model Consensus (harness §7) becomes a Phase 7 `consensus` Minion handler.
  - Retro habit formalized — every non-trivial session appends a chronicle entry in PROJECT_SOMA.md §13 AND updates the auto-memory `project_*` file.

### ADR-012: Synergy not silos — integrate overlapping capabilities
**Date:** 2026-04-23
**Context:** Clarification on ADR-011 after risk of over-literal interpretation. "Don't dumb down" meant preserve full capability; it did not mean ship parallel redundant implementations. Ports must harmonize, not sit as disconnected silos competing for the same role.
**Decision:** Where donor systems have overlapping capabilities, **integrate into a single coherent implementation** that preserves the full capability surface of each. No parallel-but-separate ports of the same concept. Concrete integrations:
  - **LLM execution handlers.** gbrain's `anthropic-subagent` (SDK + two-phase tool ledger) and gstack's `claude -p` subprocess pattern both run LLM reasoning. Integrate into **one unified `runner` handler** with engine selection (`subscription` default, `api` opt-in per ADR-008). Shared code: tool ledger durability, transcript persistence, turn budgeting, cache discipline. Engine-specific code: process spawn vs. SDK call.
  - **Persistent memory.** gbrain's page-of-record + typed graph and gstack's `learnings.jsonl` are both long-term memory. Integrate: learnings become typed edges (`learned_from` relation) in the unified brain graph. No separate JSONL sidecar.
  - **Scheduled work.** gbrain's `runCycle` + `cron-scheduler` skill and cortextOS's existing cron primitives are both scheduled execution. Integrate: `runCycle` phases become normal Minion jobs scheduled via cron-generator; cortextOS's existing cron entries migrate to Minions rows. One scheduler, not two.
  - **Skill format.** gbrain and gstack already share the `SKILL.md` + frontmatter convention (Garry Tan authored both). Adopt verbatim — no translation layer.
  - **Graph enrichment.** graphify's tree-sitter AST + Leiden clustering and gbrain's entity-extraction subagents are both graph writers. Integrate behind one `BrainEnricher` interface writing into gbrain's storage (per revised ADR-004).
  - **File bus vs. queue.** cortextOS's file bus carries *messages* (events, heartbeats, telemetry — lightweight pub/sub). Minions carries *work items* (durable tasks with priority, DAG, retry). Different purposes, cleanly separated. No overlap to integrate.
  - **Worktree + shell handler.** gstack's `WorktreeManager` and gbrain's shell-handler env allowlist combine: the worker allocates a worktree per job, the shell handler executes inside it with the scrubbed env. One pipeline, two primitives composed.
**Rationale:** Parallel implementations of the same concept produce silo conflicts, dilute the mental model, and force consumers to understand both. Integrated implementations preserve every capability while presenting a single coherent API.
**Consequences:** Every port proposal must answer: *is there an existing concept in SOMA that overlaps with this?* If yes, integrate. If no, introduce cleanly. "Is there overlap?" is a required ADR-012 check before any new module lands.

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

### ADR-014: User-facing edge filters both directions; internals stay complex
**Date:** 2026-04-23
**Context:** Load-bearing directive from user: *"the tools can speak complexly to itself but needs to have a proper communication filter to the user… the user is not going to be extremely experienced."* Target operator is a non-technical twin-owner running an agent against their own business, not a platform engineer.
**Decision:** SOMA's internals (queue payloads, handler protocols, inter-agent bus messages, transcripts, logs, structured errors) stay full-fidelity and technically rich — they are the machine's language and preserving them is what keeps ADR-011 honest. At every **user-facing surface** (Next.js dashboard, Telegram bot replies, future CLI wrapper / chat pane / voice surface), a bidirectional translation filter sits at the boundary:
  - **Input filter:** accept freeform simple phrases; map them to the correct structured backend call (job name + data shape, priority, queue, handler choice). Users are not expected to know job names, priority integers, queue identifiers, or handler schemas. An LLM-router is acceptable for intent parsing and will often be the right primitive.
  - **Output filter:** render structured results as plain-language headlines. Internal detail — full result JSON, stacktrace, token counters, child_done rollups, job IDs — stays available via progressive disclosure (drawer, "show details," debug toggle), never shoved into the primary view.
  - **Error surfaces:** plain-language cause + suggested next step, not a raw stack trace.
**Rationale:** ADR-011 forbids dumbing down the *capability surface*; ADR-014 forbids dumbing down the *capability surface* by mistaking "rich internals" for "rich UX." The filter is at the human boundary, not above the state machine. This is how you ship a tool that a solo operator can actually use without having to learn Minions.
**Consequences:**
  - Every user-facing route in `dashboard/` ships with progressive disclosure built in from day one — plain summary first, structured detail behind a toggle. No raw JSON in primary views.
  - Phase 1's dashboard Queue page (HANDOFF §9 slot #8) requires an input layer that parses freeform submissions into structured `queue.add()` calls. A deterministic form is the fallback; the primary path is freeform.
  - Telegram bot message formatting inherits the same rule.
  - Internal APIs, memory files, handler protocols, and logs are **not** affected — they stay in their native complexity.
  - Not a conflict with ADR-011: internals preserved in full; user-facing presentation filtered separately.

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

### 2026-04-23 (evening) — Phase 1 foundation + harness adoption
- **ADR-012 added** — synergy-not-silos clarification of ADR-011. Ports must integrate overlapping capabilities into single coherent implementations. Concrete integration plan documented for runner handlers (unified with engine selection), memory (learnings as typed edges), scheduled work (Minion jobs not parallel cron), skill format (shared gbrain/gstack SKILL.md adopted verbatim), file bus vs queue (different purposes, cleanly separated), worktree + shell handler (composed primitives).
- **better-sqlite3 + @types** added to root package.json for Minions SQLite engine.
- **Small Minion modules ported verbatim from gbrain** (MIT © Garry Tan): `backoff.ts`, `stagger.ts`, `quiet-hours.ts`. All under 100 LOC each, clean ports with only the Date→number boundary note in quiet-hours.
- **SOMA's first SQLite engine implementation** — `src/minions/engine-sqlite.ts`:
  - `better-sqlite3` backing the `QueueEngine` contract
  - Schema bootstrap from `schema.sql` on open
  - Connection PRAGMAs: WAL + NORMAL sync + FK on + 5s busy_timeout
  - Advisory locks via `BEGIN IMMEDIATE` + sentinel rows in `minion_rate_leases` with NULL `owner_job` (schema updated to allow this)
  - LIKE-pattern scope matching with proper ESCAPE for safe lock keys
  - Prepared-statement cache
  - Tx wrapper with rollback-on-throw / commit-on-resolve
- **Schema fix:** `minion_rate_leases.owner_job` made nullable so the table can serve both job-owned rate leases (FK to minion_jobs) and engine-owned advisory locks (NULL owner_job).
- **Public API barrel** — `src/minions/index.ts` — consumers import from this, not submodules directly.
- **Test suite** — `tests/minions-engine.test.ts` — 7 vitest cases: schema bootstrap, CRUD, idempotency uniqueness, lock acquire/release, lock contention timeout, tx rollback, tx commit, updated_at trigger. All 7 pass. `tsc --noEmit` clean across repo.
- **ADR-013 added** — harness adoption from `anothervibecoder-s/claudecode-harness`. Repo root `CLAUDE.md` replaced with full SOMA-filled harness (stack, ownership matrix, hard limits, local-first rules, data discipline, env/security, hub-spoke, memory/retros, DB/timezone rules, ADR habit). Old CLAUDE.md content was a short contributing stub — preserved in `CONTRIBUTING.md` unchanged.
- **Next up:** port `queue.ts` (~1150 LOC) — the big one. Will cover `add()`, `claim()`, `complete()`, `fail()`, `cancel()`, child DAG, cascade cancel, idempotency dedup, stall sweep.

### 2026-04-23 (late evening) — queue.ts port lands
- **`src/minions/queue.ts` ported** from gbrain's `queue.ts` (1152 LOC → ~920 LOC SOMA-adapted). All core state-machine methods present:
  - `add()` with idempotency fast-path + parent depth/cap validation + ON CONFLICT race catch
  - `getJob()` / `getJobs()` / `removeJob()`
  - `claim()` — priority-ordered, name-filtered, token-fenced. SOMA adaptation: Postgres `FOR UPDATE SKIP LOCKED` dropped — `engine.tx()` opens `BEGIN IMMEDIATE` which serializes writers at the DB level for single-writer SOMA. Postgres engine (Phase 7) will restore SKIP LOCKED.
  - `completeJob()` / `failJob()` — atomic token-fenced transitions with parent token-rollup + `child_done` inbox post + parent resolve + `remove_on_*` cleanup all inside one tx. No crash window between complete and parent resolve.
  - `handleStalled()` — rewritten to two-pass query + UPDATE since SQLite doesn't support UPDATE inside a CTE. Same stall-counter + dead-letter semantics.
  - `handleTimeouts()` — dead-letters active jobs past `timeout_at` with proper `lock_until > now` guard to avoid racing `handleStalled`.
  - `promoteDelayed()`, `cancelJob()` with recursive CTE cascade, `retryJob()`, `replayJob()`.
  - `resolveParent()`, `failParent()`, `removeChildDependency()`.
  - `pauseJob()` / `resumeJob()`.
  - `sendMessage()` / `readInbox()` / `readChildCompletions()` (uses SQLite JSON1 `json_extract` instead of Postgres `->>'type'`).
  - `renewLock()`, `updateProgress()`, `updateTokens()`.
  - `prune()`, `getStats()`.
- **Deferred to next pass:** attachment CRUD + `protected-names.ts` gate. Present as TODO in queue.ts docblock — requires `attachments.ts` helper port first.
- **Schema fix for SQLite ON CONFLICT:** `ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING` — SQLite requires the partial-index predicate in the target; Postgres tolerated the bare form.
- **Test coverage:** `tests/minions-queue.test.ts` — 27 vitest cases covering add + idempotency + parent DAG + max_children + maxSpawnDepth; claim priority + name filter + timeout_at; complete + token-fence + parent resolve + child_done; fail + delayed retry + dead + fail_parent + remove_dep; stall rescue + timeout handling + delayed promotion; cancel cascade; pause / resume / retry / replay; inbox read/write; renewLock token-fence; updateTokens accumulate; prune + stats. 34/34 pass (up from 7 in the engine-only suite → 41 total Minions tests green). `tsc --noEmit` clean repo-wide.
- **MinionQueue exported** via `src/minions/index.ts` barrel.
- **Next up:** port `worker.ts` (main loop, lock renewal, handler registry, SIGTERM → shutdown signal) + port `attachments.ts` + wire `cortextos jobs` CLI + regression test for `--sigkill-rescue`.

### 2026-04-23 (night) — Handoff system in place
- **`HANDOFF.md` created at repo root** — live resume-here snapshot (10 sections: 30-sec resume, verify commands, roadmap position, mental model, file map, commit timeline, ADR index, open threads, next moves ranked with starter commands, external refs, environment, gotchas, update checklist). ~470 lines, diff-friendly, no prose essays.
- **`docs/handoffs/`** directory created for dated milestone snapshots. First snapshot: `2026-04-23-01-phase1-queue-landed.md`.
- **`CLAUDE.md` §8 updated** to reference HANDOFF.md as the *first* thing read on resume (before this file). Added end-of-session checklist: update HANDOFF.md per its §10, snapshot at milestones, append to PROJECT_SOMA.md §13 chronicle, update the `project_*` auto-memory.
- **Auto-memory `project_agent_infra_setup.md` rewritten** to point at HANDOFF.md as the entry point. Trimmed duplicated state — HANDOFF.md is authoritative; memory just routes.
- **Purpose:** future sessions (any Claude Code instance opening this repo cold) get from "hi" to "I know what I'm doing" in under two minutes. No re-deriving context from commits + source code every time.
- **No new code.** Pure docs pass. `tsc --noEmit` still clean (it's just markdown).
- **Next up unchanged:** port `worker.ts` + attachments + protected-names gate + shell handler + unified runner + CLI + sigkill-rescue regression test + daemon integration + dashboard queue page.

### 2026-04-23 (night) — ADR-014 user-facing edge filter
- **New directive from user:** *"the tools can speak complexly to itself but needs to have a proper communication filter to the user… the user is not going to be extremely experienced."*
- **Captured as ADR-014** (§10): SOMA internals stay full-fidelity (preserves ADR-011); every user-facing surface — dashboard, Telegram, future CLI/chat — ships with a bidirectional translation filter. Simple freeform input → structured backend calls; rich structured output → plain-language summaries with progressive disclosure for the technical detail.
- **Complements, does not conflict with, ADR-011:** capability surface preserved in full; presentation is filtered only at the human boundary.
- **Inlined into HANDOFF.md §9 slot #8** (dashboard Queue page): plain-language summaries primary; JSON/stacktrace/IDs behind progressive disclosure; freeform submit UI routed through intent parser.
- **Auto-memory `project_soma_user_facing_edge.md`** written so the directive survives across chat sessions.

### 2026-04-23 (night) — MinionWorker port lands
- **`src/minions/worker.ts` ported** (~385 LOC) from gbrain's 415-LOC `worker.ts`. Concurrent in-process worker with per-job AbortController, lock renewal, stall/timeout sweeps on interval, SIGTERM/SIGINT graceful shutdown via a shared `shutdownAbort` controller (so shell-handler style cleanup hooks can subscribe to `ctx.shutdownSignal` without disrupting non-shell handlers).
- **`tick()` + `drain()` surface extracted** from gbrain's monolithic `start()` loop. The tick drives "promote delayed → claim → launch one job"; drain awaits all in-flight promises. The `start()` loop composes them with polling + stall-sweep interval. This split lets `tests/minions-worker.test.ts` drive the state machine deterministically without spinning on real `setInterval`s.
- **All Postgres `engine.executeRaw` calls in gbrain's worker routed through new MinionQueue helpers** (per ADR-012 — concentrate SQL rewrites in queue.ts, worker stays engine-agnostic):
  - `ctx.isActive` → `queue.isJobActive(id, lockToken)`.
  - `ctx.log(string|TranscriptEntry)` → `queue.appendLogEntry(id, lockToken, str)`. Postgres `jsonb || to_jsonb($1::text)` rewritten as read-parse-push-write inside a `BEGIN IMMEDIATE` tx since SQLite has no JSONB append.
  - Quiet-hours `'defer'` verdict → `queue.deferForQuietHours(id, lockToken, 15*60*1000)`. Postgres `now() + interval '15 minutes'` folded into JS ms math.
  - Quiet-hours `'skip'` verdict → `queue.skipForQuietHours(id, lockToken)`. Releases lock, then calls `cancelJob` with `error_text='skipped_quiet_hours'` — cascade cancel on descendants + `child_done` rollup is preserved.
- **`queue.ensureSchema()` call dropped** — SOMA's `openSqliteEngine` bootstraps DDL on open, not lazily on first worker start.
- **Test coverage:** `tests/minions-worker.test.ts` — 11 vitest cases.
  - Handler registration: empty-registry start() throws; `register()` + `registeredNames`; claim filter ignores jobs with no registered handler.
  - Happy path: claim → run → complete persists result + clears lock + sets finished_at; primitive handler return wrapped in `{value: x}`; ctx.updateProgress / ctx.updateTokens / ctx.log / ctx.isActive / ctx.readInbox all persist through the token fence.
  - Failure + retry: retryable throw → `delayed` with `delay_until` bumped by the calculated backoff; attempts exhaust → `dead`; `UnrecoverableError` → `dead` immediately regardless of attempts remaining.
  - **SIGKILL rescue smoke:** worker A claims a never-resolving job, worker "dies" (test advances injected clock past `lock_until`), `queue.handleStalled()` requeues, worker B completes cleanly. `stalled_counter` ticks to 1.
- **52/52 Minions tests pass** (up from 41: engine 7 + queue 34 + worker 11). `tsc --noEmit` clean repo-wide.
- **`MinionWorker` exported** via `src/minions/index.ts` barrel.
- **Next up:** port `attachments.ts` + extend `minion_attachments` schema with `content BLOB` + `UNIQUE (job_id, filename)`, wire CRUD onto MinionQueue. Then `protected-names.ts` gate, then handlers.
