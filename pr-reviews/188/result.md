# PR #188 — Pipeline Complete

Author: ClintMoody
Risk tier: MEDIUM
Iterations: 1 (build + unit tests)
Duration: ~15 min

## What was tested

- Build: `npm run build` — PASS (tsup clean)
- Targeted tests: `npx vitest run tests/unit/bus/task.test.ts` — 42/42 PASS (includes 3 new + all prior, including regression guard)
- `paths.ctxRoot` verified present on `BusPaths` via `src/utils/paths.ts` (line 38: `ctxRoot` returned from `resolvePaths()`)
- Credential scan: none
- New npm dependencies: none

## What was observed

**listTasks `--all-orgs` implementation:**

When `filters.allOrgs = true`, builds `taskDirs[]` starting with `paths.taskDir` (caller's org), then scans `<ctxRoot>/orgs/*/tasks/` for peer directories. Each dir is read in order; `seenIds` Set dedupes by task ID, caller's org wins on collision.

Text output adds `Org` column when `--all-orgs` active:
```
Status  Pri  ID                        Org             Assignee         Title
```

**Key design decisions verified:**
1. `if (peerDir === paths.taskDir) continue` — correctly skips caller's own dir to prevent double-counting
2. Caller's dir is first in `taskDirs[]` — dedup naturally preserves caller's version on ID collision
3. Missing `orgs/` dir is caught silently (`try/catch` on `readdirSync(orgsRoot)`) — falls back to single-org
4. Individual dir read errors are also caught per-dir (`continue` on exception) — partial failures don't abort the scan

**Regression guard test:**
Updated to remove "that does not exist yet" clause about the opt-in flag (since the flag now exists). The guard itself still correctly verifies single-org isolation when `allOrgs` is not set.

**3 new tests all pass:**
- `--all-orgs` union across two orgs, `Task.org` field preserved: ✓
- Filters compose with `--all-orgs` (agent + status filtering works cross-org): ✓
- Dedup on ID collision (caller wins): ✓

## Merge Recommendation

**Score: 8/10**

**What it does:** Adds opt-in `--all-orgs` flag to `cortextos bus list-tasks` giving multi-org orchestrators a unified cross-org task view without N individual calls.

**Is it a genuine improvement?** Yes. Multi-org orchestrator setups have no ergonomic way to monitor fleet-wide task state. This fills a real gap with an opt-in design that doesn't affect existing single-org usage.

**cortextOS vision alignment:** Strong. Composable (opt-in, clean interface), reliability-preserving (single-org default and regression guard unchanged), no new dependencies.

**Concerns:**
- None material. Implementation is clean, tests are thorough, regression guard is preserved.

**Recommendation:** MERGE
