# Resume-prompt template

> Drop-in prompt text for starting a fresh Claude Code session on SOMA after
> a context-clear. Paste the filled-in body (between the `=== PROMPT START ===`
> and `=== PROMPT END ===` markers) as the first user message in the new session.
>
> **When to use:**
> - Approaching ~500 KB of context in the current session (or whenever `/status`
>   shows token use climbing past ~500K). Prefer clearing sooner rather than later —
>   SOMA's entry docs (HANDOFF.md + CLAUDE.md + PROJECT_SOMA.md §13) are
>   re-readable in ~30 seconds, so resumption is cheap.
> - Whenever the current session feels like it's drifted, or multiple long
>   investigations have accumulated in history that aren't load-bearing
>   anymore.
>
> **Before clearing — finalize the outgoing session:**
> 1. If mid-slot: land a clean commit on whatever is finished. Don't leave
>    uncommitted working-tree changes across the boundary.
> 2. Update `HANDOFF.md` per its §10 checklist — new branch tip, new
>    green/red signals, next-moves list reflects reality.
> 3. Append a `PROJECT_SOMA.md` §13 chronicle entry summarising what
>    landed this session.
> 4. If this session produced a meaningful decision → ADR / scope shift /
>    new directive from user: update the relevant auto-memory in
>    `~/.claude/projects/-Users-max/memory/`.
> 5. Fill in this template below and hand the PROMPT block to the user.
>
> **After the new session starts:**
> 1. The new session reads HANDOFF.md + CLAUDE.md + PROJECT_SOMA.md §13
>    + MEMORY.md in order (per CLAUDE.md §8).
> 2. Runs the verify block (git status, tsc, vitest, pm2, curl).
> 3. Reports state in one paragraph before proceeding (the "handshake").
> 4. Resumes at the named active slot.

---

## Fill-in checklist

Replace every `{{FIELD}}` placeholder. Delete this checklist before handing
the prompt to the user.

- `{{BRANCH}}` — current git branch name.
- `{{COMMIT_HASH}}` — short SHA of the branch tip (`git rev-parse --short HEAD`).
- `{{FORK_URL}}` — `github.com/NulightJens/cortextos` (or whatever fork lives at origin).
- `{{LAST_SLOT_LANDED}}` — name of the most recently completed Phase 1 slot
  (e.g. `protected-names gate`).
- `{{NEXT_SLOT}}` — name of the next slot the fresh session should pick up.
  Pull from HANDOFF.md §9 next-moves list.
- `{{NEXT_SLOT_N}}` — its rank in the HANDOFF §9 list (e.g. `1`).
- `{{NEXT_SLOT_DETAIL}}` — 3–5 lines naming the donor file, LOC range, key
  SOMA adaptations, acceptance criteria (tests + tsc clean). Copy-paste
  from the HANDOFF §9 entry itself if that's sufficient.
- `{{TEST_COUNT}}` — current Minions test count (e.g. `84`).
- `{{TEST_BREAKDOWN}}` — per-file counts (e.g. `engine 7 + queue 34 + worker 11 + attachments 19 + protected-names 13`).
- `{{ANY_UNCOMMITTED_STATE}}` — delete the whole "Mid-work state" section if
  the outgoing session committed cleanly. Keep + describe only if genuinely
  mid-slot at clear time.
- `{{CHECKIN_POLICY}}` — "pause and check in after each slot" (cautious) OR
  "continue through slots without pausing; ping me only on architectural
  decisions not covered by an ADR" (autonomous). Use whichever standing
  directive the user gave you.

---

=== PROMPT START ===

Resume SOMA work.

Working dir: ~/cortextos
Active branch: {{BRANCH}} @ {{COMMIT_HASH}}
Fork: {{FORK_URL}} (MIT)

READ BEFORE ACTING, in this order:
1. ~/cortextos/HANDOFF.md — resume-here snapshot (30-sec orientation,
   verify commands, roadmap position, ranked next moves, gotchas,
   update checklist).
2. ~/cortextos/CLAUDE.md — operating harness (ownership zones, hard
   limits, verify discipline, hub-spoke delegation rules, memory /
   retro protocol).
3. ~/cortextos/PROJECT_SOMA.md §13 chronicle — last entry is the most
   recent session's decisions + landed work. §10 is the full ADR log
   (currently 14 ADRs) if you need depth on any rule.
4. ~/.claude/projects/-Users-max/memory/MEMORY.md index + any relevant
   project_*.md / feedback_*.md memories.
5. git log --oneline -10 {{BRANCH}}.
6. Run the verify block from HANDOFF.md §2 (git status, tsc --noEmit,
   vitest run tests/minions-*.test.ts, pm2 list, curl localhost:3000).

Then tell me in one short paragraph what you see (branch tip, test count
passing, any drift from the handoff) before proceeding.

LOAD-BEARING DIRECTIVES (full text in PROJECT_SOMA.md §10):
- ADR-008: Claude subscription is the primary execution path (default
  worker spawns `claude -p`). API subagent handler is ported in full
  but gated behind `engine: 'api'` per-job or `SOMA_DEFAULT_ENGINE=api`.
- ADR-009: do NOT ingest Solo Scale handoff content into SOMA code or
  memory. Build SOMA fully agnostic first. Solo Scale twin lands in a
  separate private repo post-Phase 5.
- ADR-011: don't dumb down. Preserve the full capability surface of
  every donor system. The narrative is an organizing story, not a
  ceiling on features.
- ADR-012: synergy not silos. Integrate overlapping capabilities into
  single coherent implementations — no parallel redundant ports. Check
  "is there overlap?" before any new module lands.
- ADR-014: user-facing edge filters both directions. Internals stay
  complex and full-fidelity; every human-facing surface (dashboard,
  Telegram, future CLI/chat) translates simple input → structured
  backend calls and structured output → plain-language summaries with
  progressive disclosure for the technical detail.

STATE AT CLEAR:
- Last slot landed: {{LAST_SLOT_LANDED}}.
- Test suite: {{TEST_COUNT}}/{{TEST_COUNT}} passing ({{TEST_BREAKDOWN}}).
- `npx tsc --noEmit`: clean.
- Working tree: clean (all session commits pushed to origin/{{BRANCH}}).

{{ANY_UNCOMMITTED_STATE}}
<!--
  Mid-work state (DELETE THIS SECTION if the outgoing session committed
  cleanly before clear; keep ONLY if genuinely mid-slot at clear time):

  Mid-work: {{SLOT_IN_PROGRESS}} — {{FILES_TOUCHED_BUT_UNCOMMITTED}}.
  Next concrete step on resume: {{EXACT_NEXT_ACTION}}.
  Green so far: {{PASSING_TESTS_AT_CLEAR}}.
  Red so far: {{ANY_FAILURES_OR_BLOCKERS}}.
-->

ACTIVE WORK: pick up slot #{{NEXT_SLOT_N}} from HANDOFF.md §9 —
{{NEXT_SLOT}}.

{{NEXT_SLOT_DETAIL}}

CHECK-IN DISCIPLINE: {{CHECKIN_POLICY}}.

PORT DISCIPLINE (from CLAUDE.md + HANDOFF.md):
- Every commit: `npx tsc --noEmit` clean + `npx vitest run tests/minions-*.test.ts`
  all pass. Show the output. Never claim "done" without verification.
- Commit to {{BRANCH}} and push to origin.
- Feature commits ≤ 300 LOC; port commits from gbrain/gstack/Hermes
  are exempt but must annotate `// SOMA:` for every deviation.
- At end of session: update HANDOFF.md per its §10 checklist + append
  PROJECT_SOMA.md §13 chronicle entry + (at phase milestones) snapshot
  HANDOFF to docs/handoffs/YYYY-MM-DD-NN-topic.md.

SECRETS HYGIENE: never echo bot tokens / API keys / OAuth values. Mask
with `sed -E 's/=(.{0,4}).*/=\1.../'` before printing.

CONTEXT BUDGET: this is a fresh session with full context. If you
approach ~500K used, prepare the next handoff bundle per
docs/handoffs/TEMPLATE-resume-prompt.md — update HANDOFF.md + append
§13 chronicle + fill in this template for the user to paste into the
next session. Don't wait until the window is exhausted.

Begin with the reads + verify. Confirm state, then start slot #{{NEXT_SLOT_N}}.

=== PROMPT END ===
