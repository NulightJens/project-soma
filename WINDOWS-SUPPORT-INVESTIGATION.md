# Windows Support Investigation

**Date**: 2026-04-05
**Status**: Not supported (README says "Windows: not yet supported")
**Goal**: Native Windows + macOS from one canonical codebase

---

## Executive Summary

cortextOS has **scattered Windows awareness** (named pipes, `IS_WINDOWS` flags, try/catch around chmod) but **cannot run on Windows** today. The blockers fall into 5 categories: bash script dependencies, Unix signals, hardcoded Unix paths, macOS-only features, and dashboard bash calls.

---

## What Already Works on Windows

These pieces are already cross-platform — no changes needed:

| Component | File(s) | Details |
|-----------|---------|---------|
| IPC named pipes | `src/utils/paths.ts:56-58` | `\\.\pipe\cortextos-{id}` on win32 |
| IPC server socket cleanup | `src/daemon/ipc-server.ts:27,86` | Skips `unlinkSync` on win32 |
| Command detection | `src/cli/install.ts:22`, `src/cli/start.ts:12` | `where` on Windows, `which` on Unix |
| jq installation | `src/cli/install.ts:37-44` | winget/choco paths |
| Path resolution | `src/utils/paths.ts` | Uses `path.join()` and `homedir()` throughout |
| chmod calls | 16 call sites in `src/` | All wrapped in `try/catch { /* ignore on Windows */ }` |
| node-pty build guidance | `src/cli/install.ts:134-135`, `src/cli/doctor.ts:79-80` | Points to Visual C++ Build Tools |
| Hook runner | `src/cli/bus.ts:837-840` | Uses `process.execPath` (Node), not bash |
| Core bus operations | `src/bus/message.ts`, `task.ts`, `approval.ts`, etc. | Pure Node.js, no bash dependency |

---

## Changes Required

### Category 1: Bash Script Dependencies (CRITICAL)

The Node.js codebase shells out to `bash` for 6 operations. These must be rewritten as pure Node.js.

#### 1.1 Knowledge Base — `src/bus/knowledge-base.ts`

**Lines**: 79, 156
**Problem**: Calls `execFileSync('bash', [kb-query.sh, ...])` and `execFileSync('bash', [kb-ingest.sh, ...])`
**Scripts called**: `bus/kb-query.sh`, `bus/kb-ingest.sh`

**Fix**: Rewrite as native Node.js functions that directly invoke the underlying Python `mmrag.py` script (which these bash scripts wrap). The bash scripts just set env vars and call Python — trivial to replace.

```
// Instead of:
execFileSync('bash', [join(SCRIPT_DIR, 'kb-query.sh'), ...], ...)

// Do:
execFileSync('python3', [join(SCRIPT_DIR, 'mmrag.py'), 'query', ...], ...)
// or spawn python/python3 depending on platform
```

#### 1.2 KB Collections CLI — `src/cli/bus.ts:822`

**Problem**: Calls `execFileSync('bash', [kb-collections.sh, ...])`
**Script called**: `bus/kb-collections.sh`

**Fix**: Same as 1.1 — rewrite to call Python directly or reimplement the collection listing in Node.js (it's just reading ChromaDB metadata).

#### 1.3 Dashboard API routes (4 endpoints)

**Files**:
- `dashboard/src/app/api/kb/collections/route.ts:53`
- `dashboard/src/app/api/kb/search/route.ts:122`
- `dashboard/src/app/api/tasks/route.ts:116`
- `dashboard/src/app/api/org/config/route.ts:83`

**Problem**: All call `execFileSync('bash', [script, ...])` or `spawn('bash', [script, ...])`
**Scripts called**: `kb-collections.sh`, `kb-query.sh`, `create-task.sh`, `sync-org-config.sh`

**Fix**: Replace with imports from the Node.js bus modules (`src/bus/task.ts`, `src/bus/knowledge-base.ts`, etc.) which already implement these operations in pure Node.js. The dashboard should call the Node API directly, not shell out.

#### 1.4 Remaining 49 bash scripts in `bus/`

**Directory**: `bus/*.sh` (49 scripts)

**Situation**: Most of these already have Node.js equivalents in `src/bus/` and `src/cli/bus.ts`. The bash scripts exist for the legacy bash-based agent wrapper. The Node.js CLI (`src/cli/bus.ts`) already reimplements most bus commands in pure Node.js.

**Scripts that still need Node.js equivalents** (called directly by Node code):
1. `kb-query.sh` — wrap mmrag.py → rewrite in Node
2. `kb-ingest.sh` — wrap mmrag.py → rewrite in Node
3. `kb-collections.sh` — list ChromaDB collections → rewrite in Node
4. `sync-org-config.sh` — sync org config → rewrite in Node (or import existing Node module)
5. `create-task.sh` — already has Node equivalent in `src/bus/task.ts` → update dashboard to use it

**Scripts NOT called by Node code** (only used by bash agent-wrapper, can be left as-is for bash-based agents):
- `send-message.sh`, `check-inbox.sh`, `ack-inbox.sh`, `create-approval.sh`, `update-approval.sh`, etc.
- These are fine — Node agents use `src/bus/*.ts` directly

---

### Category 2: Unix Signals (HIGH)

#### 2.1 SIGINT/SIGTERM in daemon — `src/daemon/index.ts:82-83`

**Problem**: `process.on('SIGINT', ...)` and `process.on('SIGTERM', ...)` are used for graceful shutdown.
**Windows behavior**: Node.js on Windows emits a synthetic `SIGINT` on Ctrl+C, and `SIGTERM` is partially supported. However, PM2 sends `SIGINT` on Windows stop which does work.

**Fix**: These actually **mostly work** on Windows in Node.js. Node emulates SIGINT on Ctrl+C and PM2 handles stop signals. Add a `process.on('message', ...)` handler for PM2's graceful shutdown message as a belt-and-suspenders approach:

```typescript
// Add alongside existing signal handlers:
process.on('message', (msg) => {
  if (msg === 'shutdown') handleSignal();
});
```

**Risk**: LOW — Node.js already emulates these on Windows.

#### 2.2 SIGINT/SIGTERM in CLI commands — `src/cli/start.ts:66-67`, `src/cli/dashboard.ts:164-166`

**Problem**: Same pattern for cleaning up child processes on Ctrl+C.
**Fix**: Same as 2.1 — these work on Windows via Node's emulation. No change needed, but add `process.on('exit', cleanup)` as a fallback.

#### 2.3 SIGUSR1 in fast-checker — `src/daemon/fast-checker.ts:64-72`

**Problem**: `process.on('SIGUSR1', ...)` is used to wake the fast-checker immediately. **SIGUSR1 does not exist on Windows.**
**Current mitigation**: IPC `wake` command already exists (`src/daemon/ipc-server.ts:151-162`) as a replacement for SIGUSR1.

**Fix**: Make SIGUSR1 handler conditional:

```typescript
if (process.platform !== 'win32') {
  process.on('SIGUSR1', sigusr1Handler);
}
// The IPC 'wake' command already handles this cross-platform
```

#### 2.4 SIGTERM/SIGINT in hooks — `src/hooks/hook-planmode-telegram.ts:99-100`, `src/hooks/hook-permission-telegram.ts:59-60`

**Problem**: Signal handlers for cleanup in Telegram hooks.
**Fix**: These work on Windows via Node's emulation. Add `process.on('exit', cleanup)` as fallback.

---

### Category 3: Hardcoded Unix Paths (MEDIUM)

#### 3.1 PTY smoke test — `src/cli/install.ts:156`, `src/cli/doctor.ts:123`

**Problem**: `pty.spawn('/bin/echo', ['pty-ok'], ...)` — `/bin/echo` doesn't exist on Windows.
**Current mitigation**: Both are wrapped in `if (!IS_WINDOWS)` / `if (process.platform !== 'win32')` — **already skipped on Windows**.

**Fix**: Add a Windows-specific smoke test:

```typescript
if (IS_WINDOWS) {
  const p = pty.spawn('cmd.exe', ['/c', 'echo', 'pty-ok'], { ... });
} else {
  const p = pty.spawn('/bin/echo', ['pty-ok'], { ... });
}
```

#### 3.2 spawn-helper permissions — `src/cli/install.ts:144-149`, `src/cli/doctor.ts:86-109`

**Problem**: `fixSpawnHelper()` uses chmod to fix node-pty prebuild permissions.
**Current mitigation**: Already wrapped in `if (!IS_WINDOWS)` — **already skipped on Windows**.

**Fix**: None needed. Windows doesn't use Unix executable bits.

---

### Category 4: macOS-Only Features (MEDIUM)

#### 4.1 Tunnel command — `src/cli/tunnel.ts` (entire file)

**Problem**: Uses launchd (macOS-only) for cloudflared tunnel persistence. Exits with error on non-macOS.
**Lines**: 40-44 — hard exit on non-darwin.

**Fix** (multi-step):

1. **Extract tunnel management into platform adapters**:
   - `src/platform/tunnel-macos.ts` — launchd plist (current implementation)
   - `src/platform/tunnel-windows.ts` — Windows Task Scheduler (`schtasks`) or NSSM service
   - `src/platform/tunnel-linux.ts` — systemd service

2. **Update `src/cli/tunnel.ts`** to select adapter based on `process.platform`:

```typescript
function getTunnelAdapter() {
  switch (process.platform) {
    case 'darwin': return new MacOSTunnelAdapter();
    case 'win32': return new WindowsTunnelAdapter();
    default: return new LinuxTunnelAdapter();
  }
}
```

3. **Windows adapter** would use:
   - `schtasks /create` for persistence (or NSSM for service management)
   - `%USERPROFILE%\.cloudflared\` for config paths
   - `winget install cloudflare.cloudflared` or `choco install cloudflared` for installation

#### 4.2 Doctor tunnel checks — `src/cli/doctor.ts:170-237`

**Problem**: Tunnel health checks are macOS-only (checks launchd service, cloudflared).
**Current mitigation**: Already wrapped in `if (process.platform === 'darwin')`.

**Fix**: Extend with Windows-specific checks when tunnel adapter is implemented. For now, no change needed — it correctly skips on non-macOS.

---

### Category 5: Process Management (LOW-MEDIUM)

#### 5.1 PM2 on Windows

**Problem**: PM2 works on Windows but has quirks:
- `ecosystem.config.js` paths use forward slashes (works on Windows via Node's path normalization)
- PM2 startup (`pm2 startup`) doesn't support Windows natively — needs `pm2-windows-startup` package
- PM2 log rotation may behave differently

**File**: `src/cli/ecosystem.ts`

**Fix**:
1. Paths are already fine (Node normalizes)
2. Add Windows startup instructions in `cortextos start` output:
   ```
   if (IS_WINDOWS) {
     console.log('For auto-start on boot: npm install -g pm2-windows-startup && pm2-startup install');
   }
   ```
3. Test PM2 ecosystem on Windows CI

#### 5.2 Detached daemon spawn — `src/cli/start.ts:107-113`

**Problem**: `spawn(process.execPath, [...], { detached: true, stdio: ['ignore', ...] })` with `child.unref()`.
**Windows behavior**: `detached: true` on Windows creates a new console window.

**Fix**: Add `windowsHide: true` to spawn options:

```typescript
const child = spawn(process.execPath, [daemonScript, ...], {
  detached: true,
  stdio: ['ignore', 'ignore', 'ignore'],
  env: daemonEnv,
  cwd: projectRoot,
  windowsHide: true,  // <-- prevent new console window
});
```

---

### Category 6: node-pty Native Module (LOW)

#### 6.1 Build requirements

**Problem**: node-pty requires native compilation. On Windows this needs Visual C++ Build Tools.
**Current mitigation**: Already has error messages pointing to `windows-build-tools`.

**Fix**: Consider using prebuilt binaries. node-pty ships prebuilds for Windows. Ensure `package.json` includes the prebuild config. If prebuilds are already configured, this may "just work" via `npm install`.

#### 6.2 PTY shell selection — `src/pty/agent-pty.ts`

**Problem**: Need to verify what shell node-pty spawns on Windows. It should use `cmd.exe` or `powershell.exe` by default.

**Fix**: Explicitly set shell in agent config:

```typescript
const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash';
```

This needs investigation in the AgentPTY spawn logic to ensure the right shell is used.

---

### Category 7: File Permissions (LOW — already handled)

All `chmodSync` calls are already wrapped in try/catch. No changes needed. Windows ignores Unix permission bits.

**Files with chmod** (16 call sites, all safe):
- `src/cli/install.ts:241,268,305`
- `src/cli/dashboard.ts:63,119`
- `src/cli/init.ts:110`
- `src/cli/add-agent.ts:103`
- `src/cli/setup.ts:77`
- `src/cli/tunnel.ts:230`
- `src/cli/doctor.ts:103`
- `src/bus/oauth.ts:127,469`

---

### Category 8: README and Documentation (LOW)

#### 8.1 README.md:99

**Current**: "macOS or Linux" and "Windows: not yet supported"
**Fix**: Update to reflect Windows support status after implementation.

#### 8.2 KNOWN-ISSUES.md

**Fix**: Add Windows-specific known issues section.

---

## Priority Order for Implementation

| # | Change | Effort | Impact | Files |
|---|--------|--------|--------|-------|
| 1 | Rewrite KB bash calls as Node.js | Medium | Unblocks KB on Windows | `src/bus/knowledge-base.ts`, `src/cli/bus.ts:822` |
| 2 | Fix dashboard bash calls | Medium | Unblocks dashboard on Windows | 4 files in `dashboard/src/app/api/` |
| 3 | Add `windowsHide: true` to detached spawn | Trivial | Prevents console popup | `src/cli/start.ts:107` |
| 4 | Make SIGUSR1 conditional | Trivial | Prevents crash on Windows | `src/daemon/fast-checker.ts:72` |
| 5 | Add Windows PTY smoke test | Small | Install/doctor work on Windows | `src/cli/install.ts:152`, `src/cli/doctor.ts:86` |
| 6 | Add `process.on('exit')` fallback shutdown | Small | Belt-and-suspenders | `src/daemon/index.ts`, `src/cli/start.ts`, `src/cli/dashboard.ts` |
| 7 | Verify PTY shell selection | Small | Agents spawn correctly | `src/pty/agent-pty.ts` |
| 8 | PM2 Windows startup guidance | Trivial | Better DX | `src/cli/start.ts` |
| 9 | Platform tunnel adapters | Large | Tunnel works on Windows | `src/cli/tunnel.ts` + new adapter files |
| 10 | Update docs | Trivial | Accurate docs | `README.md`, `KNOWN-ISSUES.md` |

---

## Estimated Effort

- **Items 1-2** (bash elimination): ~2-3 days — most impactful
- **Items 3-6** (quick fixes): ~1 day — low-hanging fruit
- **Items 7-8** (PTY + PM2): ~1 day — needs testing on real Windows
- **Item 9** (tunnel adapters): ~2-3 days — new platform abstraction
- **Item 10** (docs): ~1 hour

**Total**: ~6-8 days of focused work, plus Windows CI/testing setup.

---

## Testing Strategy

1. **Add Windows to CI** — GitHub Actions `windows-latest` runner
2. **Cross-platform unit tests** — ensure all bus modules pass on Windows
3. **PTY integration test** — spawn agent on Windows, verify output
4. **IPC test** — named pipes already implemented, verify in CI
5. **E2E test** — full `install → init → add-agent → start → status` cycle on Windows

---

## Architecture Decision: Same Codebase

All changes should be **conditional** within the same files, not separate Windows forks:

```typescript
// Pattern: platform-conditional inline
const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash';

// Pattern: platform adapter (for large divergences like tunnel)
const adapter = getTunnelAdapter(); // returns platform-specific impl

// Pattern: already used throughout
try { chmodSync(path, 0o600); } catch { /* ignore on Windows */ }
```

No separate `src-windows/` directory. No build-time platform selection. Runtime `process.platform` checks only.
