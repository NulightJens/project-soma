# PR #189 — Pipeline Complete

Author: ClintMoody
Risk tier: HIGH (agent spawn path change)
Iterations: 1 (build + unit tests)
Duration: ~15 min

## What was tested

- Build: `npm run build` — PASS (tsup clean)
- Targeted tests: `npx vitest run tests/unit/daemon/context-cap-detect.test.ts` — 14/14 PASS
- Diff review: `shouldContinue()` control flow, `context-cap-detect.ts` module, archive mechanism
- Credential scan: none
- New npm dependencies: none

## What was observed

**Root cause and fix:**

When Claude Code hits ~89% context, it prints `Context limit reached · /compact or /clear to continue` and freezes the PTY. `claude --continue` restores the capped session verbatim — the zombie survives every restart. Fix: detect the cap marker in the tail of the most recent session jsonl before deciding to `--continue`, archive the capped file with `.capped-<timestamp>` suffix (invisible to `claude --continue` which only reads `.jsonl` files), force fresh session.

**`context-cap-detect.ts` (136 lines):**

- `detectContextCap(convDir)`: reads 16 KB tail of most recent session jsonl (by mtime), checks 3 patterns:
  - `/Context limit reached/i`
  - `/prompt is too long/i`
  - `/\/compact or \/clear to continue/i`
- Only inspects most-recent file — tail-only scan avoids false positives from historical markers in old sessions
- Returns `{ capped: false }` on any error (missing dir, unreadable file, empty jsonl) — fails safe

- `archiveCappedSession(sessionFile)`: renames to `<path>.capped-<ISO-timestamp>` — `claude --continue` only picks up `.jsonl` files, so archive is safely ignored

**`AgentProcess.shouldContinue()` integration:**

Control flow after PR:
1. Check if any `.jsonl` exists → return false if none (unchanged)
2. `detectContextCap(convDir)` → if capped, archive and return false
3. If cap detected, re-check for remaining `.jsonl` files — even if some remain, **return false** (conservative: one zombie is enough evidence to distrust whole history)
4. `return true` — only reached if no cap detected

The conservative choice at step 3 is correct. Forcing a fresh session when the prior session was capped is always safe — worse case is a redundant fresh start. The alternative (continuing with an older possibly-stale session) risks re-zombying.

**14 unit tests all pass:**
- Missing dir, empty dir, no-jsonl, no-marker: ✓
- Each of 3 detection patterns: ✓
- Case-insensitivity: ✓
- Most-recent-wins (older capped, newer clean → no detection): ✓ Critical test
- Tail-only contract (marker in early bytes of 80KB file → not detected): ✓ Critical test
- Zero-byte jsonl ignored: ✓
- `archiveCappedSession` renames correctly, returns null for missing file: ✓

**Interaction with watchdog:**

Boris flagged overlap with ctx-watchdog area. Verified: `detectContextCap` runs inside `shouldContinue()`, which returns `false` → the daemon starts a fresh session instead of continuing. This does not trigger `recordFailure()` (which is called on spawn failure/crash) and does not interact with watchdog failure counting. Clean separation.

**`require('fs')` in `shouldContinue()`:**

The existing `require('fs').readdirSync` calls in `shouldContinue()` are pre-existing patterns in the codebase (not introduced by this PR). The new `context-cap-detect.ts` module uses proper top-level `import` syntax.

## Merge Recommendation

**Score: 9/10**

**What it does:** Detects when an agent's prior Claude Code session ended stuck at the context-limit wall and forces a fresh session on restart instead of re-zombying. Fixes a production incident (FRIDAY zombie, 2026-04-19) that survived PM2 auto-recovery and periodic `--continue` restarts.

**Is it a genuine improvement?** Yes. This is a real production reliability fix — the zombie loop is a known failure mode with no previous automated escape. The fix is appropriately conservative (archive → fresh session) and the tail-only scan is smart (avoids false positives from historical markers).

**cortextOS vision alignment:** Strong. Reliability-first (breaks a zombie loop that survives all other recovery mechanisms), least privilege (archives rather than deletes — session history preserved for post-mortem), no new dependencies.

**Concerns:**
- None material. The implementation is careful, edge cases are covered, and the conservative fresh-session fallback is always safe.

**Recommendation:** MERGE
