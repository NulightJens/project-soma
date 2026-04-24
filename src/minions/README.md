# Minions — durable priority queue

SOMA's task queue, ported from [gbrain's Minions](https://github.com/garrytan/gbrain/tree/main/src/core/minions) (MIT © Garry Tan).

## Why

Project SOMA (see `/PROJECT_SOMA.md`) needs a prioritized, sequentially-draining, crash-resilient task queue that:

- Sorts by integer priority (lower = higher urgency).
- Respects `delay_until` for scheduled work.
- Survives worker `SIGKILL` via `lock_until` + `stalled_counter`.
- Supports parent-child DAGs with cascade-cancel and `child_done` inbox fan-in.
- Enforces `idempotency_key`, quiet hours, and per-key staggering.
- Abstracts backend (SQLite default, PGLite / Postgres / Cloudflare D1 as adapters).

## Port status

| File | Source | Status | Notes |
|---|---|---|---|
| `types.ts` | `gbrain/src/core/minions/types.ts` | **ported (scaffold)** | Kept core job + inbox + attachment types. Dropped gbrain-specific subagent/tool/Anthropic content-block types — SOMA workers spawn `claude -p` subprocesses, so those types will differ. `Date → number` (Unix ms) for SQLite portability. |
| `schema.sql` | `gbrain/migrations/*.sql` | **ported (scaffold)** | Single-file SQLite DDL. Postgres-specific features (advisory locks, JSONB operators) will surface as interface methods on `QueueEngine`, implemented differently per backend. |
| `engine.ts` | `gbrain/src/core/engine.ts` | **scaffolded** | `QueueEngine` interface with `kind` discriminator. SQLite impl first. |
| `queue.ts` | `gbrain/src/core/minions/queue.ts` (1152 LOC) | **ported** | All core state-machine methods + worker-support helpers (isJobActive, appendLogEntry, deferForQuietHours, skipForQuietHours). Attachments / protected-names deferred. |
| `worker.ts` | `gbrain/src/core/minions/worker.ts` (415 LOC) | **ported** | Main loop extracted into `tick()` + `drain()` so tests can drive it deterministically. All Postgres `engine.executeRaw` calls routed through MinionQueue helpers. |
| `attachments.ts` | `gbrain/src/core/minions/attachments.ts` | **ported** | Pure validation (filename safety, base64, content-type, size, duplicate). CRUD wired onto MinionQueue. |
| `protected-names.ts` | `gbrain/src/core/minions/protected-names.ts` | **ported** | Pure constant module. Protected set: `shell`, `subagent`, `subagent_aggregator`. Gate enforced in `MinionQueue.add()` — callers must pass `{allowProtectedSubmit: true}` as the 4th arg. |
| `handlers/shell.ts` | `gbrain/src/core/minions/handlers/shell.ts` | **not yet** | Useful verbatim. |
| `handlers/claude-subprocess.ts` | (new — SOMA) | **not yet** | New handler; pattern from `gstack/test/helpers/session-runner.ts`. |
| `backoff.ts` | `gbrain/src/core/minions/backoff.ts` | **ported** | |
| `quiet-hours.ts` | `gbrain/src/core/minions/quiet-hours.ts` | **ported** | |
| `rate-leases.ts` | `gbrain/src/core/minions/rate-leases.ts` | **not yet** | Postgres advisory-lock rewrite to SQLite `BEGIN IMMEDIATE` tx. |
| `stagger.ts` | `gbrain/src/core/minions/stagger.ts` | **ported** | |
| `transcript.ts` | `gbrain/src/core/minions/transcript.ts` | **not yet** | Transcript append semantics. |
| `wait-for-completion.ts` | `gbrain/src/core/minions/wait-for-completion.ts` | **not yet** | Small. |

## Backend matrix

| Engine | Use case | Status |
|---|---|---|
| SQLite (`better-sqlite3`) | default local dev + personal deployments | scaffolded |
| PGLite | Postgres feature parity without a daemon | later |
| Postgres | multi-process / team deployments | later |
| Cloudflare D1 | distributed edge deployments | Phase 7 |

All four implement the `QueueEngine` interface in `engine.ts`. No queue code should reach past the interface except via explicit engine-side helpers.

## Key adaptations from gbrain

1. **`Date → number` (Unix ms).** SQLite has no native `DATE`; storing Unix ms keeps comparisons + indexing cheap and survives engine swaps. The TS types are milliseconds since epoch; `rowTo*` helpers decode.
2. **JSONB → TEXT with JSON.stringify/parse.** SQLite has `JSON1` functions but we keep it simple — JSON strings in `TEXT` columns, parsed at the boundary. PGLite adapter can switch to JSONB later without touching callers.
3. **`pg_advisory_xact_lock` → `BEGIN IMMEDIATE`.** SOMA's rate-lease module wraps a SQLite `BEGIN IMMEDIATE` tx where gbrain uses advisory locks. Same semantics for single-writer SOMA; distributed deployments will re-engage advisory-locking on the Postgres/D1 engines.
4. **Subagent handler split.** gbrain's `handlers/subagent.ts` couples to Anthropic's SDK + its own brain. SOMA replaces with a thinner `claude-subprocess.ts` handler that spawns `claude -p --output-format stream-json --verbose` in a worktree and streams NDJSON back — the pattern from gstack.

## Attribution

Copyright for the original code belongs to Garry Tan under MIT. The SOMA port preserves the MIT license and retains gbrain's file-level doc comments where structurally relevant. Deviations are annotated `// SOMA:` inline.
