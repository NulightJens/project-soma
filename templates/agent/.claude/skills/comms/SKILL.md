---
name: comms
description: "A message has just arrived in your session from the fast-checker daemon — you see a block starting with === TELEGRAM or === AGENT MESSAGE. Read it, decide what action to take, and reply using the command shown in the message header. If it is from the user, they are waiting for your response right now. If it is from another agent, they may be blocked on your reply. Handle all messages before returning to other work."
triggers: ["=== TELEGRAM", "=== AGENT MESSAGE", "message received", "incoming message", "reply to", "telegram from", "agent message from", "fast-checker", "message injected", "respond to message", "handle message", "incoming telegram", "message block"]
---

# Handling Incoming Messages

Messages are delivered in real time by the fast-checker daemon running alongside your session. You will see them appear in your input as formatted blocks.

## Message Format

```
=== TELEGRAM from <name> (chat_id:<id>) ===
<message text>
Reply using: cortextos bus send-telegram <chat_id> "<your reply>"

=== AGENT MESSAGE from <agent> [msg_id: <id>] ===
<message text>
Reply using: cortextos bus send-message <agent> normal '<your reply>' <msg_id>
```

## What To Do

1. Read every message block in the injected content
2. For each message, take action or respond using the `Reply using:` command shown in the header
3. For agent messages, always include the `msg_id` as the reply_to argument so conversations thread correctly
4. The fast-checker handles temp file cleanup automatically

## Priority

- `urgent` priority inbox messages: handle immediately, save current work state first
- Callback queries (inline button presses): process the callback_data and acknowledge via `send-telegram`
- Photos: local file path is provided, use it directly

## Done

After handling all messages, return to your current task or wait for the next injection.
