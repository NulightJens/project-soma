# What is SOMA

SOMA is a **persistent agent operating system**. The shortest possible definition: it lets a Claude Code session keep working — through crashes, OAuth refresh cycles, context-window resets, machine reboots, and operator absence — by externalising state into a queue of durable rows that any worker can resume.

## The mental model in 30 seconds

Three layers, each independently durable. Reading bottom-up:

```
┌──────────────────────────────────────────────────────────────────┐
│  Tools          submit_minion / send_message / read_own_inbox    │  ← Phase 1 (shipped); brain-derived tools land Phase 6
├──────────────────────────────────────────────────────────────────┤
│  Engines        subscription (claude -p)  +  api (HTTP)          │  ← shared loop, swappable Provider seam
│                 ↓                              ↓                  │
│                 Anthropic SDK / OpenAI / custom endpoints         │  ← `SOMA_API_CUSTOM_PROVIDERS` registers more
├──────────────────────────────────────────────────────────────────┤
│  Minions queue  durable priority queue (SQLite)                  │  ← every "thought" is a row; survives crashes
│                 minion_jobs / minion_inbox / minion_attachments  │
│                 minion_subagent_messages / *_tool_executions     │
├──────────────────────────────────────────────────────────────────┤
│  Substrate      PM2 daemon · node-pty `claude` spawn · file bus  │  ← inherited from cortextOS upstream
│                 Telegram poller · Next.js dashboard               │
└──────────────────────────────────────────────────────────────────┘
```

The runtime keeps running because each layer's state is observable from outside the process holding it:

- A worker dies mid-LLM-loop → the `minion_subagent_messages` rows are still there → a new worker reads them and continues from the last persisted turn.
- The daemon dies → PM2 restarts it → it re-reads the file bus and picks up where the previous instance left off.
- The Claude OAuth token expires after 71 hours → the daemon's PTY supervisor catches the failure, refreshes from Keychain, respawns.

## Why this shape

The cortextOS upstream gives you "one persistent Claude session." That's nice but limited: you can't parallelise, you can't rescue work after a kill -9, and you can't compose multiple agents because they share one terminal.

The Minions queue (from gbrain) gives you "many parallel Claude sessions whose work survives any failure." That's the leap. The cost is operational complexity — but the queue absorbs that complexity into a small pile of well-tested SQL. Most of the rest of SOMA is just plumbing into that queue.

The dual-engine seam (subscription vs. api) gives you "use the operator's Claude subscription quota for default work; switch to pay-per-token API credits when you need fan-out parallelism without quota limits." Each engine spends a different bucket of capacity.

The protected-names gate gives you "agents can submit work to themselves without being able to escalate privileges." A model that wants to call `shell` has to ask the operator via a dashboard CLI prompt — no path through model output to RCE.

## Vocabulary

These terms are used throughout the codebase and docs. Internalising them speeds up everything else.

| Term | Means |
|---|---|
| **orchestrator** / **twin** | Top-level AI layer. "Orchestrator" is internal / dev-facing; "twin" is conceptual / business-facing. Same runtime entity. (ADR-007) |
| **brain** | The persistent files representing an agent — markdown identity + soul + goals + skills. Survives process death. |
| **body** | A transient `claude` Code subprocess instantiating a brain. |
| **minion** / **job** | A durable row in `minion_jobs`. Priority-ordered, DAG-aware, stall-rescued, idempotent. |
| **worker** | An ephemeral process claiming minions and running them. Phase 2 will run each inside a worktree. |
| **handler** | The function bound to a job's `name`. Built-ins: `echo`, `noop`, `sleep`, `shell` (gated), `subagent` (gated), `subagent_aggregator` (gated). |
| **engine** | Under the `subagent` handler, the LLM-loop implementation. Two ship: `subscription` (claude CLI subprocess) and `api` (HTTP, Anthropic SDK + OpenAI-compat + custom). |
| **provider** | Under the `api` engine, the HTTP shape. `anthropic` (SDK), `openai` (covers OpenAI / OpenRouter / Together / Groq / Anyscale / Mistral / Ollama / vLLM / LM Studio), plus anything in `SOMA_API_CUSTOM_PROVIDERS`. |
| **tool** | Under the `api` engine, a function the model can call. Phase 1 ships 3 queue-internal tools; brain-derived tools come Phase 6. |
| **worktree** | Per-job git worktree for filesystem isolation. Phase 2 — not shipped yet. |
| **pillar** | Routing dimension on every job: Memory / Action / Automation / Self-Learning. |
| **department** | Routing dimension on every job: Marketing / Sales / Operations / Content / Finance / Product. |
| **skill** | Fat-markdown file an agent invokes (gstack/gbrain `SKILL.md` format). Lives under `templates/` or per-agent `.skills/`. |
| **harness** | This repo's operating rules for Claude Code. See [CLAUDE.md](../../CLAUDE.md). |

## Routing principle

> **Deterministic work → Minion handler. Judgment → subagent.**

A handler is the right answer when the action is mechanical: send an HTTP request, write a file, run a query, post a message. A subagent is the right answer when the action requires reading context and choosing among options.

## Engine selection (ADR-008)

> **Subscription-first. API opt-in only.**

Subscription engine ships as the default because it spends the operator's existing Claude subscription quota and uses the OAuth credential already in Keychain. The API engine is opt-in (`SOMA_ALLOW_API_ENGINE=1`) because it spends pay-per-token API credits — a different cost surface that warrants its own gate.

For per-job override: set `data.engine: 'api'` on the job. For process-wide default: `SOMA_DEFAULT_ENGINE=api`.

## Capability ceiling (ADR-011)

> **Don't dumb down.**

Every donor system's capabilities port in full. The narrative ("personal agent OS") is the organising story, not a cap on features. If gbrain shipped a 710-LOC subagent handler with two-phase tool ledgers and crash-resumable replay, SOMA's API engine ships the same — even when the surface explanation is "it's just a chat loop."

## Synergy principle (ADR-012)

> **Synergy not silos.**

When two donors ship overlapping concepts, integrate into a single coherent implementation. The unified runner handler with the engine seam is the canonical example: gbrain had a subagent handler, gstack had a `claude -p` subprocess pattern, and rather than ship both as parallel handlers we built one runner that selects by `data.engine`. Same goes for memory (Phase 6 — typed edges in the brain graph, not a sidecar JSONL), scheduled work (Minion jobs, not a parallel cron), and the file bus vs queue (different purposes, cleanly separated).

## User-facing edge (ADR-014)

> **Filter both directions at the human boundary.**

Internals stay full-fidelity (per ADR-011). The dashboard, Telegram bot, and any future CLI-chat surface translate simple human input → structured backend calls and structured backend output → plain-language summaries with progressive disclosure. A model on the inside speaks structured JSON to the queue; a human on the outside types "sleep 5 seconds" and sees "submitted job #42 — sleeping 5000ms."

---

Next reading: [donor-lineage.md](./donor-lineage.md) for the per-donor port table, or [architecture.md](./architecture.md) for the component map.
