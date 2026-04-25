import { homedir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import type { BusPaths } from '../types/index.js';
import { validateInstanceId } from './validate.js';

/**
 * The on-disk SOMA state-directory name. The canonical location is
 * `~/.soma/{instance}/`. For backward compatibility with the cortextOS
 * upstream's pre-rename layout, callers fall back to `~/.cortextos/{instance}/`
 * when the new dir doesn't exist (see ADR-015 — display rebrand was Phase A;
 * the infra-migration slot moves real state).
 *
 * Operators migrating an existing install run, in one shot:
 *   pm2 stop  soma-daemon
 *   mv ~/.cortextos ~/.soma
 *   ln -s ~/.soma ~/.cortextos    # so external tools / unmigrated paths still resolve
 *   npm run build
 *   pm2 delete soma-daemon
 *   node dist/cli.js ecosystem
 *   pm2 start ecosystem.config.js
 *
 * After that, both paths resolve to the same content (symlink), and SOMA's own
 * code prefers `.soma` as canonical.
 */
const SOMA_DIR = '.soma';
const LEGACY_DIR = '.cortextos';

/**
 * Return the SOMA state root for the given instance. Prefers the canonical
 * `~/.soma/{instance}/`; if the dir doesn't exist but the legacy
 * `~/.cortextos/{instance}/` does, returns the legacy path so unmigrated
 * installs keep working until the operator runs the migration.
 *
 * Note: when both exist (as during the migration window with a symlink),
 * returns the canonical `.soma` path.
 */
export function getCtxRoot(instanceId: string = 'default'): string {
  validateInstanceId(instanceId);
  const somaPath = join(homedir(), SOMA_DIR, instanceId);
  if (existsSync(somaPath)) return somaPath;
  const legacyPath = join(homedir(), LEGACY_DIR, instanceId);
  if (existsSync(legacyPath)) return legacyPath;
  // Neither exists yet — return the canonical path so callers create the new
  // location on first write.
  return somaPath;
}

/**
 * Resolve all bus paths for an agent.
 * Mirrors the path resolution in bash _ctx-env.sh.
 *
 * The directory layout is:
 *   ~/.soma/{instance}/      (canonical; ~/.cortextos/{instance}/ supported as fallback)
 *     config/                - enabled-agents.json
 *     state/{agent}/         - flat, per-agent subdirs
 *     state/{agent}/heartbeat.json - canonical heartbeat location
 *     state/oauth/           - OAuth accounts.json (token store)
 *     state/usage/           - Usage monitoring snapshots
 *     inbox/{agent}/         - flat (not org-nested)
 *     inflight/{agent}/      - flat
 *     processed/{agent}/     - flat
 *     outbox/{agent}/        - flat
 *     logs/{agent}/          - flat
 *     orgs/{org}/tasks/      - org-scoped
 *     orgs/{org}/approvals/  - org-scoped
 *     orgs/{org}/analytics/  - org-scoped
 */
export function resolvePaths(
  agentName: string,
  instanceId: string = 'default',
  org?: string,
): BusPaths {
  const ctxRoot = getCtxRoot(instanceId);

  // Org-scoped paths for tasks, approvals, analytics
  const orgBase = org ? join(ctxRoot, 'orgs', org) : ctxRoot;

  return {
    ctxRoot,
    inbox: join(ctxRoot, 'inbox', agentName),
    inflight: join(ctxRoot, 'inflight', agentName),
    processed: join(ctxRoot, 'processed', agentName),
    logDir: join(ctxRoot, 'logs', agentName),
    stateDir: join(ctxRoot, 'state', agentName),
    taskDir: join(orgBase, 'tasks'),
    approvalDir: join(orgBase, 'approvals'),
    analyticsDir: join(orgBase, 'analytics'),
    deliverablesDir: join(orgBase, 'deliverables'),
  };
}

/**
 * Get the IPC socket path for daemon communication.
 * Unix domain socket on macOS/Linux, named pipe on Windows.
 */
export function getIpcPath(instanceId: string = 'default'): string {
  validateInstanceId(instanceId);
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\SOMA-${instanceId}`;
  }
  return join(getCtxRoot(instanceId), 'daemon.sock');
}
