---
title: Quickstart
description: Cold-start path from clone to a running daemon and your first job, in about ten minutes.
---

# Quickstart

Cold-start path from "I just cloned this" to "I have an agent running and can submit a job from the dashboard." ~10 minutes on a clean macOS machine; Linux is similar with package-manager substitutions.

## Prerequisites

| Dependency | Why | Install |
|---|---|---|
| Node.js 20+ | Runtime | https://nodejs.org or `brew install node` |
| Git | Source control | `xcode-select --install` (macOS) or your distro's package manager |
| `claude` CLI + OAuth | Subscription engine spawns this; agent PTYs use it | `npm install -g @anthropic-ai/claude-code` then `claude login` |
| PM2 (optional) | Process supervisor for the daemon + dashboard | `npm install -g pm2` |
| Telegram bot (optional) | Phone control surface | Create one through [@BotFather](https://t.me/BotFather) |
| Anthropic / OpenAI API key (optional) | Only if using the `api` engine instead of `subscription` | https://console.anthropic.com (or your provider) |

You can run SOMA without PM2, Telegram, or API keys — the queue + dashboard work standalone. The full setup below shows the fleet path.

## 1. Clone + install

```bash
git clone https://github.com/NulightJens/project-soma.git ~/cortextos
cd ~/cortextos
npm install
npm run build
npm link                                 # exposes `soma` and `cortextos` globally

# Verify
which soma                               # /Users/<you>/.nvm/.../bin/soma (or similar)
soma --version                           # 0.1.x
```

If `npm link` fails with permission errors, run `npm config get prefix` and ensure you own that directory. (Or use `nvm` so the prefix lives under `~`.)

## 2. Sanity-check the queue without a daemon

The queue + worker work standalone — no daemon, no Telegram, no dashboard, no LLM. This is the fastest "is anything broken" test.

```bash
TMPDB=$(mktemp -d)/smoke.db

# Submit a no-op job
soma jobs submit echo --data '{"msg":"hello"}' --db "$TMPDB" --json

# Run a worker that drains the queue
soma jobs work --db "$TMPDB" --handlers echo,noop,sleep --poll-interval 500 &
WORKER_PID=$!
sleep 2
kill $WORKER_PID

# Inspect the result
soma jobs get 1 --db "$TMPDB"
# Expect: status=completed, result={"echoed":{"msg":"hello"},"attempt":1}
```

If that round-trips, the queue + worker + handler dispatch are healthy.

## 3. Initialise SOMA on this machine

```bash
soma install                              # creates ~/.soma/<instance>/ state dirs
```

State now lives at `~/.soma/default/` (with a `~/.cortextos` symlink for backward compat). Inside:

```
~/.soma/default/
├── config/
│   └── enabled-agents.json              # which agents are active
├── orgs/                                # per-org agent dirs (created by soma init <org>)
├── state/                               # per-agent heartbeat + transient state
├── inbox/                               # per-agent message inbox
└── logs/                                # per-agent rolling logs
```

## 4. Bring up your first org + agent

An org is a namespace. An agent is a per-org persistent Claude session. The `system` template is the simplest — one orchestrator, no specialists.

```bash
soma init myorg
soma add-agent boss --template orchestrator --org myorg

# Optional: Telegram credentials
cat > ~/cortextos/orgs/myorg/agents/boss/.env <<'EOF'
BOT_TOKEN=<your-bot-token>
CHAT_ID=<your-telegram-chat-id>
ALLOWED_USER=<your-telegram-user-id>
EOF
chmod 600 ~/cortextos/orgs/myorg/agents/boss/.env

soma enable boss
```

## 5. Generate the PM2 ecosystem and start the fleet

```bash
soma ecosystem                            # generates ~/cortextos/ecosystem.config.js
pm2 start ecosystem.config.js
pm2 save                                  # persist across reboots
pm2 startup                                # if you want it to survive a reboot — follow the printed sudo command
```

You should see three apps come online:
- `soma-daemon` — supervises agent PTYs, polls Telegram, runs cron, serves the dashboard's IPC socket
- `SOMA-dashboard` — Next.js dev server on port 3000
- `soma-jobs-worker` — drains the Minions queue (defaults to handlers `echo,noop,sleep` — add more via `SOMA_WORKER_HANDLERS=echo,noop,sleep,shell` etc.)

```bash
pm2 list                                  # all three should be 'online'
soma status                               # human-readable agent fleet state
```

## 6. Open the dashboard

```bash
open http://localhost:3000
```

The default admin password is generated on first run and written to `~/.soma/default/dashboard.env` — open that file or `pm2 logs SOMA-dashboard` and look for the seeded credential. Or set your own:

```bash
echo 'ADMIN_USERNAME=admin' >> ~/cortextos/dashboard/.env.local
echo 'ADMIN_PASSWORD=<your-strong-password>' >> ~/cortextos/dashboard/.env.local
echo 'SYNC_ADMIN_PASSWORD=true' >> ~/cortextos/dashboard/.env.local
pm2 restart SOMA-dashboard
```

(The `SYNC_ADMIN_PASSWORD=true` flag forces a hash refresh on next sign-in; remove or set to `false` afterwards so subsequent restarts don't keep overwriting.)

## 7. Submit a job from the dashboard

Sign in, navigate to **Jobs** in the sidebar, click **New job**.

- **Freeform tab** — type `sleep 5 seconds` → Parse intent → Confirm and submit. Watch the row appear on `/jobs` and transition `waiting → active → completed` over ~5s.
- **Advanced tab** — handler `echo`, data `{"msg": "hi"}`, click Submit.

Protected handler names (`shell`, `subagent`, `subagent_aggregator`) won't go through the dashboard — they require the operator CLI with `--trusted`.

## 8. (Optional) Try the API engine

The `api` engine costs pay-per-token credits, so it's gated behind a separate flag. Setup:

```bash
# Add the gate to the worker process's env (in ecosystem.config.js or your shell)
export SOMA_ALLOW_SUBAGENT_JOBS=1                # registers the runner handler
export SOMA_ALLOW_API_ENGINE=1                   # cost-surface gate
export ANTHROPIC_API_KEY=sk-ant-...              # default provider key

# Run a worker that includes the subagent handler
soma jobs work --handlers echo,noop,sleep,subagent --poll-interval 500 &

# Submit a subagent job that uses the api engine + Anthropic provider
soma jobs submit subagent --trusted --data '{
  "engine": "api",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "prompt": "Reply with one short sentence.",
  "max_turns": 1
}' --json
```

For OpenAI-compat providers and custom endpoints, set `SOMA_API_CUSTOM_PROVIDERS` to a JSON array. Example:

```bash
export OPENROUTER_API_KEY=sk-or-...
export SOMA_API_CUSTOM_PROVIDERS='[
  {
    "name": "openrouter",
    "base_url": "https://openrouter.ai/api/v1",
    "auth_env_var": "OPENROUTER_API_KEY"
  }
]'
```

Then submit with `"provider": "openrouter"` in the job data.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `soma: command not found` | `npm link` didn't resolve into PATH | Check `npm config get prefix` — that bin dir must be on PATH. |
| Daemon spawns but agent never comes up | OAuth token expired / Keychain locked | `claude login` (or set `CLAUDE_CODE_OAUTH_TOKEN` env). Watch `pm2 logs soma-daemon`. |
| Dashboard returns 401 on `/api/...` | Session cookie missing or expired | Sign in again; clear browser cookies for `localhost:3000` if stale state. |
| `Sign-in failed: MissingCSRF` | Stale `authjs.csrf-token` cookie | Clear browser cookies for the dashboard origin. |
| `Sign-in failed: CredentialsSignin` | Wrong password (often browser autofill capturing an error message) | Manually type the password from `~/.soma/default/dashboard.env`. Delete the saved password in your browser if autofill keeps re-injecting the wrong value. |
| Submit returns 422 + `protected_job_name` | You tried to submit `shell` / `subagent` / `subagent_aggregator` from the dashboard | Use the operator CLI with `--trusted`. The dashboard pre-renders the equivalent command in the error card. |
| API engine throws `engine is gated` | `SOMA_ALLOW_API_ENGINE=1` not set on the worker process | Set the env in the worker's `ecosystem.config.js` `env` block, or in your shell before `soma jobs work`. |

## What you have now

- A persistent agent (`boss`) running under PM2, surviving reboots and crashes
- A SQLite queue at `~/.soma/default/minions.db` you can submit work to from the CLI or the dashboard
- A worker draining the queue with a configurable handler set
- (Optional) Telegram control surface for the agent
- (Optional) API-engine path for pay-per-token providers

Next reading: [architecture.md](./architecture.md) to understand how the pieces fit, or [agent-bootstrap.md](./agent-bootstrap.md) if you're planning to develop in this repo (human or AI).
