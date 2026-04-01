---
name: agent-management
description: "You need to create a new agent, restart a crashed agent, change an agent's model or config, fix a Telegram bot token, troubleshoot why an agent is not responding, enable or disable an agent, spawn an agent for another user, manage launchd persistence, reset crash limits, or do anything that touches an agent's lifecycle, configuration, or credentials. This is the definitive guide for every agent operation in cortextOS."
triggers: ["new agent", "create agent", "spawn agent", "add agent", "restart", "soft restart", "hard restart", "disable agent", "enable agent", "change model", "switch model", "bot token", "BotFather", "agent not responding", "agent crashed", "agent down", "crash limit", "reset crashes", "agent health", "list agents", "heartbeat", "onboard", "setup agent", "configure agent", ".env", "config.json", "launchd", "plist", "tmux session", "cross-org", "agent for someone else", "agent management", "agent lifecycle", "agent credentials", "telegram bot", "token not working"]
---

# Agent Management

> The definitive guide for managing cortextOS agent lifecycle. Every operation, every script, every protocol. Follow these EXACTLY - do not improvise.

---

## CRITICAL RULES

1. **ALWAYS use the scripts.** Never manually edit state files, plists, or .env without using the proper script.
2. **ALWAYS create .env before enabling.** An agent without .env will inherit parent credentials (the Becky bug).
3. **ALWAYS write restart markers before /exit.** Use soft-restart.sh, never raw send-keys /exit.
4. **ALWAYS use enable-agent.sh to start agents.** Never manually load plists.
5. **NEVER share bot tokens between agents.** Each agent gets its own bot from @BotFather.
6. **NEVER hardcode chat IDs.** Get them from the actual user via Telegram getUpdates.

---

## 1. Creating a New Agent

### For Yourself (Same User)

```bash
# Option A: Interactive setup (recommended for first agent)
cortextos install

# Option B: Manual (for subsequent agents)
# Step 1: Pick a template
TEMPLATE="agent"  # or "orchestrator" or "analyst"
AGENT_NAME="myagent"
ORG="myorg"

# Step 2: Copy template
cp -r "$CTX_FRAMEWORK_ROOT/templates/$TEMPLATE" \
      "$CTX_FRAMEWORK_ROOT/orgs/$ORG/agents/$AGENT_NAME"

# Step 3: Create Telegram bot
# Tell the user:
# 1. Open Telegram, message @BotFather
# 2. Send /newbot
# 3. Choose a name (e.g., "My Agent")
# 4. Choose a username (e.g., myagent_cortextos_bot)
# 5. Copy the bot token

# Step 4: Get chat ID
# Tell the user:
# 1. Send any message to the new bot
# 2. Run: curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" | jq '.result[0].message.chat.id'
# 3. That number is the chat_id

# Step 5: Get user ID (for ALLOWED_USER security)
# Same getUpdates response: .result[0].message.from.id

# Step 6: Write .env (CRITICAL - do this BEFORE enable-agent.sh)
cat > "$CTX_FRAMEWORK_ROOT/orgs/$ORG/agents/$AGENT_NAME/.env" << EOF
BOT_TOKEN=<token from BotFather>
CHAT_ID=<chat_id from getUpdates>
ALLOWED_USER=<user_id from getUpdates>
EOF
chmod 600 "$CTX_FRAMEWORK_ROOT/orgs/$ORG/agents/$AGENT_NAME/.env"

# Step 7: Update config.json
python3 -c "
import json
with open('$CTX_FRAMEWORK_ROOT/orgs/$ORG/agents/$AGENT_NAME/config.json') as f:
    c = json.load(f)
c['agent_name'] = '$AGENT_NAME'
c['enabled'] = True
with open('$CTX_FRAMEWORK_ROOT/orgs/$ORG/agents/$AGENT_NAME/config.json', 'w') as f:
    json.dump(c, f, indent=2)
"

# Step 8: Create symlinks for shared docs
cd "$CTX_FRAMEWORK_ROOT/orgs/$ORG/agents/$AGENT_NAME"
ln -sf "../../../SYSTEM.md" SYSTEM.md 2>/dev/null
ln -sf "../../../TOOLS.md" TOOLS.md 2>/dev/null

# Step 9: Enable (creates launchd plist and starts agent)
bash "$CTX_FRAMEWORK_ROOT/scripts/enable-agent.sh" "$AGENT_NAME" --org "$ORG"

# Step 10: Verify
tmux attach -t "ctx-default-$ORG-$AGENT_NAME"
# Approve trust prompt, then Ctrl-b d to detach
```

### For Another Person (Cross-User Agent)

This is the pattern tallybot should have used for Becky. The key difference: the OTHER person's bot token and chat ID, not yours.

```bash
AGENT_NAME="theiragent"
ORG="myorg"  # Same org, different user
THEIR_BOT_TOKEN="<token from THEIR BotFather bot>"
THEIR_CHAT_ID="<THEIR chat_id, NOT yours>"
THEIR_USER_ID="<THEIR user_id>"

# Step 1: Copy template
cp -r "$CTX_FRAMEWORK_ROOT/templates/agent" \
      "$CTX_FRAMEWORK_ROOT/orgs/$ORG/agents/$AGENT_NAME"

# Step 2: Write THEIR .env (CRITICAL - must be THEIR credentials)
cat > "$CTX_FRAMEWORK_ROOT/orgs/$ORG/agents/$AGENT_NAME/.env" << EOF
BOT_TOKEN=$THEIR_BOT_TOKEN
CHAT_ID=$THEIR_CHAT_ID
ALLOWED_USER=$THEIR_USER_ID
EOF
chmod 600 "$CTX_FRAMEWORK_ROOT/orgs/$ORG/agents/$AGENT_NAME/.env"

# Step 3: Update config.json
python3 -c "
import json
with open('$CTX_FRAMEWORK_ROOT/orgs/$ORG/agents/$AGENT_NAME/config.json') as f:
    c = json.load(f)
c['agent_name'] = '$AGENT_NAME'
c['enabled'] = True
with open('$CTX_FRAMEWORK_ROOT/orgs/$ORG/agents/$AGENT_NAME/config.json', 'w') as f:
    json.dump(c, f, indent=2)
"

# Step 4: Enable
bash "$CTX_FRAMEWORK_ROOT/scripts/enable-agent.sh" "$AGENT_NAME" --org "$ORG"

# VERIFY: The new agent messages THEM, not you
# If messages come to you instead of them, the .env has wrong CHAT_ID
```

**Common Mistake (Becky Bug):** If you skip the .env creation, the agent inherits YOUR credentials from the parent environment. Messages meant for the other user go to YOU instead. ALWAYS create .env BEFORE enabling.

---

## 2. Restarting Agents

### Soft Restart (Preserves Conversation)

```bash
# ALWAYS use the script - it writes the marker file
cortextos bus send-message <agent_name> high "soft-restart" "<reason>"

# Example:
cortextos bus send-message sentinel high "soft-restart" "model change to sonnet"
```

**What it does:**
1. Writes `.user-restart` marker (prevents false crash alert)
2. Sends Escape (clears TUI state)
3. Sends /exit (Claude exits gracefully)
4. Wrapper detects exit, finds marker, categorizes as "user_initiated"
5. Wrapper relaunches with --continue (preserves conversation history)

**NEVER do this:**
```bash
# BAD - no marker file, triggers crash alert
tmux send-keys -t ctx-default-lifeos-sentinel "/exit" Enter
```

### Hard Restart (Fresh Session, Loses History)

```bash
# Use the script - it has an approval gate
cortextos bus hard-restart --reason "context exhaustion"
```

**When to use:** Context window full, conversation corrupted, need clean slate.

### Restart from Another Agent

```bash
# Soft restart another agent
cortextos bus send-message donna high "soft-restart" "goal refresh"

# Check if it worked (wait 30s for restart)
sleep 30
tmux has-session -t ctx-default-lifeos-donna 2>/dev/null && echo "alive" || echo "restarting"
```

---

## 3. Changing Agent Model

```bash
AGENT="sentinel"
ORG="lifeos"
NEW_MODEL="claude-sonnet-4-6"  # or "claude-opus-4-6" or "claude-haiku-4-5-20251001"

# Step 1: Update config.json
python3 -c "
import json
path = '$CTX_FRAMEWORK_ROOT/orgs/$ORG/agents/$AGENT/config.json'
with open(path) as f:
    c = json.load(f)
c['model'] = '$NEW_MODEL'
with open(path, 'w') as f:
    json.dump(c, f, indent=2)
"

# Step 2: Soft restart to pick up new model
cortextos bus send-message "$AGENT" high "soft-restart" "model change to $NEW_MODEL"
```

**Available models:**
- `claude-opus-4-6` - Most capable, highest cost
- `claude-sonnet-4-6` - Good balance, ~5x cheaper than Opus
- `claude-haiku-4-5-20251001` - Fastest, cheapest, for simple tasks

**No model set = default (Opus).** Always set explicitly for cost control.

---

## 4. Managing Bot Tokens

### Creating a New Bot

Guide the user through BotFather:
1. Open Telegram, message @BotFather
2. Send `/newbot`
3. Enter display name (e.g., "Donna - LifeOS Assistant")
4. Enter username (must end in `bot`, e.g., `donna_lifeos_bot`)
5. Copy the token (format: `1234567890:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)

### Getting Chat ID

After the user messages the bot:
```bash
BOT_TOKEN="<the token>"
curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getUpdates" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print(d['result'][0]['message']['chat']['id'])"
```

**Note:** If getUpdates returns empty, the user needs to send /start to the bot first.

### Getting User ID (ALLOWED_USER)

Same getUpdates response:
```bash
curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getUpdates" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print(d['result'][0]['message']['from']['id'])"
```

### Updating a Bot Token

```bash
AGENT="donna"
ORG="lifeos"

# Edit .env (replace BOT_TOKEN line)
sed -i '' "s/^BOT_TOKEN=.*/BOT_TOKEN=<new_token>/" \
  "$CTX_FRAMEWORK_ROOT/orgs/$ORG/agents/$AGENT/.env"

# Restart to pick up new token
cortextos bus send-message "$AGENT" high "soft-restart" "bot token updated"
```

---

## 5. Managing .env Files

### Required Fields
```bash
BOT_TOKEN=<telegram bot token>
CHAT_ID=<telegram chat id for the user>
ALLOWED_USER=<telegram user id for security filtering>
```

### File Permissions
```bash
chmod 600 "$CTX_FRAMEWORK_ROOT/orgs/$ORG/agents/$AGENT/.env"
```

### Verifying .env
```bash
# Check if .env exists and has required fields
AGENT_ENV="$CTX_FRAMEWORK_ROOT/orgs/$ORG/agents/$AGENT/.env"
if [[ ! -f "$AGENT_ENV" ]]; then
    echo "ERROR: No .env file for $AGENT!"
elif ! grep -q "BOT_TOKEN=" "$AGENT_ENV"; then
    echo "ERROR: Missing BOT_TOKEN in $AGENT .env"
elif ! grep -q "CHAT_ID=" "$AGENT_ENV"; then
    echo "ERROR: Missing CHAT_ID in $AGENT .env"
elif ! grep -q "ALLOWED_USER=" "$AGENT_ENV"; then
    echo "WARNING: Missing ALLOWED_USER - agent will reject all Telegram messages"
fi
```

---

## 6. Managing Crons

### Adding a Cron
```bash
AGENT="sentinel"
ORG="lifeos"

# Edit config.json to add cron
python3 -c "
import json
path = '$CTX_FRAMEWORK_ROOT/orgs/$ORG/agents/$AGENT/config.json'
with open(path) as f:
    c = json.load(f)
c.setdefault('crons', []).append({
    'name': 'new-cron',
    'interval': '2h',
    'prompt': 'Do the thing'
})
with open(path, 'w') as f:
    json.dump(c, f, indent=2)
"

# Notify agent to reload crons
cortextos bus send-message "$AGENT" normal \
  'Crons updated in config.json. Re-read your config.json and set up the new cron with /loop.'
```

### Removing a Cron
```bash
# Edit config.json to remove cron by name
python3 -c "
import json
path = '$CTX_FRAMEWORK_ROOT/orgs/$ORG/agents/$AGENT/config.json'
with open(path) as f:
    c = json.load(f)
c['crons'] = [cr for cr in c.get('crons', []) if cr['name'] != 'cron-to-remove']
with open(path, 'w') as f:
    json.dump(c, f, indent=2)
"

# Notify agent
cortextos bus send-message "$AGENT" normal \
  'Cron removed from config.json. The old cron will stop on next restart.'
```

---

## 7. Enabling / Disabling Agents

### Enable
```bash
cortextos enable <agent> --org <org>

# With restart (resets crash counter)
cortextos enable <agent> --org <org> --restart
```

### Disable
```bash
cortextos disable <agent> --org <org>
```
This unloads the launchd plist, kills the tmux session, and marks the agent as disabled. Config and .env are preserved.

---

## 8. Health Checks

### Check All Agents
```bash
cortextos bus read-all-heartbeats
```

### Check Specific Agent
```bash
# Is the tmux session alive?
tmux has-session -t "ctx-default-$ORG-$AGENT" 2>/dev/null && echo "alive" || echo "dead"

# What is it doing?
tmux capture-pane -t "ctx-default-$ORG-$AGENT" -p | tail -10

# Is Claude running or just bash?
tmux capture-pane -t "ctx-default-$ORG-$AGENT" -p | tail -3 | grep -q "bash-" && echo "DEAD - at bash prompt" || echo "Claude running"
```

### List All Agents
```bash
cortextos list-agents --format json
```

---

## 9. Crash Recovery

### Reset Crash Counter
```bash
rm -f "$HOME/.cortextos/default/state/$AGENT/.crash_count_today"
```

### Force Fresh Start (Lose Conversation)
```bash
echo "" > "$HOME/.cortextos/default/state/$AGENT/.force-fresh"
cortextos enable "$AGENT" --org "$ORG" --restart
```

### Agent Stuck at Bash Prompt
```bash
# Check if Claude exited to bash
tmux capture-pane -t "ctx-default-$ORG-$AGENT" -p | tail -3

# If you see "bash-3.2$", Claude is dead. Resume it:
SESSION_ID=$(tmux capture-pane -t "ctx-default-$ORG-$AGENT" -p | grep "claude --resume" | grep -o '[a-f0-9-]\{36\}')
tmux send-keys -t "ctx-default-$ORG-$AGENT" "claude --resume $SESSION_ID --dangerously-skip-permissions" Enter

# Or soft restart for a clean session:
cortextos bus send-message "$AGENT" high "soft-restart" "recovery from dead bash"
```

---

## 10. Troubleshooting

### Agent Not Responding to Telegram
1. Check .env exists and has BOT_TOKEN + CHAT_ID + ALLOWED_USER
2. Check fast-checker is running: `ps aux | grep fast-checker | grep $AGENT`
3. Check fast-checker log: `tail -10 $HOME/.cortextos/default/logs/$AGENT/fast-checker.log`
4. Check if Claude is alive: `tmux capture-pane -t ctx-default-$ORG-$AGENT -p | tail -5`

### Messages Going to Wrong Person
1. Check .env CHAT_ID - is it the right person's chat ID?
2. Check .env BOT_TOKEN - is it the right bot?
3. If agent was spawned by another agent, the parent's env vars may have leaked (Becky bug)
4. Fix: rewrite .env with correct credentials, soft restart

### Agent Keeps Crashing
1. Check crash count: `cat $HOME/.cortextos/default/state/$AGENT/.crash_count_today`
2. Check stderr: `tail -20 $HOME/.cortextos/default/logs/$AGENT/stderr.log`
3. Common causes: rate limit, auth expired, context exhaustion
4. Fix: reset crash count, fix root cause, enable --restart

### False Crash Alerts on Restart
1. Always use soft-restart.sh (writes marker file)
2. If you must use raw /exit, write the marker first:
   ```bash
   echo "reason" > "$HOME/.cortextos/default/state/$AGENT/.user-restart"
   ```

### Launchd Not Restarting Agent
1. Check plist exists: `ls ~/Library/LaunchAgents/cortextos*$AGENT*`
2. Check launchd status: `launchctl list | grep $AGENT`
3. If exit code shows, agent may be throttled. Wait 10s or use enable-agent.sh --restart

---

## Quick Reference

| I need to... | Script |
|---|---|
| Create new agent | `setup.sh` or manual steps above |
| Enable agent | `enable-agent.sh <agent> --org <org>` |
| Disable agent | `disable-agent.sh <agent> --org <org>` |
| Soft restart | `soft-restart.sh <agent> "<reason>"` |
| Hard restart | `hard-restart.sh --reason "<reason>"` |
| Change model | Edit config.json model field + soft restart |
| Update bot token | Edit .env BOT_TOKEN + soft restart |
| Add cron | Edit config.json crons + notify agent |
| Check health | `read-all-heartbeats.sh` |
| List agents | `list-agents.sh --format json` |
| Check tmux | `tmux capture-pane -t ctx-default-<org>-<agent> -p` |
| Reset crash count | `rm ~/.cortextos/default/state/<agent>/.crash_count_today` |
| Force fresh start | Write .force-fresh + enable --restart |
