---
title: Donor lineage
description: What was inherited from cortextOS, ported from gbrain and gstack, and what's deferred to later phases.
---

# Donor lineage

SOMA is a fork-and-evolve project. Three open-source codebases provided the load-bearing patterns; one provided the harness template. All MIT-licensed. This page is the source of truth for who contributed what — useful when reviewing a port commit, when checking whether a behaviour is original-to-cortextOS or new-to-SOMA, or when deciding which donor to consult for a future feature.

## At a glance

| Donor | Author | Role | License | Status in SOMA |
|---|---|---|---|---|
| **cortextOS** | grandamenium | Substrate (daemon, PTY, file bus, dashboard) | MIT | Forked; still upstream-trackable via `git fetch upstream` |
| **gbrain** | Garry Tan | Minions queue + tool runtime + memory primitives | MIT | Queue + handlers ported in Phase 1; memory deferred to Phase 6 |
| **gstack** | Garry Tan | Subprocess pattern + worktree isolation + skill format | MIT | Subprocess pattern ported in Phase 1; worktrees deferred to Phase 2; skill format adopted Phase 5 |
| **graphify** | Safi Shamsi | Codebase enrichment (tree-sitter AST + clustering) | MIT | Adopted as enrichment pipeline; lands Phase 6 |
| **claudecode-harness** | anothervibecoder-s | CLAUDE.md template | MIT | Adopted verbatim as the SOMA `CLAUDE.md` (ADR-013) |

Donor repos:
- cortextOS: https://github.com/grandamenium/cortextos
- gbrain: https://github.com/garrytan/gbrain (cloned at `/tmp/gbrain` for Phase-1 porting)
- gstack: https://github.com/garrytan/gstack (cloned at `/tmp/gstack`)
- graphify: https://github.com/safishamsi/graphify (cloned at `/tmp/graphify`)
- claudecode-harness: https://github.com/anothervibecoder-s/claudecode-harness (cloned at `/tmp/claudecode-harness`)

---

## cortextOS — substrate (still active)

What we got from cortextOS and kept verbatim. Most of `src/` outside `src/minions/` is upstream-original.

| Subsystem | Path | Purpose |
|---|---|---|
| Daemon | `src/daemon/` | Long-running supervisor process. Holds the agent registry, restarts dead PTYs, polls Telegram, runs cron, handles IPC over a Unix socket. |
| Agent PTY | `src/pty/agent-pty.ts` | Spawns `claude` CLI through `node-pty`. Reads OAuth from macOS Keychain (or `CLAUDE_CODE_OAUTH_TOKEN` for headless). Env-allowlisted to prevent secret leakage into the subprocess. |
| File bus | `src/bus/` | Atomic-write filesystem-backed message bus. Carries events, heartbeats, telegram messages, and approvals between agents. |
| CLI | `src/cli/` | `cortextos init / add-agent / start / status / dashboard / ecosystem / install / doctor`. Adopted; `soma jobs ...` (added in Phase 1) follows the same Commander pattern. |
| Dashboard runtime | `dashboard/` | Next.js 16 + React 19 + Tailwind v4 + shadcn + `@base-ui/react`. Auth gate, sidebar, monochrome theme (post ADR-010). |
| PM2 ecosystem generator | `src/cli/ecosystem.ts` | Auto-generates `ecosystem.config.js` from current org + agent set. |
| Templates | `templates/` | Per-agent markdown scaffolds (IDENTITY / SOUL / GOALS / SKILLS / GUARDRAILS). Used by `soma add-agent`. |

What we changed in upstream code:

- Display rebrand: `cortextOS` → `SOMA` across user-visible prose, dashboard UI, docs, package metadata. (ADR-015 Tier A.)
- State-dir rename: `~/.cortextos/` → `~/.soma/` with backward-compat symlink. (ADR-015 Tier B.)
- PM2 app names: `cortextos-daemon` → `soma-daemon`, etc. (ADR-015 Tier C.)
- `soma` bin alias added alongside `cortextos`.

What we did NOT change (and why):
- The daemon itself, agent PTY, and file bus internals — they work, they're upstream-mergeable, and the queue layers on top rather than replacing them.
- Org template schema — Phase 5 will revisit when we unify with gstack's `SKILL.md` format.

---

## gbrain — Minions queue + tool runtime (Phase 1 ported)

The big port. gbrain's `src/core/minions/` is what makes SOMA durable.

| File in donor | LOC | Status | SOMA destination |
|---|---|---|---|
| `minions/queue.ts` | 1152 | Ported | `src/minions/queue.ts` (~1380 LOC after attachment + protected-name + subagent-persistence helpers) |
| `minions/worker.ts` | 415 | Ported | `src/minions/worker.ts` (~440 LOC after subagent ctx wiring) |
| `minions/types.ts` | 287 | Adapted | `src/minions/types.ts` (Postgres types → SQLite affinities; subagent persistence types added) |
| `minions/backoff.ts` | 34 | Verbatim | `src/minions/backoff.ts` |
| `minions/stagger.ts` | 33 | Verbatim | `src/minions/stagger.ts` |
| `minions/quiet-hours.ts` | 86 | Verbatim | `src/minions/quiet-hours.ts` |
| `minions/attachments.ts` | 110 | Verbatim | `src/minions/attachments.ts` |
| `minions/protected-names.ts` | 28 | Verbatim | `src/minions/protected-names.ts` |
| `minions/handlers/shell.ts` | 311 | Ported | `src/minions/handlers/shell.ts` (env-gate renamed; otherwise unchanged) |
| `minions/handlers/subagent.ts` | 710 | Ported + abstracted | `src/minions/handlers/engines/api/loop.ts` + `providers/anthropic.ts` (Provider seam added; subagent_rate_leases table replaced by SOMA's `engine.acquireLock`) |
| `minions/tools/brain-allowlist.ts` | — | Deferred | Phase 6 (brain-derived tool registry); SOMA Phase 1 ships 3 minimal queue-internal tools instead |
| `core/cycle.ts` | — | Deferred | Phase 6 (`runCycle` maintenance primitive) |
| `core/fail-improve.ts` | — | Deferred | Phase 7 (self-improvement retros) |
| `core/memory.ts` | — | Deferred | Phase 6 (markdown-first memory) |

### Adaptations from gbrain Postgres → SOMA SQLite

| gbrain (Postgres) | SOMA (SQLite) | Why |
|---|---|---|
| `BIGSERIAL` PK | `INTEGER PRIMARY KEY` | SQLite rowid alias; same auto-increment semantics |
| `TIMESTAMPTZ` | `INTEGER` (Unix ms) | SQLite has no native timezone-aware time; centralise on Unix-ms-as-number throughout |
| `JSONB` | `TEXT` (JSON-encoded) | App-side `JSON.stringify` on write, `JSON.parse` on read at the row-mapper boundary |
| `now()` SQL | `engine.now()` JS | Centralised clock so tests can inject |
| `FOR UPDATE SKIP LOCKED` | dropped — `BEGIN IMMEDIATE` serialises writers | Single-writer SOMA preserves correctness; Postgres engine (Phase 7) restores SKIP LOCKED |
| `pg_advisory_xact_lock` | sentinel-row pattern in `minion_rate_leases` | Postgres engine (Phase 7) restores `pg_advisory_xact_lock` |
| `count(*) FILTER (WHERE cond)` | `SUM(CASE WHEN cond THEN 1 ELSE 0 END)` | Same semantics, broader compatibility |
| `to_jsonb($x::text) \|\| stacktrace` | JS-side read-parse-push-write inside `BEGIN IMMEDIATE` tx | SQLite has no JSONB append operator |
| Anthropic-specific subagent rate-leases table | reused `engine.acquireLock(...)` over `minion_rate_leases` | Avoid two parallel rate-lease implementations (ADR-012) |

Every deviation is annotated `// SOMA:` inline at the call site.

---

## gstack — subprocess pattern (Phase 1 partial; worktrees Phase 2)

| File in donor | Status | SOMA destination |
|---|---|---|
| `test/helpers/session-runner.ts` (NDJSON spawn) | Ported (adapted) | `src/minions/handlers/engines/subscription.ts` — `spawn('claude', ['-p', '--output-format', 'stream-json', ...])`, pure `ingestNDJSONLine` parser, kill ladder on both `ctx.signal` and `ctx.shutdownSignal` |
| `lib/worktree.ts` (`WorktreeManager`) | Pending Phase 2 | Will live at `src/minions/worktrees/` — per-job git worktree create/cleanup hooks around handler invoke |
| `autoplan/SKILL.md` (skill format) | Pending Phase 5 | Will become the canonical SOMA skill format (gstack/gbrain converge on the same shape) |
| `lib/gen-skill-docs.ts` | Pending Phase 5 | Skill catalog generation |
| `ETHOS.md` | Reference only | Informed CLAUDE.md and ADR-011 wording |

What gstack contributed conceptually:

- The "claude as subprocess" pattern. Rather than embedding the model in your process, you spawn the CLI, hand it a prompt over stdin, parse NDJSON from stdout. Easier to kill, easier to compose, easier to switch to a different binary.
- The kill ladder discipline (SIGTERM → grace period → SIGKILL) wired to both timeout-style and shutdown-style abort signals. Lifted into the shell handler and subscription engine.
- The worktree-per-job invariant for parallel safety. Not yet shipped — Phase 2.

---

## graphify — enrichment pipeline (Phase 6 pending)

What we'll adopt from graphify when the brain layer lands:

| Capability | Source path | Use in SOMA |
|---|---|---|
| Tree-sitter AST extraction (25 languages) | `graphify/extract/` | Brain-enricher: index codebases into typed-edge graph |
| Leiden clustering on the graph | `graphify/build/` | Cluster related concepts for retrieval |
| Multimodal ingest (PDF/audio/video transcription) | `graphify/ingest/` | Optional skill-driven ingestion paths |
| God-node analytics | `graphify/serve/` | Identify central concepts during summarisation |

What we will NOT adopt:
- Graphify as the memory backend itself. SOMA stores memory in markdown + the brain graph (typed edges over rows in `minion_jobs.result` + a future `learnings` table). Graphify enriches; gbrain-style storage is canonical.

---

## claudecode-harness — CLAUDE.md template (adopted)

`anothervibecoder-s/claudecode-harness` provides the 10-section CLAUDE.md template structure (Platform & Mission / Ownership / Hard Limits / Local-First / Data Discipline / Env & Security / Hub-Spoke / Memory & Retros / DB Rules / ADR Habit). SOMA adopted it verbatim as `CLAUDE.md` and filled it in for our stack. See ADR-013 for context.

---

## What Phase 1 effectively accomplished from this lineage

Reading the rows above as a delta:

- **From cortextOS:** the daemon + PTY + file bus + dashboard remain intact and upstream-mergeable. We rebranded display surfaces and migrated state dirs but did not rewrite the runtime.
- **From gbrain:** the entire Minions queue + worker + attachment + protected-names runtime + the full subagent loop with crash-resumable replay. The 710-LOC subagent handler was abstracted behind a Provider seam so OpenAI / OpenAI-compat / custom HTTP endpoints drop in without code changes.
- **From gstack:** the `claude -p` NDJSON subprocess pattern with kill ladders. The `WorktreeManager` is staged for Phase 2.
- **From graphify:** nothing yet — staged for Phase 6.
- **From claudecode-harness:** the CLAUDE.md template that runs the dev loop in this very repo.

The mechanical sum: ~3000 LOC ported (gbrain queue + handlers + subagent), ~500 LOC adapted (gstack subprocess pattern), ~150 LOC of new abstraction (Provider seam + tool registry + ctx.subagent), ~430 LOC of UI (submit page + intent parser + API routes). All under MIT, all runnable today.

Next reading: [architecture.md](./architecture.md) for how these pieces fit together at runtime.
