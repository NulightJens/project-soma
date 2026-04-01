---
name: env-management
description: "You need to add a new API key to the system, update an existing credential, check what secrets are configured for the org or a specific agent, onboard a new third-party tool that needs credentials, or diagnose why an agent cannot access a service because a key appears missing. You need to know where to put the key, how the load order works so it actually gets picked up, and what rules to follow to avoid leaking credentials."
triggers: ["add key", "api key", "env file", ".env", "secret", "credential", "token", "environment variable", "configure key", "set key", "missing key", "can"t find key", "key not set", "where do I put", "shared secret", "org secret", "agent secret", "key not loading", "credential setup", "configure credentials", "new api key", "add to env"]
---

# Environment Variable Management

cortextOS uses a 4-layer env hierarchy. Later layers override earlier ones:

```
1. Base shell (PATH, HOME, etc.)
2. CTX_* vars (set by agent-pty at session start)
3. orgs/{org}/.env  ← shared secrets, all agents in the org
4. orgs/{org}/agents/{agent}/.env  ← agent-specific secrets
```

---

## Where Each Key Lives

| Key type | File | Example |
|----------|------|---------|
| Shared API keys (multiple agents use) | `orgs/{org}/.env` | `OPENAI_API_KEY`, `APIFY_TOKEN` |
| Agent Telegram credentials | `agents/{agent}/.env` | `BOT_TOKEN`, `CHAT_ID`, `ALLOWED_USER` |
| Agent OAuth tokens | `agents/{agent}/.env` | `CLAUDE_CODE_OAUTH_TOKEN` |

**Rule:** If more than one agent uses a key, it belongs in the org `.env`. If only one agent uses it, it belongs in that agent's `.env`.

`ANTHROPIC_API_KEY` is inherited from the shell that launched the daemon — never stored in any file.

---

## Adding a New Shared Secret

```bash
# 1. Locate the org .env
ORG_ENV="$CTX_FRAMEWORK_ROOT/orgs/$CTX_ORG/.env"

# 2. Append the new key (never overwrite existing)
echo 'NEW_KEY=value' >> "$ORG_ENV"
chmod 600 "$ORG_ENV"

# 3. Restart all running agents so they pick it up
cortextos list-agents --format json | jq -r '.[].name' | while read agent; do
  cortextos bus hard-restart --agent "$agent" --reason "new shared secret added: NEW_KEY"
done
```

---

## Adding an Agent-Specific Secret

```bash
# 1. Locate the agent .env
AGENT_ENV="$CTX_FRAMEWORK_ROOT/orgs/$CTX_ORG/agents/$CTX_AGENT_NAME/.env"

# 2. Append the key
echo 'MY_KEY=value' >> "$AGENT_ENV"
chmod 600 "$AGENT_ENV"

# 3. Restart THIS agent only (soft restart to preserve context if possible)
cortextos bus self-restart --reason "new agent secret added: MY_KEY"
```

---

## Checking What Keys Are Configured

```bash
# Check org-level keys (names only — never print values)
grep -v '^#' "$CTX_FRAMEWORK_ROOT/orgs/$CTX_ORG/.env" | grep '=' | cut -d= -f1

# Check agent-level keys (names only)
grep -v '^#' "$CTX_FRAMEWORK_ROOT/orgs/$CTX_ORG/agents/$CTX_AGENT_NAME/.env" | grep '=' | cut -d= -f1

# Verify a key is set in current session
[[ -n "${SOME_KEY:-}" ]] && echo "SET" || echo "NOT SET"
```

---

## Critical Rules

1. **Never print secret values** — log key names only, never values
2. **Never commit .env files** — they are in .gitignore by design
3. **Always chmod 600** after writing any .env file
4. **Never edit a running agent's .env without restarting** — changes won't take effect until the PTY env is rebuilt
5. **Never add BOT_TOKEN to org .env** — each agent must have its own Telegram bot
6. **ANTHROPIC_API_KEY lives only in the shell** — do not add to any .env file
