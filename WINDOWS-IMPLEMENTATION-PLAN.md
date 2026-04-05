# Windows Support Implementation Plan

**Date**: 2026-04-05
**Branch**: `claude/windows-support-investigation-UcvMK`
**Mac Risk**: ZERO — every change is additive, conditional on `process.platform === 'win32'`, or a no-op on Unix.

---

## Change 1: Eliminate KB Bash Shell-Outs

### What
Replace `execFileSync('bash', ['kb-query.sh', ...])` with direct Python subprocess calls from Node.js. The bash scripts are thin wrappers that source `.env`, read `secrets.env`, then call `python3 mmrag.py`.

### Files to Edit

| File | Lines | Change |
|------|-------|--------|
| `src/bus/knowledge-base.ts` | 79 | Replace `execFileSync('bash', [kb-query.sh, ...])` → `execFileSync(pythonPath, [mmrag.py, 'query', ...])` |
| `src/bus/knowledge-base.ts` | 156 | Replace `execFileSync('bash', [kb-ingest.sh, ...])` → `execFileSync(pythonPath, [mmrag.py, 'ingest', ...])` |
| `src/cli/bus.ts` | 822 | Replace `execFileSync('bash', [kb-collections.sh, ...])` → `execFileSync(pythonPath, [mmrag.py, 'collections', ...])` |

### Contract (must preserve)

**queryKnowledgeBase()** — Inputs unchanged. Must still return `KBQueryResponse`:
```typescript
{ results: KBQueryResult[], total: number, query: string, collection: string }
```
JSON parsing logic (lines 86-109) stays identical — it already parses mmrag.py's JSON output.

**ingestKnowledgeBase()** — Inputs unchanged. Stdio: inherit. No return value.

**kb-collections** — Stdio: inherit. Human-readable table output from mmrag.py.

### New Helper Needed

```typescript
function getPythonPath(frameworkRoot: string): string {
  const venvBin = process.platform === 'win32' ? 'Scripts' : 'bin';
  return join(frameworkRoot, 'knowledge-base', 'venv', venvBin, 'python3');
}

function loadSecretsEnv(frameworkRoot: string, org: string): Record<string, string> {
  // Read orgs/{org}/secrets.env, parse KEY=VALUE lines
  // This replaces what bash `source secrets.env` did
}
```

### Environment Variables (must pass to Python)
- `MMRAG_DIR` = `~/.cortextos/{instanceId}/orgs/{org}/knowledge-base`
- `MMRAG_CHROMADB_DIR` = `{MMRAG_DIR}/chromadb`
- `MMRAG_CONFIG` = `{MMRAG_DIR}/config.json`
- `GEMINI_API_KEY` — loaded from `orgs/{org}/secrets.env`

### Dependencies
- No new npm packages
- Python venv must exist (unchanged requirement)
- `mmrag.py` at `{frameworkRoot}/knowledge-base/scripts/mmrag.py`

### Validation
```bash
npm test                                          # All existing tests pass
npm run build                                     # TypeScript compiles
cortextos bus kb-query "test" --org testorg       # Same output as before
cortextos bus kb-collections --org testorg        # Same output as before
```

### Mac Risk: NONE
Same Python gets called, just without the bash middleman. Actually more robust on Mac too.

---

## Change 2: Fix Dashboard Bash Shell-Outs

### What
4 dashboard API routes shell out to bash. Replace with direct Python calls or Node.js bus module imports.

### Files to Edit

| File | Lines | Change |
|------|-------|--------|
| `dashboard/src/app/api/kb/collections/route.ts` | 53 | Replace bash call → direct Python spawn (same pattern as Change 1) |
| `dashboard/src/app/api/kb/search/route.ts` | 122 | Replace bash call → direct Python spawn |
| `dashboard/src/app/api/tasks/route.ts` | 116 | Replace bash call → inline Node.js task creation (copy logic from `src/bus/task.ts:createTask()`) |
| `dashboard/src/app/api/org/config/route.ts` | 83 | Replace `spawn('bash', [sync-org-config.sh])` → `spawn(process.execPath, [cli.js, 'bus', 'sync-org-config'])` |

### Contract
Each route must return the same HTTP response shape. The dashboard is a separate Next.js app — it **cannot import from `src/bus/`** directly (separate `package.json`, separate `tsconfig.json`).

**Approach**: For KB routes, use the same direct-Python-spawn pattern from Change 1. For tasks, duplicate the ~20 lines of `createTask()` logic inline (it's just JSON file creation). For org-config, call the Node CLI instead of bash.

### Dependencies
- Dashboard must know the Python venv path (pass via env var `CTX_FRAMEWORK_ROOT`)
- No new npm packages

### Validation
```bash
cd dashboard && npm run build                     # Dashboard compiles
# Manual: open dashboard, create task, search KB, verify same behavior
```

### Mac Risk: NONE
Same operations, bash removed from the middle.

---

## Change 3: Add `windowsHide: true` to Detached Spawn

### What
When PM2 isn't installed, the daemon is spawned detached. On Windows, `detached: true` opens a visible console window.

### Files to Edit

| File | Lines | Change |
|------|-------|--------|
| `src/cli/start.ts` | 107-112 | Add `windowsHide: true` to spawn options |

### Exact Change
```typescript
// Line 107-112: Add one property
const child = spawn(process.execPath, [daemonScript, '--instance', options.instance], {
  detached: true,
  stdio: ['ignore', 'ignore', 'ignore'],
  env: daemonEnv,
  cwd: projectRoot,
  windowsHide: true,  // ← NEW: suppress console window on Windows
});
```

### Contract
No API change. `windowsHide` is a Node.js built-in spawn option, ignored on Unix.

### Dependencies: None
### Validation: `npm run build` — verify CLI compiles
### Mac Risk: ZERO — `windowsHide` is a no-op on macOS/Linux.

---

## Change 4: Make SIGUSR1 Conditional + Fix IPC Wake

### What
`SIGUSR1` doesn't exist on Windows. The fast-checker registers a handler for it. Also, the IPC `wake` command (the cross-platform alternative) exists but is **broken** — it finds the FastChecker but never calls a method on it.

### Files to Edit

| File | Lines | Change |
|------|-------|--------|
| `src/daemon/fast-checker.ts` | 64-72 | Wrap `process.on('SIGUSR1', ...)` in `if (process.platform !== 'win32')` |
| `src/daemon/fast-checker.ts` | 89 | Wrap `process.removeListener('SIGUSR1', ...)` in same guard |
| `src/daemon/fast-checker.ts` | after 97 | Add public `wake()` method |
| `src/daemon/ipc-server.ts` | 155 | Add `checker.wake()` call in IPC wake handler |

### New Method on FastChecker
```typescript
/** Cross-platform alternative to SIGUSR1. Called by IPC 'wake' command. */
wake(): void {
  if (this.wakeResolve) {
    this.wakeResolve();
    this.wakeResolve = null;
  }
}
```

### IPC Server Fix (line 155)
```typescript
if (checker) {
  checker.wake();  // ← NEW: actually trigger the wake
  response = { success: true, data: 'Woke fast checker' };
```

### Contract
- `FastChecker` gains one new public method: `wake(): void`
- IPC `wake` command now actually works (was a no-op before — this is a bug fix)
- SIGUSR1 continues working identically on Mac/Linux

### Dependencies: None
### Validation
```bash
npm test -- tests/unit/daemon/fast-checker.test.ts   # Existing tests pass
npm test -- tests/sprint6-fastchecker.test.ts        # Sprint tests pass
npm run build
```
### Mac Risk: ZERO — SIGUSR1 handler still registered on Mac. IPC wake fix is a bug fix that helps all platforms.

---

## Change 5: Add Windows PTY Smoke Test

### What
`install` and `doctor` commands skip PTY smoke tests on Windows entirely. Add a Windows-compatible test using `cmd.exe`.

### Files to Edit

| File | Lines | Change |
|------|-------|--------|
| `src/cli/install.ts` | 152-173 | Replace `if (!IS_WINDOWS)` block with platform-conditional spawn |
| `src/cli/doctor.ts` | 86-145 | Same: keep Unix perm fixes in `!win32` guard, but make smoke test cross-platform |

### Exact Pattern
```typescript
const cmd = IS_WINDOWS ? 'cmd.exe' : '/bin/echo';
const args = IS_WINDOWS ? ['/c', 'echo', 'pty-ok'] : ['pty-ok'];
const p = pty.spawn(cmd, args, { name: 'xterm-256color', cols: 80, rows: 24 });
```

### Contract
Same success/failure output. Same exit behavior on failure.

### Dependencies: None
### Validation: `npm run build` — verify compiles. Manual test on Windows.
### Mac Risk: ZERO — `/bin/echo` path unchanged on Mac. Only `cmd.exe` path is new, behind `IS_WINDOWS`.

---

## Change 6: Add `process.on('exit')` Fallback Shutdown

### What
Belt-and-suspenders cleanup for daemon and CLI child processes. SIGINT/SIGTERM already work on Windows via Node emulation, but `process.on('exit')` is a guaranteed cross-platform fallback.

### Files to Edit

| File | Lines | Change |
|------|-------|--------|
| `src/daemon/index.ts` | after 83 | Add `process.on('exit', () => { /* sync cleanup */ })` |
| `src/cli/start.ts` | after 67 | Add `process.on('exit', () => child.kill())` |
| `src/cli/dashboard.ts` | after 166 | Add `process.on('exit', cleanup)` |

### Contract
No API change. Existing signal handlers fire first. Exit handler is last resort.

### Dependencies: None
### Validation: `npm run build`
### Mac Risk: ZERO — additive handler, no change to existing flow.

---

## Change 7: PM2 Windows Startup Guidance

### What
PM2's `pm2 startup` command doesn't work natively on Windows. Add guidance after `pm2 save` on Windows.

### Files to Edit

| File | Lines | Change |
|------|-------|--------|
| `src/cli/start.ts` | after 79 | Add Windows-specific console output |

### Exact Change
```typescript
if (IS_WINDOWS) {
  console.log('\nFor auto-start on Windows boot:');
  console.log('  npm install -g pm2-windows-startup');
  console.log('  pm2-windows-startup install');
}
```

### Contract: Informational output only.
### Dependencies: None
### Validation: `npm run build`
### Mac Risk: ZERO — behind `IS_WINDOWS` guard.

---

## Change 8: Platform Tunnel Adapters

### What
`src/cli/tunnel.ts` is macOS-only (launchd). Refactor into platform adapters so Windows (Task Scheduler/NSSM) and Linux (systemd) can be supported.

### Files to Create

| File | Purpose |
|------|---------|
| `src/cli/tunnel/adapter.ts` | `TunnelServiceAdapter` interface (6 methods) |
| `src/cli/tunnel/adapters/launchd.ts` | macOS impl — extract existing code from tunnel.ts |
| `src/cli/tunnel/adapters/systemd.ts` | Linux impl — systemd user service |
| `src/cli/tunnel/adapters/windows.ts` | Windows impl — NSSM or schtasks |
| `src/cli/tunnel/config.ts` | Generic Cloudflare API calls (extracted from tunnel.ts) |
| `src/cli/tunnel/index.ts` | `getAdapter()` factory + re-exports |

### Files to Edit

| File | Change |
|------|--------|
| `src/cli/tunnel.ts` | Replace `checkPlatform()` gate + inline launchd calls → call `getAdapter()` methods |
| `src/cli/doctor.ts:170-237` | Extend tunnel health checks to use adapter's `isServiceRunning()` |

### Adapter Interface
```typescript
interface TunnelServiceAdapter {
  getPlatformName(): string;
  isAvailable(): Promise<boolean>;
  writeServiceConfig(opts: { cloudflaredPath: string; tunnelName: string; instanceId: string; logDir: string }): Promise<void>;
  loadService(opts: { instanceId: string }): Promise<void>;
  unloadService(opts: { instanceId: string }): Promise<void>;
  isServiceRunning(opts: { instanceId: string }): Promise<boolean>;
}
```

### Contract
- All 4 subcommands (`start`, `stop`, `status`, `url`) keep same CLI interface
- `tunnel.json` config format unchanged
- Cloudflare API calls unchanged (already generic)
- `url` subcommand already works cross-platform (no platform check)

### Dependencies: None new for macOS adapter. Windows adapter may need NSSM binary.

### Validation
```bash
npm run build
cortextos tunnel start   # On macOS — identical behavior
cortextos tunnel status  # On macOS — identical output
```

### Mac Risk: ZERO — LaunchdAdapter is a 1:1 extraction of existing code. No logic changes.

---

## Change 9: Windows CI Job

### Files to Edit

| File | Change |
|------|--------|
| `.github/workflows/ci.yml` | Add `windows-latest` job for build + unit tests |

### New CI Job
```yaml
test-windows:
  name: Unit Tests (Windows)
  runs-on: windows-latest
  env:
    CTX_INSTANCE_ID: ci-test
    CTX_ORG: testorg
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: '20', cache: 'npm' }
    - run: npm ci
    - run: npm run build
    - run: npm test
```

### Tests That May Need Platform Guards
- `tests/unit/bus/system.test.ts` — git `execSync` may have path issues on Windows

### Mac Risk: ZERO — separate CI job, doesn't touch Mac workflow.

---

## Change 10: Update Documentation

### Files to Edit

| File | Change |
|------|--------|
| `README.md:99` | Change "Windows: not yet supported" → "Windows: supported (see known issues)" |
| `KNOWN-ISSUES.md` | Add Windows section: PM2 startup, tunnel limitations, node-pty build tools |

### Mac Risk: ZERO — documentation only.

---

## Dependency Map

```
Change 1 (KB bash) ──────► Change 2 (Dashboard bash) depends on same pattern
Change 3 (windowsHide)     Independent
Change 4 (SIGUSR1 + wake)  Independent (also a bug fix)
Change 5 (PTY smoke)       Independent
Change 6 (exit fallback)   Independent
Change 7 (PM2 guidance)    Independent
Change 8 (tunnel adapters) Independent (largest change, can be deferred)
Change 9 (CI)              Should go last (validates everything)
Change 10 (docs)           Should go last
```

Changes 3, 4, 5, 6, 7 can all be done in a single commit (trivial, independent).
Changes 1 and 2 are the core work.
Change 8 is optional for MVP (tunnel is a nice-to-have).

---

## Implementation Order

**Phase 1 — Quick wins (1 hour)**:  Changes 3, 4, 5, 6, 7
**Phase 2 — Core (2-3 days)**: Changes 1, 2
**Phase 3 — Polish (1 day)**: Changes 9, 10
**Phase 4 — Optional (3-5 days)**: Change 8 (tunnel adapters)

**MVP Windows support** (Phases 1-3): ~4 days
**Full Windows support** (all phases): ~8 days
