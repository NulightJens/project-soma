---
name: onboarding
description: Interactive onboarding for cortextOS Node.js — walks through full setup from zero to a running multi-agent system
---

You are guiding the user through a complete interactive onboarding for cortextOS (Node.js version). Walk through each phase **in order**, checking results before proceeding. Explain everything in casual plain English. If any step fails, diagnose and fix before moving on. You must go through every step even if diverted mid step by the user. No exceptions. 

**CRITICAL**: Sections marked with > blockquotes are **verbatim text** — deliver these word-for-word. Do not skip or paraphrase them.

**CRITICAL**: The more context the user provides, the better the system performs from day one. Encourage them to elaborate. Do not rush.

---

## Phase 1: Welcome

### 1a. Welcome

> "cortextOS is a system for running persistent 24/7 Claude Code agents. Your agents run in the background, coordinate with each other and can freely message between each other, manage tasks on a shared tasks board, request your approval for important decisions, and you control everything from Telegram on your phone or the cortextOS web dashboard."

> "Here's what you're about to set up:"
> - **Persistent agents** that run 24/7 with automatic crash recovery and session continuation. Each agent is a full Claude Code CLI session.
> - **Telegram control** — text back and forth with your agents from your phone with full Claude Code capabilities.
> - **Organizations** — groups of agents working together toward shared goals. Create as many organizations as you want and switch between them in the dashboard.
> - **Task management** — agents create, assign, and complete tasks visible on a dashboard.
> - **Approval workflows** — agents request your sign-off before taking high-stakes actions. Agents can also assign you tasks when they need your help.
> - **Analytics** — cost tracking, task throughput, agent effectiveness metrics for optimization.
> - **Web dashboard** — real-time monitoring of your entire system in a browser.
> - **Agent teams** — your agents can spin up other persistent agents as permanent members of the team, and ephemeral worker agents for isolated deep work tasks. Agents can manage other agents as many layers deep as you want.
> - **Autoresearch** — agents run continuous experiments to improve themselves and your system. Measure outcomes, learn, propose changes — all gated by your approval.
> - **Compounding community intelligence** — an open-source skill app store where cortextOS users worldwide share workflows, automations, and skills they've built for their businesses. Your Analyst pulls weekly updates and knows when to suggest submitting your own discoveries back to the community.
> - **Theta wave** — a nightly deep analysis session between your Orchestrator and Analyst: they pull all system analytics, read every agent's workspace, and propose system-wide experiments to optimize performance.
> - **Semantic Knowledge Base** — agents upload files from their workspace into a shared RAG database, searchable from the dashboard. Supports docs, images, audio, video — anything you want them to store as long-term shared memory.
> - **Native iPhone App** *(coming soon)* — dashboard + Telegram in one app with push notifications and full system control from your phone.
> - **Full codebase access** — agents can read and write your dashboard, core scripts, and the markdown files that define their own behavior. They can build custom dashboard pages for your business and eventually extend the iPhone app.

> "Every cortextOS system is built around two core agents that are always present: the **Orchestrator** and the **Analyst**. They are the two halves of your cortextOS brain."
>
> "The **Orchestrator** is the leader. It takes your directives from Telegram, breaks them into tasks, delegates to the rest of your team, monitors what's getting done, routes approvals to you, and sends your daily briefings. It's your right hand — the agent that keeps everything moving in the right direction."
>
> "The **Analyst** is the optimizer. It watches the entire system from the outside — tracking metrics, reading every agent's workspace, spotting bottlenecks and anomalies, and running the theta wave each night. It doesn't execute work; it makes the whole system better at executing work. Think of it as the CTO of your AI team."
>
> "Together they run a continuous improvement loop while you sleep: the Orchestrator drives execution, the Analyst measures outcomes and proposes experiments, and every proposed change comes to you for approval before it goes live. The system gets smarter every week without you having to manage it."
>
> "Every specialist agent you add reports up to the Orchestrator. The Analyst watches all of them. The deeper your team grows, the more leverage these two give you."

> "Here's how it works under the hood: A Node.js daemon manages your agents as persistent processes. Each agent is a Claude Code session running in a PTY — it reads its own markdown files (identity, goals, soul, heartbeat), sets up scheduled tasks, and communicates via a file-based message bus. You talk to agents over Telegram via their own bots. Everything is logged, monitored, and visible on a dashboard."

> "The setup flow: I'll help you configure the technical infrastructure here in Claude Code. Then your Orchestrator agent will come online in Telegram and walk you through its own setup — role confirmation, goals, cron schedule, communication preferences. At the end of that, the Orchestrator will walk you through creating a Telegram bot for your Analyst agent. The Analyst then does its own Telegram onboarding — monitoring setup, theta wave config, ecosystem preferences. Once that's done, the Analyst will recommend specialist agents based on your goals, and the Orchestrator handles creating each one. You'll just need to create a Telegram bot for each new agent via @BotFather."

Ask: "Ready to get started? And — do you already have a Telegram bot token ready, or do we need to create one? While you answer, I will set up the dependencies"

---

## Phase 2: Dependency Check

Check and auto-install all dependencies. Do not ask permission — just install what is missing.

**First: verify Claude Code is authenticated** — agents run as Claude Code sessions and require a valid login:
```bash
claude --version
```
If the command fails or shows an auth error:
> "Claude Code is not authenticated. Run `claude login` in your terminal to sign in, then restart this Claude Code session."

Do not proceed until Claude Code is authenticated.

```bash
# Check each dependency
which node      # Node.js 20+
which npm       # npm
which claude    # Claude Code CLI
which pm2       # PM2 process manager (for daemon persistence)
which jq        # JSON processor
which curl      # HTTP client
```

Detect the platform first:
```bash
OS=$(uname -s 2>/dev/null || echo "Windows")
```

For any missing dependency, install using the appropriate package manager:

**macOS:**
- `node` / `npm`: `brew install node`
- `jq`: `brew install jq`

**Linux (Debian/Ubuntu):**
- `node` / `npm`: `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt-get install -y nodejs`
- `jq`: `sudo apt-get install -y jq`

**Windows (PowerShell — run as Administrator):**
- `node` / `npm`: `winget install OpenJS.NodeJS` or `choco install nodejs`
- `jq`: `winget install jqlang.jq` or `choco install jq`

**All platforms:**
- `pm2`: `npm install -g pm2`
- `claude`: Tell user to install from https://docs.anthropic.com/en/docs/claude-code — cannot be auto-installed

Verify Node is v20+:
```bash
node --version
```

If `pm2` is not installed, install it:
```bash
npm install -g pm2
```

---

## Phase 3: Install

Check if already installed by looking for `dist/cli.js`:

```bash
ls dist/cli.js 2>/dev/null && echo "installed" || echo "need to build"
```

If not built:
```bash
npm install
npm run build
```

Run the test suite to verify the build is healthy:
```bash
npm test
```

**VERIFY**: All tests must pass before proceeding. If any fail, surface the failures:
> "Some tests failed. This usually means a dependency issue or a platform incompatibility. Let's fix it before moving on."

Diagnose and fix any failures, then re-run until clean.

Then run install:
```bash
node dist/cli.js install
```

Or if the user has `cortextos` in their PATH:
```bash
cortextos install
```

**Do not ask the user about instance names.** Auto-assign one silently:

```bash
# Find next available instance name
INSTANCE_NUM=1
while [ -d "${HOME}/.cortextos/cortextos${INSTANCE_NUM}" ]; do
  INSTANCE_NUM=$((INSTANCE_NUM + 1))
done
INSTANCE_ID="cortextos${INSTANCE_NUM}"
```

**Note on environment variables:** `CTX_INSTANCE_ID`, `CTX_ROOT`, `CTX_ORG`, and `CTX_AGENT_NAME` are set automatically by the framework based on where commands are run from. You do not need to set these manually — they are referenced in the examples below for clarity.

Set variables for the rest of onboarding:
```bash
CTX_ROOT="${HOME}/.cortextos/${INSTANCE_ID}"
```

---

## Phase 4: Organization Setup

### 4a. Explain Organizations (verbatim)

> "cortextOS organizes your agents into Organizations. An Organization is a group of agents that work together toward shared goals — for your business, a side project, or any domain of your life. Each org has its own task queue, approval workflow, analytics, set of dashboard pages, and shared context."

### 4b. Gather Organization context

Ask these questions one at a time. Follow up on interesting answers. Let the user elaborate.

1. The more detail and context you give me to answer questions during onboarding, the better cortextOS will work for you after install. This applies for all onboarding steps of the system. "What do you want to call your first Organization?" (lowercase, hyphens OK — e.g., `mycompany`, `life-ops`, `cointally`)

**Validate**: Convert to lowercase, replace spaces with hyphens, strip characters that are not `a-z`, `0-9`, or `-`. Show the cleaned name and confirm.

2. "Describe what this Organization does in a sentence or two."
3. "What's the Organization's North Star — the ONE long-term goal everything should work toward?"
4. "What are the top 1-3 goals right now to move toward that?"
5. "What's the single most important thing to get done this week? One sentence." (this becomes `daily_focus`)
6. "What's your timezone?" (auto-detect if possible: `readlink /etc/localtime 2>/dev/null | sed 's:.*/zoneinfo/::'`)
7. "What communication style should your agents have? Casual / professional / technical?"

### 4c. Create Organization

```bash
ORG_NAME="<validated org name>"
node dist/cli.js init "${ORG_NAME}" --instance "${INSTANCE_ID}"
```

This creates `orgs/${ORG_NAME}/` with context.json, goals.json, and knowledge.md.

Update `orgs/${ORG_NAME}/context.json` with the gathered context (use the Write tool):
```json
{
  "name": "<org name>",
  "description": "<user's description>",
  "timezone": "<IANA timezone>",
  "communication_style": "<casual|professional|technical>",
  "orchestrator": ""
}
```

Update `orgs/${ORG_NAME}/goals.json`:
```json
{
  "north_star": "<their north star answer>",
  "daily_focus": "<their answer to question 5>",
  "daily_focus_set_at": "<current ISO timestamp>",
  "goals": ["<goal 1>", "<goal 2>", "<goal 3>"],
  "bottleneck": "",
  "updated_at": "<current ISO timestamp>"
}
```

### 4d. Knowledge Base

Ask:
> "Let's set up your org's shared knowledge file. This is context that all your agents read on every boot. Tell me:"
> 1. "Your business or project — what does it do, key products/services, model?"
> 2. "Your team — key people and roles (human or AI, we will set up your other agents later)"
> 3. "Technical setup — existing projects on this computer or elsewhere, repos, infrastructure, tools, key services"
> 4. "Important links — dashboards, docs, tools"
> 5. "Any key decisions or context agents should know?"

Write the answers to `orgs/${ORG_NAME}/knowledge.md`. If answers are sparse, that's fine — agents will add to it.

---

## Phase 5: Agent Planning

### 5a. Explain the team roles (verbatim)

> "Every Organization has two core roles: the **Orchestrator** and the **Analyst**."
>
> "The **Orchestrator** is your right hand — takes your directives, decomposes them into tasks, delegates to specialist agents, monitors progress, routes approvals, sends you briefings. It coordinates; it doesn't do specialist work itself."
>
> "The **Analyst** is your system optimizer — monitors agent health, collects metrics, detects anomalies, proposes improvements. Think of it as the CTO of your AI team."
>
> "Beyond these two, you can add specialist agents later through your Orchestrator on Telegram."

### 5b. Get agent names

Ask: "What do you want to call your Orchestrator?" (suggest something org-appropriate — e.g., `commander`, `coordinator`, `chief`)

**Validate**: lowercase, hyphens, no special chars. Confirm with user.

Ask: "What do you want to call your Analyst?" (suggest: `analyst`, `sentinel`, `monitor`, `watchdog`)

**Validate**: same rules. Confirm.

Store: `ORCH_NAME` and `ANALYST_NAME`

---

## Phase 6: Orchestrator Setup

### 6a. Telegram Bot Setup

Walk through step by step:

1. "Open Telegram on your phone or desktop"
2. "Search for **@BotFather** and start a chat"
3. "Send `/newbot`"
4. "Give it a display name (e.g., 'MyOrg Orchestrator')"
5. "Give it a username that ends in 'bot' (e.g., 'myorg_commander_bot')"
6. "BotFather will reply with an HTTP API token — paste it here"
7. Click the t.me link BotFather provides you to open the chat with your new agent. 

After token paste:

7. "Now send any message to your new bot on Telegram (just 'hi' is fine). This lets me detect your chat ID so that only you can message your agent. You can configure other chat IDs later so other members of your team can you cortextOS as well."

Wait for confirmation, then auto-detect. Use long polling (timeout=30) so Telegram holds the connection open until a message arrives instead of returning empty immediately. This is critical for newly created bots where there's propagation delay:

```bash
ORCH_BOT_TOKEN="<pasted token>"
for i in 1 2 3; do
    CHAT_INFO=$(curl -s "https://api.telegram.org/bot${ORCH_BOT_TOKEN}/getUpdates?timeout=30")
    ORCH_CHAT_ID=$(echo "$CHAT_INFO" | jq -r '.result[0].message.chat.id // empty')
    ORCH_USER_ID=$(echo "$CHAT_INFO" | jq -r '.result[0].message.from.id // empty')
    [[ -n "$ORCH_CHAT_ID" ]] && break
    sleep 5
done
```

If ORCH_CHAT_ID is empty after 3 retries, tell user to send another message and try again. Do not proceed until it's a valid number.

**Do NOT flush the Telegram offset** — the agent should see the user's first message when it boots.

### 6b. Create Agent Directory

```bash
node dist/cli.js add-agent "${ORCH_NAME}" --template orchestrator --org "${ORG_NAME}" --instance "${INSTANCE_ID}"
```

Write `.env` with credentials:
```bash
cat > "orgs/${ORG_NAME}/agents/${ORCH_NAME}/.env" << EOF
BOT_TOKEN=${ORCH_BOT_TOKEN}
CHAT_ID=${ORCH_CHAT_ID}
ALLOWED_USER=${ORCH_USER_ID}
EOF
chmod 600 "orgs/${ORG_NAME}/agents/${ORCH_NAME}/.env"
```

Update `config.json` with agent name:
```bash
ORCH_CONFIG="orgs/${ORG_NAME}/agents/${ORCH_NAME}/config.json"
jq --arg name "${ORCH_NAME}" '.agent_name = $name' "${ORCH_CONFIG}" > "${TMPDIR:-/tmp}/_cfg.json" && mv "${TMPDIR:-/tmp}/_cfg.json" "${ORCH_CONFIG}"
```

### 6c. Model Selection

Ask: "Which Claude model should your Orchestrator use? Recommended: `claude-opus-4-6` for the Orchestrator (most capable), `claude-sonnet-4-6` for worker agents (faster, cheaper)."

```bash
ORCH_CONFIG="orgs/${ORG_NAME}/agents/${ORCH_NAME}/config.json"
jq --arg model "claude-opus-4-6" '.model = $model' "${ORCH_CONFIG}" > "${TMPDIR:-/tmp}/_cfg.json" && mv "${TMPDIR:-/tmp}/_cfg.json" "${ORCH_CONFIG}"
```

**Note:** Everything else — identity, personality, working hours, autonomy level, approval policy, cron schedule, USER.md — is configured by the Orchestrator itself during its Telegram onboarding. The template provides sensible defaults; the agent rewrites them with real content.

### 6d. Enable Orchestrator

```bash
node dist/cli.js enable "${ORCH_NAME}" --instance "${INSTANCE_ID}"
```

Verify:
```bash
cat "${CTX_ROOT}/config/enabled-agents.json" | jq '.agents[] | select(.name == "'${ORCH_NAME}'")'
```

---

## Phase 7: Start the Daemon

### 7a. Generate PM2 config

```bash
node dist/cli.js ecosystem
```

This generates `ecosystem.config.js` in the current directory. Verify it exists.

### 7b. Start with PM2

```bash
pm2 start ecosystem.config.js
```

Wait 5-10 seconds for the daemon to initialize, then save and set up auto-start:

```bash
pm2 save
pm2 startup
```

> "PM2 just printed a command starting with `sudo env PATH=...`. Open a new terminal window, paste that command, and run it. It sets up the daemon to survive reboots. You only need to do this once."
>
> "When you run it, your computer may ask for your password — this is normal. It's your Mac login password (or Linux user password), not any cortextOS password. Just type it in and press Enter. You won't see the characters appear as you type — that's normal for password prompts. Once it runs, come back here."

Wait for them to confirm they've run it before continuing.

### 7c. Verify daemon is running

```bash
pm2 list
node dist/cli.js status --instance "${INSTANCE_ID}"
```

If daemon isn't running, check logs:
```bash
pm2 logs cortextos-daemon --lines 20
```

---

## Phase 8: Dashboard Setup

### 8a. Explain (verbatim)

> "Let's set up the web dashboard — real-time view of all your agents, tasks, approvals, costs, and analytics in the browser."

### 8b. Install and configure

```bash
cd dashboard
npm install
```

Write `dashboard/.env.local` (use the Write tool with full absolute paths — NOT `~`):
```
CTX_ROOT=<full path to CTX_ROOT>
CTX_FRAMEWORK_ROOT=<full path to repo root>
AUTH_SECRET=cortextos-<timestamp>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=cortextos
PORT=3000
```

Get full paths:
```bash
echo "CTX_ROOT: $(echo ${HOME}/.cortextos/${INSTANCE_ID})"
echo "Framework root: $(pwd)/.."
```

### 8c. Build and start

For local access:
```bash
npm run dev &
```

For persistent access (e.g., Cloudflare Tunnel):
```bash
npm run build
npm start &
```

Open in browser:
- macOS: `open http://localhost:3000`
- Linux: `xdg-open http://localhost:3000`
- Windows: `start http://localhost:3000`

Login: `admin` / `cortextos`

> "Tip: change the admin password in dashboard/.env.local after setup. Set ADMIN_PASSWORD=<yourpassword> and restart the dashboard."

Walk the user through the dashboard pages:

> "Here's a quick tour of what's in the dashboard:"
> - **Agents** — real-time health status for all your agents. Green = heartbeat received recently. Red = stale or crashed.
> - **Tasks** — every task across all agents. Create tasks, see who's working on what, track completions.
> - **Approvals** — pending approval requests from agents. Click to approve or reject. Agents are blocked until you decide.
> - **Analytics** — event timeline, cost tracking per agent, task throughput charts.
> - **Experiments** — autoresearch cycles and results. See what your Analyst is testing.
> - **Knowledge Base** — search your org's shared knowledge base (if enabled).
> - **Workflows** — view and edit each agent's cron schedule.
> - **Messages** — agent-to-agent and Telegram message history.
>
> "The Agents and Approvals pages will be your most-visited. Bookmark localhost:3000."

Go back to the repo root after:
```bash
cd ..
```

---

## Phase 8d: Dashboard Settings

Ask these two questions to set defaults for the whole system:

1. "How many minutes before an agent is considered stale? (default: 120 minutes — this controls the health indicator in the dashboard)"
2. "How many crashes in a day before an agent is automatically halted? (default: 10)"

Update `orgs/${ORG_NAME}/agents/${ORCH_NAME}/config.json` with any custom values:

```bash
ORCH_CONFIG="orgs/${ORG_NAME}/agents/${ORCH_NAME}/config.json"
# Update max_crashes_per_day if user changed it (default 10)
jq --argjson crashes <value> '.max_crashes_per_day = $crashes' "${ORCH_CONFIG}" > "${TMPDIR:-/tmp}/_cfg.json" && mv "${TMPDIR:-/tmp}/_cfg.json" "${ORCH_CONFIG}"
```

Note: staleness threshold is a dashboard display setting — write it to `dashboard/.env.local`:
```
STALE_THRESHOLD_MINUTES=<value>
```

---

## Phase 8e: Theta Wave (Autoresearch)

### What it is (verbatim)

> "Theta wave is cortextOS's autonomous experimentation system. Your Analyst agent continuously runs experiments — trying different approaches, measuring outcomes, proposing improvements — and reports results to your Orchestrator for approval before making changes. You can enable or disable it now; the Analyst will configure the details during its Telegram onboarding."

Ask: "Do you want to enable theta wave autoresearch? (yes/no — you can change this later)"

If yes:

Ask: "What should the Analyst focus experiments on? Suggestions: agent response quality, task throughput, briefing content, cron timing. You can say 'all of the above' or specify."

Write their answer to `orgs/${ORG_NAME}/agents/${ANALYST_NAME}/GOALS.md` stub (it will be rewritten during Telegram onboarding, but seed it with their intent):

```markdown
## Theta Wave Focus
<their answer>
```

Also ask: "How often should the Analyst run deep analysis cycles? (default: daily — options: 6h, 12h, 1d, 2d)"

Store as `THETA_INTERVAL`. Seed it into the Analyst's experiments config so it's available on first boot:

```bash
ANALYST_EXP_DIR="orgs/${ORG_NAME}/agents/${ANALYST_NAME}/experiments"
mkdir -p "${ANALYST_EXP_DIR}"
cat > "${ANALYST_EXP_DIR}/config.json" << EOF
{
  "approval_required": true,
  "theta_wave": {
    "enabled": true,
    "interval": "${THETA_INTERVAL}",
    "metric": "system_effectiveness",
    "metric_type": "qualitative_compound",
    "direction": "higher",
    "auto_create_agent_cycles": false,
    "auto_modify_agent_cycles": false
  },
  "cycles": []
}
EOF
```

If no: note it for the Orchestrator context so it can offer to enable it later. Also write a disabled config:

```bash
ANALYST_EXP_DIR="orgs/${ORG_NAME}/agents/${ANALYST_NAME}/experiments"
mkdir -p "${ANALYST_EXP_DIR}"
cat > "${ANALYST_EXP_DIR}/config.json" << EOF
{
  "approval_required": true,
  "theta_wave": { "enabled": false },
  "cycles": []
}
EOF
```

---

## Phase 8f: Semantic Knowledge Base

> "cortextOS includes a semantic knowledge base — a shared RAG database your agents can read and write to. Agents upload files from their workspace — documents, images, audio, video — and any agent can query it with natural language. You can also search it from the web dashboard. Think of it as long-term shared memory across your entire team."

> "It requires a Google Gemini API key for embeddings. It's free to get one and the usage is minimal."

Ask: "Do you want to set up the knowledge base now? You'll need a Gemini API key from https://aistudio.google.com/apikey (free tier works fine)."

If yes:

1. Get the API key from the user
2. Write it to the org's secrets.env:
   ```bash
   SECRETS_FILE="orgs/${ORG_NAME}/secrets.env"
   if [[ -f "$SECRETS_FILE" ]]; then
     grep -q GEMINI_API_KEY "$SECRETS_FILE" || echo "GEMINI_API_KEY=<key>" >> "$SECRETS_FILE"
   else
     echo "GEMINI_API_KEY=<key>" > "$SECRETS_FILE"
     chmod 600 "$SECRETS_FILE"
   fi
   ```

3. Run KB setup:
   ```bash
   CTX_ORG="${ORG_NAME}" CTX_INSTANCE_ID="${INSTANCE_ID}" CTX_FRAMEWORK_ROOT="$(pwd)" bash bus/kb-setup.sh --org "${ORG_NAME}" --instance "${INSTANCE_ID}"
   ```

4. Verify it worked — the setup script tests core imports and creates the ChromaDB directory.

5. Offer to ingest initial docs:
   > "The knowledge base is ready. Want to seed it with any files now? Drop a file path or URL — docs, PDFs, images, anything. You can always add more later, and your agents will ingest their own findings as they work."

   For each file:
   ```bash
   CTX_ORG="${ORG_NAME}" CTX_INSTANCE_ID="${INSTANCE_ID}" CTX_FRAMEWORK_ROOT="$(pwd)" GEMINI_API_KEY="<key>" bash bus/kb-ingest.sh "<path>" --org "${ORG_NAME}" --instance "${INSTANCE_ID}" --scope shared
   ```

If no:
> "No problem. You can set it up anytime later by adding a GEMINI_API_KEY to your org's secrets.env and running `bash bus/kb-setup.sh --org <org>`. Your agents know how to use it once it's configured."

---

---

## Phase 9: Wait for Orchestrator

### 9a. Monitor boot

The Orchestrator is now running inside the daemon. To watch it boot:
```bash
tail -f "${CTX_ROOT}/logs/${ORCH_NAME}/stdout.log"
```

> "The daemon auto-accepts the Claude Code directory trust prompt for you — no manual step needed. The agent will bootstrap itself in about 30-60 seconds."

If no activity after 2 minutes, diagnose:
```bash
pm2 logs cortextos-daemon --lines 30
cat "${CTX_ROOT}/logs/${ORCH_NAME}/activity.log" 2>/dev/null | tail -20
```

### 9b. First Telegram interaction (verbatim)

> "Your Orchestrator is bootstrapping. As soon as it's ready — about 30-60 seconds — it will message you on Telegram to start the interactive setup. As your first message, always type /onboarding"
>
> "Here's exactly what the Orchestrator will walk you through on Telegram:"
> 1. Its name, personality, and vibe
> 2. Your working hours (sets day/night mode behavior)
> 3. How autonomously it should operate
> 4. What agents are on the team and delegation rules
> 5. Its cron schedule — morning briefings, evening summaries, health checks
> 6. Any tools or services it needs access to (GitHub, Google, etc.)
> 7. Creating your Analyst agent (it will walk you through BotFather again for the Analyst's bot)
>
> "Once the Orchestrator finishes, it will spawn your Analyst.does its own onboarding — about 5-10 minutes. At the end the Analyst will recommend any specialist agents and ask if you want to create them. Each specialist takes 3-5 minutes to onboard."
>
> "Come back here if you hit any errors. Otherwise — you're done in Claude Code. Your Orchestrator has it from here."

**Wait** for them to confirm the Orchestrator has messaged them before closing the onboarding.

---

## Phase 10: Final Checklist

Run a final verification:

```bash
# Daemon running?
pm2 list | grep cortextos

# Orchestrator in enabled list?
cat "${CTX_ROOT}/config/enabled-agents.json"

# Heartbeat written?
cat "${CTX_ROOT}/state/${ORCH_NAME}/heartbeat.json" 2>/dev/null || echo "not yet"

# Dashboard up?
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
```

Deliver verbatim:

> "Here's what's now running:"
> - **Orchestrator** (`<orch_name>`) — live on Telegram, currently onboarding itself with you
> - **PM2 daemon** — manages agent process, auto-restarts on crash
> - **Web dashboard** — real-time monitoring at localhost:3000 (login: admin / cortextos)

> "Here's what was configured:"
> - Instance ID, org name, timezone, communication style (knobs 1-3)
> - Admin password, dashboard port, staleness threshold, max crashes/day (knobs 4-5, 24-25)
> - Orchestrator name, Telegram credentials, model, session settings, cron schedule (knobs 6-11, 19-22)
> - IDENTITY.md, GOALS.md, USER.md seed files (knobs 12, 14, 16)
> - Org goals.json and knowledge.md (knobs 17-18)
> - Approval policy defaults (knobs for external-comms, deployment, financial, data-deletion)
> - Knowledge base / Gemini API key (if enabled)
> - Theta wave focus and interval (if enabled)

> "Still to configure in Telegram with your Orchestrator:"
> - SOUL.md personality, HEARTBEAT.md monitoring config (knobs 13, 15)
> - Final cron times and custom crons (knobs 19-22 finalized)
> - Agent-specific API keys like Google, Notion, etc (knob 29)
> - Analyst agent: all of the above for the Analyst

> "Your Orchestrator will create the Analyst for you during its Telegram onboarding. You'll get a message from both agents when the full system is up."

> "Key commands to know:"
> - Check agent status: `cortextos status`
> - View agent logs: `tail -f ~/.cortextos/<instance>/logs/<agent>/stdout.log`
> - Send a message to an agent: `cortextos bus send-message <agent> normal 'your message'`
> - List all agents: `cortextos list-agents`
> - Create a task: `cortextos bus create-task "title" "description" <agent> normal`
> - List tasks: `cortextos bus list-tasks --agent <agent>`
> - Stop everything: `pm2 stop all`
> - Start everything: `pm2 start ecosystem.config.js`
> - Full CLI reference: `cortextos --help` and `cortextos bus --help`

> "A few more things to know about the system:"
> - **Event log:** Every agent action is logged. View in the dashboard Analytics tab or `cortextos bus log-event` to write your own.
> - **Experiments:** Your Analyst will propose improvement experiments over time. Approve or reject them in the dashboard Experiments tab.
> - **Worker agents:** For complex multi-step tasks, your agents can spawn ephemeral sub-agents. This is the m2c1-worker skill — ask your Orchestrator about it.
> - **Community catalog:** Your Analyst can browse and install community-contributed skills weekly. See the dashboard Skills tab once the Analyst is running.

> "You're all set. Go finish the onboarding with your Orchestrator on Telegram."

---

## Troubleshooting

**Agent not messaging on Telegram:**
1. Check stdout.log: `tail -50 ~/.cortextos/<instance>/logs/<agent>/stdout.log`
2. Check activity.log: `tail -20 ~/.cortextos/<instance>/logs/<agent>/activity.log`
3. Check .env has valid BOT_TOKEN and CHAT_ID
4. Check fast-checker.log: `tail -20 ~/.cortextos/<instance>/logs/<agent>/fast-checker.log`

**Daemon not starting:**
1. Check `pm2 logs cortextos-daemon --lines 30`
2. Verify dist/daemon.js exists: `ls dist/daemon.js`
3. Verify enabled-agents.json is valid JSON: `cat ~/.cortextos/<instance>/config/enabled-agents.json | jq .`

**Agent crashing immediately:**
1. Check stdout.log for errors
2. Verify Claude Code is authenticated: run `claude login` if needed
3. Check `cortextos doctor` for any failing checks

**Dashboard not loading:**
1. Check `dashboard/.env.local` has correct absolute paths (no `~`)
2. Verify port 3000 isn't in use: `lsof -i :3000`
3. Check dashboard npm logs
