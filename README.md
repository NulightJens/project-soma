![License](https://img.shields.io/badge/license-MIT-green) ![Node](https://img.shields.io/badge/node-20%2B-brightgreen) ![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)

# SOMA

**A persistent, durable agent operating system.** Claude Code sessions running 24/7, coordinating through a SQLite-backed priority queue with crash-resumable LLM loops, surfaced through Telegram and a Next.js dashboard.

Forked from [cortextOS](https://github.com/grandamenium/cortextos); absorbing pieces of [gbrain](https://github.com/garrytan/gbrain) (queue + tools) and [gstack](https://github.com/garrytan/gstack) (subprocess pattern + worktree isolation, Phase 2). All donors MIT.

---

## What SOMA actually is

Three layers, each independently durable:

1. **Substrate** — a PM2-supervised Node.js daemon that spawns `claude` CLI processes via `node-pty`, manages a file bus for inter-agent messages, polls Telegram, and serves a Next.js dashboard. Inherited from cortextOS; what makes "an agent" persistent across crashes and OAuth refresh cycles.
2. **Minions queue** — a `better-sqlite3` priority queue with DAG children, idempotency, stall rescue, attachment storage, and a protected-names gate. Every job is a row that survives any process death. Ported from gbrain.
3. **LLM-loop engines** — pluggable Provider seam over a shared multi-turn loop with crash-resumable replay. Two engines ship: `subscription` (spawns `claude -p` and parses NDJSON) and `api` (Anthropic SDK / OpenAI-compatible / custom HTTP endpoints).

What you get on top: an agent that can submit work to itself, message other agents, read replies, and hand off to humans through Telegram or the dashboard — without losing state when the OS reboots.

---

## Quickstart

```bash
git clone https://github.com/NulightJens/cortextos.git ~/cortextos
cd ~/cortextos
npm install
npm run build
npm link                                 # `soma` and `cortextos` both work

soma jobs submit echo --data '{"msg":"hi"}' --json
soma jobs work --handlers echo &
soma jobs get 1
```

Full walkthrough including dashboard, daemon, and Telegram setup: **[docs/wiki/quickstart.md](./docs/wiki/quickstart.md)**.

---

## Where to read next

The wiki is rendered as a hosted Starlight site at **https://nulightjens.github.io/cortextos/** (live once GitHub Pages source is enabled — see [docs-site/README.md](./docs-site/README.md)). It also publishes [`/llms.txt`](https://nulightjens.github.io/cortextos/llms.txt) + [`/llms-full.txt`](https://nulightjens.github.io/cortextos/llms-full.txt) for AI agents.

The same content lives in `docs/wiki/*.md` for source browsers:

| If you want to... | Start here |
|---|---|
| Understand what SOMA *is* | [docs/wiki/what-is-soma.md](./docs/wiki/what-is-soma.md) |
| Bring it up cold | [docs/wiki/quickstart.md](./docs/wiki/quickstart.md) |
| See the component map | [docs/wiki/architecture.md](./docs/wiki/architecture.md) |
| Trace donor lineage | [docs/wiki/donor-lineage.md](./docs/wiki/donor-lineage.md) |
| Onboard an LLM agent | [docs/wiki/agent-bootstrap.md](./docs/wiki/agent-bootstrap.md) |
| Read the architecture record | [PROJECT_SOMA.md](./PROJECT_SOMA.md) (15 ADRs + chronicle) |
| Resume a paused dev session | [HANDOFF.md](./HANDOFF.md) |
| Work on the codebase as Claude | [CLAUDE.md](./CLAUDE.md) (operating harness) |
| Contribute skills/agents/orgs | [CONTRIBUTING.md](./CONTRIBUTING.md) |

---

## Status

Phase 1 (Minions queue + multi-provider API engine + dashboard submit UI) is essentially complete. Phase 2 (worktree isolation per gstack) is next. Full roadmap in [PROJECT_SOMA.md §9](./PROJECT_SOMA.md).

---

## License

MIT — see [LICENSE](./LICENSE).
