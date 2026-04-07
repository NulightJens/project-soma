import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { AgentInfo, AgentConfig, BusPaths } from '../types/index.js';
import { atomicWriteSync, ensureDir } from '../utils/atomic.js';
import { sendMessage } from './message.js';

/**
 * List all agents in the system.
 * Scans enabled-agents.json and org agent directories.
 * Mirrors bash list-agents.sh behavior.
 */
export function listAgents(ctxRoot: string, org?: string): AgentInfo[] {
  const agents: AgentInfo[] = [];
  const seen = new Set<string>();

  // 1. Read enabled-agents.json for configured agents
  const enabledFile = join(ctxRoot, 'config', 'enabled-agents.json');
  let enabledAgents: Record<string, { org?: string; enabled?: boolean }> = {};

  if (existsSync(enabledFile)) {
    try {
      enabledAgents = JSON.parse(readFileSync(enabledFile, 'utf-8'));
    } catch {
      // Skip corrupt file
    }
  }

  for (const [name, cfg] of Object.entries(enabledAgents)) {
    if (!/^[a-z0-9_-]+$/.test(name)) continue;
    const agentOrg = cfg.org || '';

    // Filter by org if specified
    if (org && agentOrg !== org) continue;

    seen.add(name);
    agents.push(buildAgentInfo(name, agentOrg, cfg.enabled !== false, ctxRoot));
  }

  // 2. Scan project directories for agents not in enabled list.
  // If enabled-agents.json exists it's authoritative — skip directory scan.
  // Without CTX_FRAMEWORK_ROOT set, skip scan to avoid cross-environment bleed.
  if (existsSync(enabledFile) || !process.env.CTX_FRAMEWORK_ROOT) {
    return agents;
  }

  const cliProjectRoot = process.env.CTX_FRAMEWORK_ROOT;
  const scanRoots: string[] = [];

  if (existsSync(join(cliProjectRoot, 'orgs'))) {
    scanRoots.push(cliProjectRoot);
  }
  // Also try cwd as fallback (only if no other roots found)
  if (scanRoots.length === 0) {
    const cwd = process.cwd();
    if (existsSync(join(cwd, 'orgs'))) {
      scanRoots.push(cwd);
    }
  }

  for (const root of scanRoots) {
    const orgsDir = join(root, 'orgs');
    if (!existsSync(orgsDir)) continue;

    let orgDirs: string[];
    try {
      orgDirs = readdirSync(orgsDir);
    } catch {
      continue;
    }

    for (const orgName of orgDirs) {
      if (org && orgName !== org) continue;

      const agentsDir = join(orgsDir, orgName, 'agents');
      if (!existsSync(agentsDir)) continue;

      let agentDirs: string[];
      try {
        agentDirs = readdirSync(agentsDir);
      } catch {
        continue;
      }

      for (const agentName of agentDirs) {
        if (!/^[a-z0-9_-]+$/.test(agentName)) continue;
        if (seen.has(agentName)) continue;

        const agentDir = join(agentsDir, orgName, 'agents', agentName);
        if (!existsSync(join(agentsDir, agentName))) continue;

        seen.add(agentName);
        agents.push(buildAgentInfo(agentName, orgName, false, ctxRoot));
      }
    }
  }

  return agents;
}

/**
 * Build an AgentInfo object by reading heartbeat, IDENTITY.md, and config.
 */
function buildAgentInfo(
  name: string,
  org: string,
  enabled: boolean,
  ctxRoot: string,
): AgentInfo {
  // Read heartbeat from state dir (bash uses state/{agent}/heartbeat.json)
  let lastHeartbeat: string | null = null;
  let currentTask: string | null = null;
  let mode: string | null = null;
  let running = false;

  const stateHeartbeat = join(ctxRoot, 'state', name, 'heartbeat.json');
  if (existsSync(stateHeartbeat)) {
    try {
      const hb = JSON.parse(readFileSync(stateHeartbeat, 'utf-8'));
      lastHeartbeat = hb.last_heartbeat || hb.timestamp || null;
      currentTask = hb.current_task || null;
      mode = hb.mode || null;
      // Running = heartbeat written within last 10 minutes
      if (lastHeartbeat) {
        const age = Date.now() - new Date(lastHeartbeat).getTime();
        running = age < 10 * 60 * 1000;
      }
    } catch {
      // Skip corrupt
    }
  }

  // Get display name and role from IDENTITY.md
  let role = '';
  let displayName: string | undefined;
  const frameworkRoot = process.env.CTX_FRAMEWORK_ROOT || process.env.CTX_PROJECT_ROOT || '';
  if (frameworkRoot) {
    const identityPaths = [
      join(frameworkRoot, 'orgs', org, 'agents', name, 'IDENTITY.md'),
      join(frameworkRoot, 'agents', name, 'IDENTITY.md'),
    ];
    for (const idPath of identityPaths) {
      if (existsSync(idPath)) {
        try {
          const content = readFileSync(idPath, 'utf-8');
          const lines = content.split('\n');

          // Parse "## Name" — user-configured display name (e.g. "Alpha", "Beta")
          const nameIdx = lines.findIndex(l => l.trim() === '## Name');
          if (nameIdx >= 0) {
            for (let i = nameIdx + 1; i < lines.length; i++) {
              const line = lines[i].trim();
              if (!line || line.startsWith('<!--')) continue;
              if (line.startsWith('##')) break;
              displayName = line;
              break;
            }
          }

          // Find "## Role" then take the first non-empty, non-comment line after it
          const roleIdx = lines.findIndex(l => l.startsWith('## Role'));
          if (roleIdx >= 0) {
            for (let i = roleIdx + 1; i < lines.length; i++) {
              const line = lines[i].trim();
              // Skip empty lines and HTML comment placeholders
              if (!line || line.startsWith('<!--') || line.startsWith('##')) break;
              role = line;
              break;
            }
          }
          // Fallback: first non-comment, non-heading line
          if (!role) {
            for (const line of lines) {
              const t = line.trim();
              if (t && !t.startsWith('#') && !t.startsWith('<!--')) {
                role = t;
                break;
              }
            }
          }
        } catch {
          // Skip
        }
        break;
      }
    }
  }

  // Read config.json for model info
  const configFrameworkRoot = process.env.CTX_FRAMEWORK_ROOT || process.env.CTX_PROJECT_ROOT || '';
  if (configFrameworkRoot) {
    const configPaths = [
      join(configFrameworkRoot, 'orgs', org, 'agents', name, 'config.json'),
      join(configFrameworkRoot, 'agents', name, 'config.json'),
    ];
    for (const cfgPath of configPaths) {
      if (existsSync(cfgPath)) {
        try {
          const cfg: AgentConfig = JSON.parse(readFileSync(cfgPath, 'utf-8'));
          if (cfg.enabled !== undefined) enabled = cfg.enabled;
        } catch {
          // Skip
        }
        break;
      }
    }
  }

  return {
    name,
    org,
    display_name: displayName,
    role,
    enabled,
    running,
    last_heartbeat: lastHeartbeat,
    current_task: currentTask,
    mode,
  };
}

/**
 * Send an urgent notification to an agent.
 * Writes .urgent-signal file and sends a bus message.
 * Mirrors bash notify-agent.sh behavior.
 */
export function notifyAgent(
  paths: BusPaths,
  from: string,
  targetAgent: string,
  message: string,
  ctxRoot: string,
): void {
  // Write signal file to state dir
  const signalDir = join(ctxRoot, 'state', targetAgent);
  ensureDir(signalDir);

  const signal = {
    from,
    message,
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };

  atomicWriteSync(join(signalDir, '.urgent-signal'), JSON.stringify(signal));

  // Also send via normal message bus for persistence
  try {
    sendMessage(paths, from, targetAgent, 'urgent', message);
  } catch {
    // Ignore bus send failures - signal file is the primary mechanism
  }
}
