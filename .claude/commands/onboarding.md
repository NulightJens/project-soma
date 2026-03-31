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
> - **Semantic Knowledge Base** *(coming soon)* — agents upload files from their workspace into a shared RAG database, searchable from the dashboard. Supports docs, images, audio, video — anything you want them to store as long-term shared memory.
> - **Native iPhone App** *(coming soon)* — dashboard + Telegram in one app with push notifications and full system control from your phone.
> - **Full codebase access** — agents can read and write your dashboard, core scripts, and the markdown files that define their own behavior. They can build custom dashboard pages for your business and eventually extend the iPhone app.

### 1b. The Two Core Agents

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

> "The setup flow: I'll help you configure the technical infrastructure here in Claude Code. Then your Orchestrator agent will come online in Telegram and walk you through content setup — name, personality, goals, workflows. The Orchestrator then creates your Analyst, which does its own Telegram onboarding. The Analyst recommends specialist agents, the Orchestrator creates them, and each specialist does its own Telegram onboarding. By the end, your full AI team is configured and running."

Ask: "Ready to get started? And — do you already have a Telegram bot token ready, or do we need to create one?"

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

Note the instance ID from the output (default: `default`). Ask: "Do you want to use the default instance name or something custom (e.g., 'home', 'work', 'mycompany')?"

**Note on environment variables:** `CTX_INSTANCE_ID`, `CTX_ROOT`, `CTX_ORG`, and `CTX_AGENT_NAME` are set automatically by the framework based on where commands are run from. You do not need to set these manually — they are referenced in the examples below for clarity.

Set variables for the rest of onboarding:
```bash
INSTANCE_ID="default"  # or their custom name
CTX_ROOT="${HOME}/.cortextos/${INSTANCE_ID}"
```

---

## Phase 4: Organization Setup

### 4a. Explain Organizations (verbatim)

> "cortextOS organizes your agents into Organizations. An Organization is a group of agents that work together toward shared goals — for your business, a side project, or any domain of your life. Each org has its own task queue, approval workflow, analytics, and shared context."

### 4b. Gather Organization context

Ask these questions one at a time. Follow up on interesting answers. Let the user elaborate.

1. "What do you want to call your Organization?" (lowercase, hyphens OK — e.g., `mycompany`, `life-ops`, `cointally`)

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
> "Let's set up your org's shared knowledge base. This is context that all your agents read on every boot. Tell me:"
> 1. "Your business or project — what does it do, key products/services, model?"
> 2. "Your team — key people and roles (human or AI)"
> 3. "Technical setup — repos, infrastructure, key services"
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

### 5c. Specialist Agent Planning

> "Beyond the Orchestrator and Analyst, you can add specialist agents — agents that focus on a specific domain of work. For example: a developer agent that writes code, a content agent that handles writing, a research agent that does web research, a data agent for analytics."

Ask: "What kind of specialist agents do you think you'll need? List 1-3 roles. (You can always add more later via Telegram.)"

For each role they mention:
- Note the name and domain
- Jot the primary responsibility in one sentence

Write their answers to `orgs/${ORG_NAME}/context.json` under a `planned_specialists` key so the Orchestrator has this context during Telegram onboarding:

```bash
jq --argjson specialists '[{"name":"<name>","role":"<role>","domain":"<domain>"}]' \
  '.planned_specialists = $specialists' "orgs/${ORG_NAME}/context.json" > "${TMPDIR:-/tmp}/_ctx.json" && mv "${TMPDIR:-/tmp}/_ctx.json" "orgs/${ORG_NAME}/context.json"
```

> "Your Orchestrator will create these specialist agents during its Telegram onboarding. Each one gets its own Telegram bot, personality, and cron schedule."

Store: `SPECIALIST_PLANS` list for reference.

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

After token paste:

7. "Now send any message to your new bot on Telegram (just 'hi' is fine). This lets me detect your chat ID."

Wait for confirmation, then auto-detect:

```bash
ORCH_BOT_TOKEN="<pasted token>"
for i in 1 2 3; do
    CHAT_INFO=$(curl -s "https://api.telegram.org/bot${ORCH_BOT_TOKEN}/getUpdates")
    ORCH_CHAT_ID=$(echo "$CHAT_INFO" | jq -r '.result[0].message.chat.id // empty')
    ORCH_USER_ID=$(echo "$CHAT_INFO" | jq -r '.result[0].message.from.id // empty')
    [[ -n "$ORCH_CHAT_ID" ]] && break
    sleep 3
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

### 6c. Bootstrap File Pre-population

Use the Write tool to write lightweight seed versions of these files. The Orchestrator's ONBOARDING.md will have the agent rewrite them with full content via Telegram — these are just the structural stubs the agent needs to reference.

**IDENTITY.md** — write based on org context and orchestrator name:
```markdown
# Orchestrator Identity

## Name
<orchestrator name>

## Role
Coordinator for <org name> — delegates, routes, monitors, briefs

## Vibe
<placeholder — agent will rewrite during onboarding>

## Work Style
- Decompose user directives into tasks for specialist agents
- Delegate via send-message.sh; monitor via heartbeats
- Route approvals; send briefings
- Never do specialist work — delegate everything
```

**GOALS.md** — pre-populate with org goals:
```markdown
# Current Goals

## Bottleneck
Getting agents operational

## Goals
1. <org goal 1>
2. <org goal 2>
3. <org goal 3>
- Complete onboarding and establish agent team

## Updated
<current ISO timestamp>
```

**USER.md** — gather from user before writing. Ask:

1. "What's your name?" (first name is fine)
2. "What's your role? (e.g., 'Founder of a startup', 'Independent developer', 'eCom operator')"
3. "What are your working hours? (e.g., '9am-11pm EST') — this sets when agents run in active day mode vs. quiet night mode"
4. "Anything specific you want your agents to know about how you like to work? (communication style, preferences, pet peeves)"

Write **USER.md** — non-sensitive context only (NO tokens, IDs, or credentials):
```markdown
# About the User

## Name
<their answer>

## Role
<their answer>

## Communication Style
<casual|professional|technical — from org setup>

## Working Hours
- Day mode: <their start time> - <their end time>
- Night mode: outside those hours
- Timezone: <IANA timezone from Phase 4>

## Preferences
<their answer about work style>
```

**Note:** Do NOT write sensitive data (Telegram IDs, bot tokens, API keys) to USER.md. It may be committed to git.

Store `DAY_START` and `DAY_END` variables for use in Phase 6c-iii autonomy setup.

Leave CLAUDE.md, SOUL.md, HEARTBEAT.md, and TOOLS.md as template defaults — the agent uses them as-is on first boot.

### 6c-ii. Autonomy Strength

Ask:

> "How autonomously should your agents operate? Choose a level:"
> 1. **Ask first** — agents ask your approval before most significant actions (safest, most oversight)
> 2. **Balanced** — agents act autonomously on routine work, ask only for high-stakes actions (external comms, deploys, financial, deletions)
> 3. **Autonomous** — agents operate independently and report results; only ask for truly irreversible actions

This determines how your agents interpret their SOUL.md autonomy rules. Write to `orgs/${ORG_NAME}/context.json` under an `autonomy_level` key (1, 2, or 3). Default is 2 (Balanced) if they skip.

```bash
jq --argjson level <1|2|3> '.autonomy_level = $level' "orgs/${ORG_NAME}/context.json" > "${TMPDIR:-/tmp}/_ctx.json" && mv "${TMPDIR:-/tmp}/_ctx.json" "orgs/${ORG_NAME}/context.json"
```

### 6c-iii. Cron Schedule

Ask these questions to pre-configure the Orchestrator's cron schedule. The agent will finalize these during Telegram onboarding, but seeding them here avoids a blank config.json on first boot.

1. "What time should your Orchestrator send you a morning briefing? (e.g., '8:00 AM' — we'll set a daily cron for this)"
2. "What time for an end-of-day summary? (e.g., '6:00 PM' — or skip if you don't want one)"
3. "How often should the Orchestrator send heartbeat health checks? (default: every 4 hours — options: 1h, 2h, 4h, 8h, 1d)"
4. "Any other recurring tasks you want the Orchestrator to run? (e.g., 'weekly goals review on Monday', 'content calendar check daily' — or skip)"

Convert their times to cron interval notation. Morning/evening reviews use `1d` interval (the agent handles time-of-day logic via its HEARTBEAT.md). Write to `orgs/${ORG_NAME}/agents/${ORCH_NAME}/config.json`:

```bash
ORCH_CONFIG="orgs/${ORG_NAME}/agents/${ORCH_NAME}/config.json"
jq '.crons = [
  {"name": "morning-review", "interval": "1d", "prompt": "Run morning review: check overnight tasks, summarize progress, send briefing to user."},
  {"name": "evening-review", "interval": "1d", "prompt": "Run evening review: summarize day, surface any blockers, send EOD summary to user."},
  {"name": "heartbeat", "interval": "4h", "prompt": "Read HEARTBEAT.md and follow its instructions."}
]' "${ORCH_CONFIG}" > "${TMPDIR:-/tmp}/_cfg.json" && mv "${TMPDIR:-/tmp}/_cfg.json" "${ORCH_CONFIG}"
```

Adjust intervals and add custom crons based on user answers. If user skipped evening review, omit it.

**Note on timing:** The 1d interval fires from when the agent first boots. The agent will use its internal time-of-day logic to align morning/evening reviews to the times you specified. It will confirm the exact schedule during Telegram onboarding.

Also set `max_session_seconds` if they gave a preference (default 255600 = ~71h, which is fine for most users):
```bash
jq '.max_session_seconds = 255600' "${ORCH_CONFIG}" > "${TMPDIR:-/tmp}/_cfg.json" && mv "${TMPDIR:-/tmp}/_cfg.json" "${ORCH_CONFIG}"
```

And the Claude model (ask: "Which Claude model should your Orchestrator use? Recommended: `claude-opus-4-6` for the Orchestrator, `claude-sonnet-4-6` for workers"):
```bash
jq --arg model "claude-opus-4-6" '.model = $model' "${ORCH_CONFIG}" > "${TMPDIR:-/tmp}/_cfg.json" && mv "${TMPDIR:-/tmp}/_cfg.json" "${ORCH_CONFIG}"
```

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

The `pm2 startup` output will include a command to run (starts with `sudo env PATH=...`). Tell the user:

> "PM2 printed a startup command above — run it in your terminal to make the system survive reboots. You only need to do this once."

Wait for them to confirm they've run it.

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

## Phase 8f: Knowledge Base (RAG)

### What it is (verbatim)

> "cortextOS has an optional semantic memory layer. Agents can query a ChromaDB knowledge base using natural language — great for large doc sets, research notes, or any content too big to fit in a prompt. It requires a Gemini API key for embeddings."

Ask: "Do you want to set up the knowledge base? It requires a Google Gemini API key. (yes/no — can be added later)"

If yes:

1. "Paste your Gemini API key (starts with `AIza...`):"

Write to `orgs/${ORG_NAME}/secrets.env`:
```bash
cat > "orgs/${ORG_NAME}/secrets.env" << EOF
GEMINI_API_KEY=<their key>
EOF
chmod 600 "orgs/${ORG_NAME}/secrets.env"
```

2. Verify knowledge base directory structure:
```bash
node dist/cli.js bus kb-collections --org "${ORG_NAME}" 2>/dev/null && echo "KB ready" || echo "KB will initialize on first ingest"
```

The knowledge base initializes automatically on first use — no separate setup needed. Confirm:
> "Knowledge base is ready. Your agents can use `cortextos bus kb-ingest <path>` to add documents and `cortextos bus kb-query '<question>'` to search them."

If no: skip. Note that `GEMINI_API_KEY` can be added to `orgs/${ORG_NAME}/secrets.env` at any time to enable the knowledge base — agents will pick it up on next restart.

---

## Phase 8g: Approval Behavior

### What it is (verbatim)

> "Agents request your approval before taking high-stakes actions — sending emails, deploying code, making financial moves, deleting data. You decide via the dashboard or by replying to the agent on Telegram. Let's configure when approvals are required."

Ask these questions:

1. "Should agents require approval before sending external communications? (emails, social posts, messages to people outside the system) — yes/no"
2. "Should agents require approval before any deployment actions? (pushing code, running migrations, modifying infrastructure) — yes/no"
3. "Should agents require approval before financial actions? (purchases, subscriptions, API costs above a threshold) — yes/no"
4. "If yes to financial: what's the per-action cost threshold that triggers approval? (e.g., $5, $50, $100)"
5. "Should agents require approval before data deletion? — yes/no (strongly recommended: yes)"

Write the answers to `orgs/${ORG_NAME}/context.json` under an `approval_policy` key:
```json
{
  "approval_policy": {
    "external_comms": true,
    "deployment": true,
    "financial": true,
    "financial_threshold_usd": 10,
    "data_deletion": true
  }
}
```

Tell the user:
> "These are defaults for your Orchestrator. It will enforce them when briefing you on pending approvals. You can adjust per-agent behavior in each agent's CLAUDE.md during Telegram onboarding."

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

> "Your Orchestrator is bootstrapping. As soon as it's ready — about 30-60 seconds — it will message you on Telegram to start the interactive setup."
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
> "Once the Orchestrator finishes, your Analyst comes online and does its own onboarding — about 5-10 minutes. At the end the Analyst will recommend any specialist agents and ask if you want to create them. Each specialist takes 3-5 minutes to onboard."
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
