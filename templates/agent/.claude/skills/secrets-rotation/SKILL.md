---
name: secrets-rotation
description: "An API key has been compromised, a provider has forced a rotation, a token has expired, or you are doing a scheduled security rotation. You need to update the key in the right file (org .env or agent .env depending on scope), identify which agents are affected, restart them in sequence so they pick up the new value, and confirm the rotation is complete. A key update without an agent restart does nothing — the old value stays in the PTY environment."
triggers: ["rotate key", "rotate token", "key compromised", "token expired", "update api key", "new bot token", "revoke key", "credential rotation", "security rotation", "key rotation", "secret rotation", "key was leaked", "compromised credential", "force rotation", "provider rotated", "expired key", "rotate credentials", "update secret", "cycle credentials"]
---

# Secrets Rotation

Rotating a secret requires updating the file AND restarting affected agents. Updating the file alone does nothing — agents hold the old value in their PTY environment until they restart.

---

## Rotation Decision Tree

```
Is this a shared org-level key (OPENAI_API_KEY, APIFY_TOKEN, etc.)?
  → Update orgs/{org}/.env → restart ALL agents

Is this an agent-specific key (BOT_TOKEN, CHAT_ID, OAuth token)?
  → Update agents/{agent}/.env → restart THAT AGENT ONLY

Is this ANTHROPIC_API_KEY?
  → Update ~/.zshrc or ~/.bashrc → restart the daemon process itself
  → Do NOT store in any .env file
```

---

## Rotating a Shared Org Secret

```bash
# 1. Update the value
ORG_ENV="$CTX_FRAMEWORK_ROOT/orgs/$CTX_ORG/.env"
# Edit the file — change the value on the relevant line
# Use a text editor or sed (be careful with special characters in values)

# 2. Verify the new value is set
grep "KEY_NAME=" "$ORG_ENV" | cut -d= -f1  # prints name only, not value

# 3. Create approval if this is a sensitive rotation
cortextos bus create-approval "Rotate KEY_NAME for all agents" other "Compromised/expired. Will restart all agents in sequence."

# 4. After approval — restart all agents in sequence (stagger to avoid gaps)
cortextos list-agents --format json | jq -r '.[].name' | while read agent; do
  echo "Restarting $agent..."
  cortextos bus hard-restart --agent "$agent" --reason "secret rotation: KEY_NAME"
  sleep 30  # stagger restarts
done
```

---

## Rotating an Agent-Specific Secret

```bash
# 1. Update the agent's .env
AGENT_ENV="$CTX_FRAMEWORK_ROOT/orgs/$CTX_ORG/agents/AGENT_NAME/.env"
# Edit the file

chmod 600 "$AGENT_ENV"

# 2. Restart that agent
cortextos bus hard-restart --agent AGENT_NAME --reason "secret rotation: KEY_NAME"
```

---

## Rotating a Bot Token (BOT_TOKEN)

Bot tokens are agent-specific. If a Telegram bot token is compromised:

1. Go to @BotFather → `/mybots` → select the bot → `API Token` → `Revoke current token`
2. Copy the new token
3. Update `agents/{agent}/.env` — replace `BOT_TOKEN=` value
4. Hard-restart the agent

**Note:** Revoking the old token in BotFather immediately invalidates it. Do step 3 and 4 immediately after step 1 to minimize downtime.

---

## Critical Rules

1. **Never print the new value in a task description or Telegram message** — log "KEY_NAME rotated" only
2. **Always hard-restart** (not soft-restart) after rotating secrets — soft-restart preserves the PTY env which still has the old value
3. **Stagger restarts** when rotating org-level keys — don't restart all agents simultaneously
4. **Notify the user** before and after rotation via Telegram
5. **Log the event**:
```bash
cortextos bus log-event action secret_rotated info --meta "{\"key\":\"KEY_NAME\",\"scope\":\"org|agent\",\"agent\":\"$CTX_AGENT_NAME\"}"
```
