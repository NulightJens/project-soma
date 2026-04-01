---
name: heartbeat
description: "Update your heartbeat and check fleet health. Use when: executing your heartbeat cron, checking if other agents are alive, monitoring agent health, or diagnosing why an agent appears offline."
triggers: ["heartbeat", "update heartbeat", "check health", "agent health", "fleet health", "agent status", "is agent alive", "agent offline", "agent stale", "read heartbeats"]
---

# Heartbeat

The heartbeat is how the dashboard and other agents know you are alive. If you stop updating it, you appear DEAD.

---

## Your Heartbeat Cron

Your `config.json` has a heartbeat cron (default every 4h). When it fires:

```bash
# 1. Update your heartbeat with what you're doing
cortextos bus update-heartbeat "WORKING ON: <current task summary>"

# 2. Check inbox for messages
cortextos bus check-inbox

# 3. Log heartbeat event
cortextos bus log-event heartbeat agent_heartbeat info \
  --meta "{\"agent\":\"$CTX_AGENT_NAME\",\"status\":\"active\"}"

# 4. Check your task queue for anything stale
cortextos bus list-tasks --agent $CTX_AGENT_NAME --status in_progress
```

---

## Updating Heartbeat

```bash
cortextos bus update-heartbeat "<one sentence: what you are doing right now>"
```

Call this:
- On every heartbeat cron fire
- On session start (before sending online notification)
- When starting a new significant task
- Before going into a long-running operation

**Never claim a status you haven't verified.** If your crons were reset on restart, check CronList before saying "crons running."

---

## Reading Fleet Heartbeats

```bash
# All agents in the org
cortextos bus read-all-heartbeats

# JSON format for parsing
cortextos bus read-all-heartbeats --format json
```

Returns: agent name, status, last update timestamp, current task.

**Stale threshold:** An agent that hasn't updated in >6h should be investigated. Check their tmux session.

---

## Checking a Specific Agent

```bash
# Read their heartbeat file directly
cat "$CTX_ROOT/state/<agent-name>/heartbeat.json"

# Check if their tmux session is alive
tmux has-session -t "ctx-${CTX_INSTANCE_ID}-${CTX_ORG}-<agent-name>" 2>/dev/null \
  && echo "SESSION ALIVE" || echo "SESSION DEAD"
```

---

## Heartbeat File Schema

```json
{
  "agent": "agent-name",
  "status": "active | idle | crashed",
  "timestamp": "2026-04-01T12:00:00Z",
  "current_task": "What I'm doing right now"
}
```

Location: `$CTX_ROOT/state/{agent}/heartbeat.json`
