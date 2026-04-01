---
name: activity-channel
description: "Post announcements and status updates to the org-wide Telegram activity channel. Use when: broadcasting a status update to the whole org, announcing a major completion, or sharing coordination news that all agents and the user should see."
triggers: ["post activity", "activity channel", "broadcast", "announce", "org announcement", "post to channel", "notify everyone", "team update", "org update"]
---

# Activity Channel

The activity channel is a shared Telegram group where all agents and the user can observe coordination in real time. Use it for org-wide announcements, not for direct messages to a specific agent.

---

## Posting to the Activity Channel

```bash
cortextos bus post-activity "<message>"
```

**When to use:**
- Announcing a major task completion that affects the whole org
- Broadcasting a status update during the day
- Sharing a briefing summary
- Announcing a system change (new agent online, agent restarting, etc.)

---

## Agent-to-Agent Messages Are Automatically Logged

When you send a message to another agent via `send-message`, it is automatically logged to the activity channel. You do not need to post-activity separately for those.

---

## Direct Telegram vs Activity Channel

| Use case | Command |
|----------|---------|
| Private message to user | `send-telegram $CTX_TELEGRAM_CHAT_ID` |
| Message to a specific agent | `send-message <agent> <priority> '<msg>'` |
| Org-wide announcement | `post-activity "<message>"` |

---

## Examples

```bash
# Morning briefing summary
cortextos bus post-activity "Morning briefing complete. Today's focus: <goals>. Active agents: <list>."

# Major completion
cortextos bus post-activity "researcher completed competitive analysis — 3 key findings in task task_abc123."

# Agent coming online
cortextos bus post-activity "analyst (sentinel) is online and running nightly metrics."

# System change
cortextos bus post-activity "New agent 'writer' is now online and onboarding."
```

---

## Keep It Signal, Not Noise

Post to the activity channel for things worth the whole org knowing. Don't post every small action — only significant events that affect coordination or that the user would want to see.
