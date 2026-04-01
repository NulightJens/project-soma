---
name: cron-management
description: "The user wants something to happen on a recurring schedule, or you just restarted and need to verify your crons are still running. You need to create a new scheduled task, restore crons that were lost on restart, add or remove a cron from config.json so it persists across sessions, or troubleshoot why a scheduled workflow stopped firing. Crons die on restart — this skill is how you ensure scheduled work survives."
triggers: ["remind me", "every day", "every hour", "every week", "schedule", "recurring", "daily", "weekly", "cron", "loop", "check regularly", "monitor", "keep an eye on", "set up a reminder", "repeat every", "run every", "automate", "schedule task", "restore crons", "crons missing", "cron not firing", "session start crons", "recreate crons", "persist cron", "add to config.json"]
---

# Cron Management

Your scheduled tasks are defined in `config.json` under the `crons` array. This skill explains how to manage them.

## On Session Start

Check if your crons are active. If not, recreate them:

1. Read `config.json` to get your cron definitions
2. For each entry in the `crons` array, create a loop: `/loop {interval} {prompt}`
3. Verify all crons are running

## Default Crons

No crons are defined by default. Users can add any recurring tasks they need to `config.json`.

## Adding a New Cron

1. Create the `/loop` for immediate use: `/loop {interval} {prompt}`
2. **Persist it** - Add the cron to `config.json` so it survives restarts:
   ```json
   {"name": "descriptive-name", "interval": "5m", "prompt": "What to do each cycle"}
   ```
3. Confirm to the user that the cron is active and persisted

## Removing a Cron

1. Cancel the active `/loop`
2. Remove the entry from `config.json`

## Cron Expiry

Built-in `/loop` crons expire after 3 days. Since your session restarts via launchd, this isn't an issue - crons are recreated from `config.json` on each fresh start.

## Troubleshooting

- If a cron isn't firing, check if it was created this session
- If crons are missing after a restart, re-read `config.json` and recreate them
