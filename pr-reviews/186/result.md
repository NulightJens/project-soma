# PR #186 — Pipeline Complete

Author: ClintMoody
Risk tier: MEDIUM
Iterations: 1 (build + unit tests)
Duration: ~15 min

## What was tested

- Build: `npm run build` — PASS (tsup clean)
- Targeted tests: `npx vitest run tests/unit/telegram/split-for-telegram.test.ts` — 13/13 PASS
- Credential scan: none
- New npm dependencies: none
- Static analysis of algorithm correctness (see concern below)

## What was observed

**splitForTelegram() implementation:**

Exported pure function replacing the naive slice loop in `TelegramAPI.sendMessage`. Boundary preference order: paragraph `\n\n` → single `\n` → sentence `.!?` + whitespace → word → hard cut. If best candidate has unbalanced Markdown entities, walks to next candidate; falls back to O(maxLen) running-tally scan; only hard-cuts as last resort.

All 13 unit tests pass: boundary type coverage, entity type coverage (`*`, `_`, backtick, `[`), bounds, content preservation, backwards compat for boundary-free input (3 chunks for 9000 `x`s — unchanged from old behavior).

`isMarkdownBalanced()` is conservative (escaped delimiters still counted), acknowledged in code comment. Acceptable in practice because `sanitizeMarkdown` runs first.

**Off-by-one bug — requires fix before merge:**

```typescript
const paraIdx = text.lastIndexOf('\n\n', windowEnd - 1);
if (paraIdx >= minSplit) candidates.push(paraIdx + 2);
```

`lastIndexOf('\n\n', windowEnd - 1)` can return `windowEnd - 1` (the `\n` at position `windowEnd - 1` is the first byte of `\n\n`, second byte at `windowEnd`). In that case `paraIdx + 2 = windowEnd + 1`, producing a chunk of `maxLen + 1` characters — which Telegram rejects.

**Verified with test case:**
```
paraIdx = 4095, splitAt = 4097, windowEnd = 4096 → chunk length 4097 > maxLen 4096
```

**Fix (1 line):**
```typescript
if (paraIdx >= minSplit && paraIdx + 2 <= windowEnd) candidates.push(paraIdx + 2);
```

The single-newline case (`nlIdx + 1 <= windowEnd` is always true since `nlIdx <= windowEnd - 1`) does not have this issue. Only the paragraph case needs the guard.

## Merge Recommendation

**Score: 7/10**

**What it does:** Replaces the naive 4096-char slice loop with a boundary-aware chunker that never splits inside bold/italic/code/link Markdown spans, preventing parse-entity errors on long agent messages.

**Is it a genuine improvement?** Yes. Parse-entity errors on long messages are a real operational pain point. The boundary-aware approach is clearly superior.

**cortextOS vision alignment:** Strong. Reliability-first (fewer Telegram API errors), no new dependencies, well-tested.

**Concerns:**
1. **Off-by-one in paragraph boundary**: `paraIdx + 2` can exceed `maxLen` when `\n\n` starts at `windowEnd - 1`. Rare but real; Telegram strictly rejects oversized messages.
2. No test covering the exact-boundary edge case (paragraph break at position `maxLen - 1`).

**Recommendation:** MERGE WITH CHANGES — add the `&& paraIdx + 2 <= windowEnd` guard to the paragraph candidate check. One-line fix; all existing 13 tests still pass.
