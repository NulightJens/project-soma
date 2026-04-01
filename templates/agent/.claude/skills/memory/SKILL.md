---
name: memory
description: "You are starting a new session and need to record your online status and check for in-progress work. Or you are about to start a task and need to write a WORKING ON entry so that if you crash mid-task, the next session knows what to resume. Or you just completed something and need to record it. Or you have learned something that should survive across all future sessions and needs to go in MEMORY.md. Memory is how you maintain continuity — without it, every restart starts from zero."
triggers: ["memory", "remember", "write memory", "update memory", "session memory", "what was I working on", "resume", "working on", "memory file", "daily memory", "long-term memory", "memory protocol", "session start", "record progress", "note this", "save for later", "persist learning", "write to memory", "check memory", "read memory", "what did I do yesterday"]
---

# Memory

You have two memory layers. Both are mandatory. Without memory, session crashes lose all context and you start from zero.

---

## Layer 1: Daily Memory (memory/YYYY-MM-DD.md)

Session-scoped notes. Written throughout the day. Survives crashes via filesystem.

**Location:** `memory/$(date -u +%Y-%m-%d).md` in your agent workspace

### On session start
```bash
TODAY=$(date -u +%Y-%m-%d)
mkdir -p memory
cat >> "memory/$TODAY.md" << MEMEOF

## Session Start - $(date -u +%H:%M:%S)
- Status: online
- Inbox: <N messages or "empty">
- Resuming: <task_id and description, or "nothing - awaiting instructions">
MEMEOF
```

### Before starting any task
```bash
echo "WORKING ON: $TASK_ID - <description>" >> "memory/$TODAY.md"
```

### After completing a task
```bash
echo "COMPLETED: $TASK_ID - <summary of what was produced>" >> "memory/$TODAY.md"
```

### On heartbeat
```bash
cat >> "memory/$TODAY.md" << MEMEOF

## Heartbeat - $(date -u +%H:%M:%S)
- Tasks completed: N
- Current task: <task_id or none>
MEMEOF
```

### Checking for in-progress work (on resume)
```bash
cat "memory/$(date -u +%Y-%m-%d).md" 2>/dev/null | grep "WORKING ON:"
```

---

## Layer 2: Long-Term Memory (MEMORY.md)

Persistent learnings that survive across all sessions. Updated when you learn something worth keeping.

**Location:** `MEMORY.md` in your agent workspace

### When to update
- Patterns that work or don't work
- User preferences discovered
- System behaviors noted
- Important decisions and their reasons
- Anything you'd want to know on the next fresh session

### Format
```markdown
## [Topic] — YYYY-MM-DD
<what you learned>
```

---

## Reading Today's Memory

```bash
cat "memory/$(date -u +%Y-%m-%d).md" 2>/dev/null || echo "No memory for today yet"
```

---

## Target

- Minimum 3 memory entries per session (session start, at least 1 task, session end or heartbeat)
- Every WORKING ON must have a corresponding COMPLETED
- Update MEMORY.md at least once per week with durable learnings
