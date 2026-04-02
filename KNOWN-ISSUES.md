# cortextOS — Known Issues & Installation Blockers

Last updated: 2026-04-02  
Covers: Node.js v0.1.1 (grandamenium/cortextos, `main` branch)

---

## 1. Critical Blockers (prevents install/launch entirely)

### 1.1 Install URL is dead and repo is private

**What breaks:** The primary install method documented in README.md fails completely.

```bash
curl -fsSL https://get.cortextos.dev/install.mjs | node   # HTTP 000 — domain does not resolve
```

- `https://get.cortextos.dev` does not exist. curl returns `000` (no response).
- The GitHub repo `grandamenium/cortextos` is **private**. New users cloning via the REPO_URL in `install.mjs` will receive a 403 unless they have been granted access.
- There is no npm package published (the `package.json` has `"license": "UNLICENSED"` and `files` is limited to `dist/` and `templates/`; no npm publish workflow exists).

**Impact:** A brand-new user following the README cannot install cortextOS at all without out-of-band repo access.

**File references:** `install.mjs:15`, `README.md:63`, `package.json`

---

### 1.2 CTX_FRAMEWORK_ROOT not set — daemon refuses to start

**What breaks:** The daemon (`node dist/daemon.js` or `pm2 start ecosystem.config.js`) hard-exits with `[daemon] CTX_FRAMEWORK_ROOT not set` if the env var is missing.

`src/daemon/index.ts:27–31` checks `process.env.CTX_FRAMEWORK_ROOT` and calls `process.exit(1)` if it is empty.

**When it happens:** Any time the ecosystem config is generated without the correct cwd, or when PM2 restarts the daemon after the env is lost.

`cortextos ecosystem` correctly writes `CTX_FRAMEWORK_ROOT` into `ecosystem.config.js` — but only if run from the project root. Running it from a different directory silently writes the wrong path.

**File references:** `src/daemon/index.ts:27–31`, `src/cli/ecosystem.ts:57`

---

### 1.3 Claude Code CLI must be pre-authenticated (`claude login`) before any agent starts

**What breaks:** Agents fail to start if Claude Code is not already authenticated. The daemon spawns a PTY and runs `claude --dangerously-skip-permissions '<prompt>'`. If the user has never run `claude login`, Claude Code will interactively prompt for login, which the PTY cannot handle automatically (no stdin).

**Current mitigation:** `install.mjs` and `cortextos doctor` check `claude --version` and warn, but neither enforces `claude login` completion. There is no automated pre-flight that detects unauthenticated sessions before the daemon tries to spawn.

**File references:** `install.mjs:89–93`, `src/cli/doctor.ts:92–103`, `src/pty/agent-pty.ts:178–190`

---

### 1.4 node-pty requires native compilation — fails without build tools

**What breaks:** `node-pty@^1.1.0` is a native Node.js addon. It must be compiled from C++ source during `npm install`. If build tools are absent, `npm install` fails and the entire daemon cannot start.

- **macOS:** requires Xcode Command Line Tools (`xcode-select --install`)
- **Linux:** requires `build-essential` (`apt install build-essential`)
- **Windows:** requires Visual C++ Build Tools (`npm install -g windows-build-tools`)

`cortextos doctor` checks and reports this (`src/cli/doctor.ts:66–82`), but the install script (`install.mjs`) does not check for build tools before running `npm install` — users see a raw npm compilation error with no cortextOS-level explanation.

**File references:** `src/cli/doctor.ts:66–82`, `package.json:40`

---

### 1.5 Dashboard requires AUTH_SECRET env var — hard-exits without it

**What breaks:** `cortextos dashboard` refuses to start if `AUTH_SECRET` is not set in the shell environment:

```
ERROR: AUTH_SECRET is not set.
Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
Then add it to your shell profile or .env file.
```

This env var is not mentioned in the README quick-start flow, the manual setup instructions, or the `cortextos init` output. New users hit this immediately when trying to start the dashboard.

**File references:** `src/cli/dashboard.ts:35–44`

---

### 1.6 Agent enable fails with no .env / missing BOT_TOKEN

**What breaks:** `cortextos enable <agent>` hard-exits if the agent's `.env` is missing or lacks `BOT_TOKEN` and `CHAT_ID`:

```
Error: .env for agent "boss" is missing required values: BOT_TOKEN, CHAT_ID
```

This is intentional (the "Becky bug" fix, issue #188), but the flow for getting a Telegram bot token and chat ID is non-trivial for new users. The error message is clear, but the instructions for actually creating a bot and retrieving the chat ID are only in comments inside the generated `.env` file — not in any terminal output the user sees.

**File references:** `src/cli/enable-agent.ts:50–79`

---

### 1.7 `cortextos start` does not actually start the daemon

**What breaks:** Running `cortextos start` when the daemon is not running does not launch it. The command prints instructions to use `pm2 start ecosystem.config.js` and exits. There is no direct-start path without PM2.

A user who skips PM2 (or has not installed it yet) has no way to run the daemon from the CLI — `cortextos start` is effectively a no-op without the daemon already running.

**File references:** `src/cli/start.ts:12–32`

---

### 1.8 Dashboard SQLite DB path is hardcoded — shared across instances

**What breaks:** The dashboard writes all data to `dashboard/.data/cortextos.db` relative to `process.cwd()`. If two cortextOS instances share the same codebase directory (e.g., default and e2e-test), they write to and read from the same database, causing data corruption and cross-instance bleed.

Also, `CTX_ROOT` is not passed into the dashboard process — the dashboard has to guess state paths. If `CTX_INSTANCE_ID` is not `default`, the dashboard reads the wrong agent data.

**Tracking:** GitHub issue #2 (open)

**File references:** `dashboard/src/` (db init code), `src/cli/dashboard.ts`

---

## 2. Platform Restrictions (macOS-only features)

### 2.1 `cortextos tunnel` is macOS-only (hard exit on other platforms)

The entire `tunnel` command family (`start`, `stop`, `status`) calls `checkPlatform()` which does `process.exit(1)` on non-Darwin platforms:

```
cortextos tunnel requires macOS (uses launchd for persistence).
On Linux/Windows, run cloudflared manually: cloudflared tunnel run cortextos
```

No equivalent persistent tunnel mechanism is provided for Linux or Windows. The guidance to "run cloudflared manually" is not sufficient for production use — there is no startup script, systemd unit, or Windows service definition.

**File references:** `src/cli/tunnel.ts:40–44`, `src/cli/tunnel.ts:9` (PLIST_PATH uses `~/Library/LaunchAgents`)

---

### 2.2 `cortextos doctor` tunnel checks are macOS-only

Doctor only checks cloudflared installation, Cloudflare auth, tunnel existence, and launchd service status when `process.platform === 'darwin'`. Linux and Windows users get no tunnel health information.

**File references:** `src/cli/doctor.ts:108–170`

---

### 2.3 ~~`generate-launchd.sh` script is macOS-only~~ — RESOLVED

`scripts/generate-launchd.sh`, `enable-agent.sh`, `disable-agent.sh`, and `scripts/agent-wrapper.sh` have been deleted. These were bash-era, launchd-based process management scripts with no Linux/Windows equivalent. The Node.js daemon uses PM2 (`cortextos ecosystem` + `pm2 start`) for cross-platform process management. Use `cortextos start <agent>` and `cortextos stop <agent>` for agent lifecycle management.

---

### 2.4 `scripts/generate-launchd.sh` cloudflared install assumes Homebrew

The tunnel install fix for cloudflared suggests `brew install cloudflared` throughout the codebase. There are hardcoded Homebrew binary path candidates:

```typescript
'/opt/homebrew/bin/cloudflared', // Apple Silicon
'/usr/local/bin/cloudflared',    // Intel Mac
```

These paths are explicitly searched before falling back to PATH. On Linux or Windows these hardcoded Homebrew paths are irrelevant.

**File references:** `src/cli/tunnel.ts:68–78`

---

### 2.5 Shell bus scripts assume bash on macOS/Linux — no Windows support

All 30+ scripts in `bus/` use `#!/usr/bin/env bash` with bash-specific syntax (`set -euo pipefail`, `[[ ]]`, `$()`, heredocs, process substitution). These scripts cannot run on Windows without WSL.

The Node.js `cortextos bus` CLI (in `src/cli/bus.ts`) reimplements most bus operations as cross-platform TypeScript — but the bus shell scripts are still the primary interface for agents running inside PTY sessions (agents call `bash $CTX_FRAMEWORK_ROOT/bus/send-message.sh`, etc.). Agents on Windows would need WSL.

**File references:** All files in `bus/`

---

## 3. Windows-Specific Gaps

### 3.1 No Windows process persistence mechanism

PM2 (`pm2 startup`) generates startup scripts for macOS (launchd) and Linux (systemd), but the Windows equivalent (`pm2-startup` for Task Scheduler or NSSM) is not documented or configured. After a Windows reboot, the daemon will not auto-restart.

---

### 3.2 PTY uses `cmd.exe` on Windows — Claude Code behavior is untested

`agent-pty.ts` falls back to `process.env.COMSPEC || 'cmd.exe'` as the shell on Windows. Claude Code's `--dangerously-skip-permissions` flag and the PTY injection pattern (`write(cmd + '\r')`) have not been verified to work correctly in cmd.exe. The trust prompt auto-accept logic looks for the string "trust" or "Yes" in PTY output, which may differ on Windows.

**File references:** `src/pty/agent-pty.ts:279–282`

---

### 3.3 IPC uses Unix domain sockets on macOS/Linux, named pipe on Windows

The IPC path correctly switches between socket and named pipe:

```typescript
if (process.platform === 'win32') {
  return `\\\\.\\pipe\\cortextos-${instanceId}`;
}
return join(homedir(), '.cortextos', instanceId, 'daemon.sock');
```

However, the named pipe path on Windows has not been tested end-to-end. The `IPCServer.start()` cleanup path for stale sockets also skips Windows (`if (process.platform !== 'win32')`), meaning stale sockets on Windows are never cleaned up.

**File references:** `src/utils/paths.ts:50–56`, `src/daemon/ipc-server.ts:27`, `src/daemon/ipc-server.ts:76`

---

### 3.4 `which` command not available on Windows

`install.mjs` uses `which` to check for installed commands on Unix and `where` on Windows:

```javascript
const which = IS_WINDOWS ? 'where' : 'which';
```

This is handled. However, `src/cli/tunnel.ts` calls `execSync('which cloudflared')` and `execSync('which node')` without platform guard — these would fail on Windows.

**File references:** `src/cli/tunnel.ts:77`, `src/cli/tunnel.ts:85`

---

### 3.5 Bus shell scripts cannot run on Windows without WSL

As noted in section 2.5, agents running inside a PTY on Windows would invoke `bash bus/send-message.sh` etc., which requires bash. This is untested and will fail without WSL.

---

## 4. Missing Prerequisites

### 4.1 git — required by install.mjs but not checked

`install.mjs` runs `git clone` and `git pull` without first verifying git is installed. If git is absent, users see a raw shell error rather than a helpful message.

**File references:** `install.mjs:100–116`

---

### 4.2 jq — required by most bus shell scripts, listed as optional in install

`cortextos install` marks `jq` as `required: false` (just a warning if missing). However, virtually every bus script (`_ctx-env.sh`, `read-all-heartbeats.sh`, `hook-permission-telegram.sh`, `update-heartbeat.sh`, `check-upstream.sh`, etc.) uses `jq` for JSON parsing. Without `jq`, all agent-to-agent messaging, task management, and heartbeat updates fail silently or with raw JSON parse errors.

**File references:** `src/cli/install.ts:27`, `bus/_ctx-env.sh:62–67`, `bus/hook-permission-telegram.sh:31–130`

---

### 4.3 python3 — required for knowledge base features but not checked at install

`bus/kb-setup.sh`, `bus/kb-ingest.sh`, `bus/kb-query.sh`, and `bus/sync-org-config.sh` all require Python 3. `kb-setup.sh` creates a venv and installs `chromadb`, `google-genai`, `python-docx`, `python-pptx`, and `openpyxl`. `sync-org-config.sh` requires python3 for inline JSON manipulation.

None of the install scripts check for python3. Users who hit knowledge base features without Python installed get bash errors.

**File references:** `bus/kb-setup.sh`, `bus/sync-org-config.sh:10–12`, `knowledge-base/scripts/requirements.txt`

---

### 4.4 GEMINI_API_KEY — required for knowledge base

`bus/kb-ingest.sh` and `bus/kb-query.sh` require `GEMINI_API_KEY` in `orgs/{org}/secrets.env`. The mmrag embedding model is `gemini-embedding-2-preview`. Without this key, knowledge base features fail at runtime. This is not mentioned in the README or the `cortextos init` output.

**File references:** `bus/kb-ingest.sh:57–61`, `bus/kb-setup.sh`

---

### 4.5 AUTH_SECRET — required for dashboard but not documented in setup flow

Covered in 1.5. Repeated here for completeness as a missing prerequisite — the dashboard cannot start at all without this, and it is not auto-generated by any setup command.

---

### 4.6 PM2 — listed as optional in install, but required to run the daemon persistently

`cortextos install` lists PM2 as `required: false`. However `cortextos start` (without the daemon already running) only prints instructions to use `pm2 start ecosystem.config.js` — there is no direct-start path. Without PM2, the daemon cannot be started via any cortextos CLI command.

**File references:** `src/cli/install.ts:23–25`, `src/cli/start.ts:12–32`

---

### 4.7 Node.js 20+ is required but not enforced at install via package.json `engines`

`package.json` declares `"engines": { "node": ">=20.0.0" }` but this is a hint only — npm does not enforce it by default. `cortextos doctor` correctly checks and fails on Node < 20, but the install script only warns. A user on Node 18 will install successfully and then see cryptic runtime errors.

**File references:** `package.json:35`, `src/cli/install.ts:19–27`

---

## 5. Known Incomplete Features

### 5.1 Worker session spawn not implemented (MIGRATION IN PROGRESS)

The `m2c1-worker` skill (present in all three agent templates) documents a mechanism for spawning ephemeral Claude Code worker sessions from within a running agent. The Node.js equivalent of tmux-based worker spawning (`tmux new-session`, `tmux send-keys`, `tmux capture-pane`) has not been defined or implemented.

All three template skill files carry this warning:

> ⚠️ **Real-time intervention pending** — Direct session injection (equivalent to tmux send-keys) is not yet implemented in the Node.js system. See grandamenium/cortextos#37.

This means multi-agent M2C1 workflows (where an orchestrator spawns specialist workers) are non-functional in the Node.js version.

**Tracking:** GitHub issue #37 (open)

**File references:** `templates/*/. claude/skills/m2c1-worker/SKILL.md:205`

---

### 5.2 Cron persistence not implemented — crons lost on hard restart

Session crons created via `/loop` (Claude Code's CronCreate) die on any hard restart. The workaround (recreate crons from `config.json` on boot) only handles config-defined crons — ad-hoc user-requested crons are silently lost.

No `pending-reminders.json` or equivalent cron state file exists. The AUDIT.md item 1.11 documents this as open.

**Tracking:** GitHub issue #27 (open)

**File references:** `AUDIT.md:1.11`

---

### 5.3 OAuth token rotation not implemented

The OAuth token rotation system (`check-usage-api`, `refresh-oauth-token`, `rotate-oauth`) is designed and documented but not yet implemented in the Node.js repo. The directories for the token store (`state/oauth/`, `state/usage/`) are created by `cortextos install`, but no rotation logic exists. Agents that rely on OAuth token auto-rotation will hit 401 errors.

**Tracking:** GitHub issue #26 (open)

---

### 5.4 Multi-machine orchestration not implemented — single machine only

The entire message bus is local filesystem I/O. There is no network transport. All agents must run on the same machine. Running agents across multiple machines is not supported.

**Tracking:** GitHub issue #29 (open)

---

### 5.5 Telegram slash command menu not auto-registered

When a user types `/` in Telegram, no command suggestions appear. The Node.js daemon does not register the slash command menu with Telegram's `setMyCommands` API on startup. Users must type full commands manually. (The bash version handled this.)

**Tracking:** GitHub issue #1 (closed — but the Node.js fix status is unclear from the issue thread)

---

### 5.6 No real-time PTY output streaming to Telegram, iOS, or dashboard

Agents' live activity (tool calls, thinking, task steps) is only visible in the daemon logs. There is no mechanism to stream Claude Code TUI output to Telegram, the iOS app, or the dashboard. Users cannot see what agents are doing in real time from any external interface.

**Tracking:** GitHub issue #19 (open)

---

### 5.7 No session compaction notification to user

When Claude Code compacts its context window, the agent goes silent for a period. There is no Telegram notification sent to the user during this time.

**Tracking:** GitHub issue #18 (open)

---

### 5.8 Orchestrator/Analyst AGENTS.md bootstrap order may be stale

`AUDIT.md` item 1.0a notes that `templates/orchestrator/AGENTS.md` and `templates/analyst/AGENTS.md` need a full review pass — the 12-file bootstrap order may not match the current template file list.

**File references:** `AUDIT.md:1.0a`, `templates/orchestrator/AGENTS.md`, `templates/analyst/AGENTS.md`

---

### 5.9 TOOLS.md and AGENTS.md templates reference `bash $CTX_FRAMEWORK_ROOT/bus/` commands

`AUDIT.md` item 1.8 notes that templates still reference `bash $CTX_FRAMEWORK_ROOT/bus/` command patterns in some places, rather than the unified `cortextos bus <cmd>` CLI. Agents following stale TOOLS.md instructions will run bash scripts directly, which breaks on Windows and may break in environments where CTX_FRAMEWORK_ROOT is not set.

**File references:** `AUDIT.md:1.8`, `templates/*/TOOLS.md`

---

### 5.10 `cortextos uninstall --keep-state` is not implemented

`CHANGELOG.md` documents B20: `cortextos uninstall --keep-state` was listed as unimplemented (low priority). The uninstall command exists but does not support selective state preservation.

**File references:** `src/cli/uninstall.ts`, `CHANGELOG.md` (B20)

---

## 6. Open GitHub Issues Tracking These

| Issue | Title | Status | Blocker? |
|-------|-------|--------|----------|
| #37 | Define Node.js worker session spawn mechanism | OPEN | Yes — M2C1 workflows broken |
| #35 | bug: global tmux env pollution (agents inherit orchestrator CTX_AGENT_NAME) | OPEN | Partial — may not affect Node.js version |
| #32 | feat: convert static .md reference files to progressive disclosure skills | OPEN | No — performance/UX |
| #29 | feat: multi-machine agent orchestration (shared network bus) | OPEN | No — single-machine works |
| #27 | feat: cron persistence across session restarts | OPEN | No — crons lost on restart |
| #26 | feat: OAuth token rotation system | OPEN | No — unless agent relies on OAuth |
| #21 | feat: tmux paste-buffer injection for Telegram messages | OPEN | No — current injection works |
| #20 | feat: local override pattern (per-agent custom context) | OPEN | No — implemented in agent-pty.ts |
| #19 | feat: stream Claude Code TUI tool usage to Telegram/iOS/dashboard | OPEN | No — visibility gap only |
| #18 | feat: send Telegram notification on context compaction | OPEN | No |
| #17 | research: skill auto-improvement via transcript scraping | OPEN | No |
| #16 | feat: per-agent transcript-level memory extraction | OPEN | No |
| #2 | Dashboard: shared SQLite DB doesn't support multiple CTX_ROOT instances | OPEN | Yes — data corruption in multi-instance |

---

## 7. Summary: What Breaks for a New Mac User

1. **Install URL dead** — `curl | node` fails immediately; must get repo access out of band.
2. **node-pty build tools** — if Xcode CLI tools not installed, `npm install` fails.
3. **claude login required** — must authenticate before the daemon can start any agents.
4. **PM2 required** — cannot start daemon without it; `cortextos start` just prints instructions.
5. **BOT_TOKEN + CHAT_ID** — must create Telegram bot and get credentials before `cortextos enable` works.
6. **AUTH_SECRET** — must generate and export this env var before `cortextos dashboard` starts.
7. **jq optional but actually required** — all bus scripts depend on it; marked optional in install.
8. **Trust prompt race condition** — on first boot in a new directory, Claude Code shows a "trust this folder?" prompt. The PTY auto-accept (sends Enter at 5s and 8s) is heuristic — may miss the prompt on slow machines or fail if the prompt wording changes.

## 8. Summary: What Breaks for a New Windows User

Everything in section 7, plus:

1. **No `cortextos tunnel`** — hard exits; no alternative provided for persistent dashboard access.
2. **Bus shell scripts require bash/WSL** — agents call `.sh` scripts from inside the PTY; these fail without WSL.
3. **PTY shell is cmd.exe** — Claude Code behavior in cmd.exe is untested; the trust prompt and injection patterns are designed for bash/zsh.
4. **No PM2 startup integration** — daemon does not auto-restart after reboot without manual NSSM/Task Scheduler setup.
5. **`which` commands in tunnel.ts** — would fail if tunnel code is ever reached on Windows.
6. **Linux support explicitly labeled "coming soon"** in README — Windows is not mentioned at all in the platform compatibility table.
