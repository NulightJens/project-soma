---
name: worker-agents
description: "You have a task that would benefit from running in a separate isolated Claude Code session — either because it is long-running and you do not want it to consume your context window, or because you want multiple pieces of work happening in parallel at the same time. You will spawn one or more ephemeral worker sessions in tmux, give each a focused task, monitor their progress, and collect their outputs when done."
triggers: ["worker", "parallelize", "spawn worker", "spin up", "parallel work", "background task", "isolated session", "separate session", "long running task", "run in background", "parallel research", "multiple workers", "worker session", "spawn session", "tmux worker", "context window", "parallel tasks", "run simultaneously"]
---

# Worker Agents

> Spawn ephemeral Claude Code sessions in tmux for parallelized long-running tasks. Workers get a scoped task, produce deliverables, and are cleaned up when done.

---

## When to Use

**Good fit:**
- Independent work that does not touch files another agent is editing
- Research or design docs in a new directory
- Scaffolding a new feature in isolation
- Any task > 5 minutes that can run while you do other work

**Bad fit:**
- Editing files another agent or worker is actively touching (merge conflicts)
- Tasks needing real-time back-and-forth (just do it yourself)
- Very short tasks < 2 minutes (overhead not worth it)

---

## How Workers Differ from Persistent Agents

| | Persistent Agent | Worker Agent |
|---|---|---|
| Lifetime | 24/7, survives restarts | Dies when task is done |
| Identity | IDENTITY.md, SOUL.md, GOALS.md | None - just a task prompt |
| Heartbeat | Updates every 4h | None |
| Crons | config.json scheduled tasks | None |
| Inbox | Bus messages via check-inbox.sh | Bus messages (optional) |
| Telegram | Yes | No |
| Memory | Daily journals, MEMORY.md | None |
| Dashboard | Full agent card | Not shown (future: ephemeral entry) |

---

## Spawning a Worker

### Step 1: Scope the Work

Before spawning, answer:
1. What specific deliverables should the worker produce?
2. Which files/directories will it create or modify?
3. Does this overlap with any active agent or worker? **If yes, do NOT parallelize.**
4. What context does the worker need?

### Step 2: Set Up Permission Bypass (MANDATORY)

Workers must NEVER hit permission prompts. Set this up BEFORE spawning:

```bash
WORK_DIR="<path to working directory>"
mkdir -p "$WORK_DIR/.claude"

# Create a PermissionRequest hook that auto-approves everything
mkdir -p "$WORK_DIR/.claude/hooks"
cat > "$WORK_DIR/.claude/hooks/auto-approve.sh" << 'HOOKEOF'
#!/usr/bin/env bash
# Auto-approve all permissions for worker agents (no Telegram, fully autonomous)
echo '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}'
HOOKEOF
chmod +x "$WORK_DIR/.claude/hooks/auto-approve.sh"

# Create settings.json with permission bypass
cat > "$WORK_DIR/.claude/settings.json" << 'SETTINGSEOF'
{
  "permissions": {
    "allow": ["Edit", "Write", "Bash", "Read", "Glob", "Grep"],
    "allowedPaths": [".claude/"]
  },
  "hooks": {
    "PermissionRequest": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/auto-approve.sh",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
SETTINGSEOF
```

### Step 3: Create the tmux Session

```bash
WORKER_NAME="worker-<descriptive-slug>"

tmux new-session -d -s "$WORKER_NAME" bash
tmux send-keys -t "$WORKER_NAME" "cd $WORK_DIR" Enter
tmux send-keys -t "$WORKER_NAME" "claude --dangerously-skip-permissions" Enter

# Wait for Claude to boot
sleep 10
```

### Step 3: Set Up Communication (Optional)

If the worker needs to message you via the bus:

```bash
# Create worker inbox
mkdir -p "$CTX_ROOT/inbox/$WORKER_NAME"
mkdir -p "$CTX_ROOT/state/$WORKER_NAME"

# Copy comms skill so the worker knows how to use the bus
mkdir -p "$WORK_DIR/.claude/skills/comms"
cp "$CTX_FRAMEWORK_ROOT/templates/agent/skills/comms/SKILL.md" "$WORK_DIR/.claude/skills/comms/SKILL.md" 2>/dev/null
```

### Step 4: Inject the Task

Write a clear, scoped prompt and inject it:

```bash
PROMPT="You are a worker agent. Your task is: <SPECIFIC TASK>

CONTEXT:
- <What the system is and relevant architecture>
- <Reference files to read>

YOUR SCOPE:
1. <Specific deliverable 1>
2. <Specific deliverable 2>

RULES:
- Do NOT modify <files being touched by other agents>
- Create files only in: <specific directories>
- Commit to git after each meaningful change

COMMUNICATION (optional):
export CTX_AGENT_NAME='$WORKER_NAME'
export CTX_FRAMEWORK_ROOT='$CTX_FRAMEWORK_ROOT'
export CTX_ROOT='$CTX_ROOT'
cortextos bus send-message <your-agent-name> normal '<message>'

When done, send me a summary of what you built."

tmux send-keys -t "$WORKER_NAME" "$PROMPT" Enter
```

### Step 5: Log the Spawn

```bash
cortextos bus log-event action worker_spawned info \
  '{"worker":"'$WORKER_NAME'","parent":"'$CTX_AGENT_NAME'","task":"<title>"}'
```

---

## Monitoring

### Passive (no interruption)

```bash
# See what the worker is doing
tmux capture-pane -t "$WORKER_NAME" -p | tail -20

# Check git progress
cd $WORK_DIR && git log --oneline | head -5

# Check if it sent you bus messages
cortextos bus check-inbox
```

### Active (when stuck)

```bash
# If stuck at a prompt or permission dialog
tmux send-keys -t "$WORKER_NAME" Escape Enter

# If frozen, nudge it
tmux send-keys -t "$WORKER_NAME" "Continue with your task. What is your current status?" Enter

# If stuck at AskUserQuestion TUI
tmux send-keys -t "$WORKER_NAME" Down Enter
```

---

## Cleanup

### When Worker Finishes

```bash
# Log completion
cortextos bus log-event action worker_completed info \
  '{"worker":"'$WORKER_NAME'","deliverables":"<summary>"}'

# Kill the session
tmux kill-session -t "$WORKER_NAME" 2>/dev/null

# Clean up inbox (if created)
rm -rf "$CTX_ROOT/inbox/$WORKER_NAME"
rm -rf "$CTX_ROOT/state/$WORKER_NAME"
```

### If Worker Fails

```bash
# Check what went wrong
tmux capture-pane -t "$WORKER_NAME" -p | tail -30

# Options:
# 1. Fix and continue: inject fix via send-keys
# 2. Kill and retry: kill-session, spawn new worker with better prompt
# 3. Abandon: kill-session, do the work yourself

cortextos bus log-event action worker_failed info \
  '{"worker":"'$WORKER_NAME'","reason":"<what went wrong>"}'
```

---

## Scaling Rules

| Workers | Risk | Notes |
|---------|------|-------|
| 1-2 | Low | Safe for most tasks |
| 3-4 | Medium | Ensure zero file overlap |
| 5+ | High | Resource contention, monitor closely |

**Hard rules:**
- NEVER spawn workers for overlapping file sets
- NEVER let workers modify files you or other agents are editing
- ALWAYS log spawns and completions
- Workers should NOT spawn their own workers (no worker-ception)

---

## Quick Reference

```bash
# Spawn
tmux new-session -d -s worker-foo bash
tmux send-keys -t worker-foo "cd /path && claude --dangerously-skip-permissions" Enter
sleep 10
tmux send-keys -t worker-foo "<task prompt>" Enter

# Monitor
tmux capture-pane -t worker-foo -p | tail -20

# Unstick
tmux send-keys -t worker-foo Escape Enter

# Kill
tmux kill-session -t worker-foo
```
