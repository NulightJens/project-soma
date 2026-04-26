# SOMA Wiki

Concept + setup + reference docs for SOMA. Each page is short and focused; cross-link liberally.

> **Hosted version:** https://nulightjens.github.io/cortextos/ — same content rendered with Astro Starlight, plus AI-agent-friendly `/llms.txt`, `/llms-full.txt`, and `/llms-small.txt`. Goes live once the repo's **Settings → Pages → Source** is set to "GitHub Actions" (one-time setup). See [docs-site/README.md](../../docs-site/README.md) for build details.

> **Looking for engineering history?** [PROJECT_SOMA.md](../../PROJECT_SOMA.md) is the architecture-decision record (15 ADRs + chronicle). [HANDOFF.md](../../HANDOFF.md) is the live "where are we right now" snapshot.

---

## Concept

| Page | Purpose |
|---|---|
| [what-is-soma.md](./what-is-soma.md) | One-page mental model: substrate → minions → engines → tools. Vocabulary glossary at the bottom. |
| [donor-lineage.md](./donor-lineage.md) | What was inherited from cortextOS, what was ported from gbrain + gstack, what's deferred to later phases. |
| [architecture.md](./architecture.md) | Component map + data flow + key file paths. Links each component back to the ADR that introduced it. |

## Setup

| Page | Purpose |
|---|---|
| [quickstart.md](./quickstart.md) | Cold-start guide: prereqs → clone → build → first job → dashboard. ~10 minutes. |

## Working in the repo

| Page | Purpose |
|---|---|
| [agent-bootstrap.md](./agent-bootstrap.md) | For an LLM agent (or human dev) opening this repo cold. Read order, mental model, edit boundaries, verification discipline. |

## Operating

The deeper operational docs are deliberately kept narrow for now — the codebase is moving fast and a docs sprawl ages badly. The pages above plus inline JSDoc are sufficient for Phase 1 + 2 work. As the system stabilises (after Phase 5 skill-format unification + Phase 6 brain layer) we'll add per-feature reference pages here.

In the meantime, for operational details consult:

- **CLI surface** — `soma --help` and per-subcommand `--help` (or read [src/cli/jobs.ts](../../src/cli/jobs.ts) for the most-used path).
- **Env vars** — search the codebase for `process.env.SOMA_` (every gate / config var is prefixed). Key ones: `SOMA_ALLOW_SHELL_JOBS`, `SOMA_ALLOW_SUBAGENT_JOBS`, `SOMA_ALLOW_API_ENGINE`, `SOMA_API_DEFAULT_PROVIDER`, `SOMA_API_CUSTOM_PROVIDERS`, `SOMA_DEFAULT_ENGINE`.
- **Built-in handlers** — `echo`, `noop`, `sleep` (always on); `shell` (gated); `subagent`, `subagent_aggregator` (gated); see [src/cli/job-handlers.ts](../../src/cli/job-handlers.ts).
- **API engine providers** — `anthropic`, `openai`, plus anything in `SOMA_API_CUSTOM_PROVIDERS`. See [src/minions/handlers/engines/api/providers/](../../src/minions/handlers/engines/api/providers/).
- **API engine tools** — `submit_minion`, `send_message`, `read_own_inbox`. See [src/minions/handlers/engines/api/tools/builtin.ts](../../src/minions/handlers/engines/api/tools/builtin.ts).

---

## Document conventions

- **Code blocks are reproducible.** If a page tells you to run a command, that command should work as-shown against a clean tree (modulo path expansion).
- **Cross-links use relative paths.** Easier to grep, easier to follow on disk vs. on a rendered Git host.
- **No marketing copy.** These pages describe what SOMA *is*, not why you should want it.
- **Verification steps follow setup steps.** Each "do X" is paired with "see Y" so you know it worked.
