import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { getAgentDir, getAllAgents, CTX_FRAMEWORK_ROOT } from '@/lib/config';
import { spawnSync } from 'child_process';

export const dynamic = 'force-dynamic';

interface Cron {
  name: string;
  type?: 'recurring' | 'once';
  /** Required for recurring crons (e.g. "4h", "1d"). */
  interval?: string;
  /** Required for once crons — ISO 8601 datetime. */
  fire_at?: string;
  prompt: string;
}

interface AgentConfig {
  agent_name: string;
  enabled: boolean;
  startup_delay: number;
  max_session_seconds: number;
  working_directory: string;
  crons: Cron[];
}

function resolveAgent(name: string): { agentDir: string; org?: string } {
  const decoded = decodeURIComponent(name);
  const allAgents = getAllAgents();
  const entry = allAgents.find(
    a => a.name.toLowerCase() === decoded.toLowerCase()
  );
  const systemName = entry?.name ?? decoded;
  const org = entry?.org || undefined;
  return { agentDir: getAgentDir(systemName, org), org };
}

// GET /api/agents/[name]/crons - Read crons from config.json
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  try {
    const { agentDir } = resolveAgent(name);
    const configPath = path.join(agentDir, 'config.json');
    const raw = await fs.readFile(configPath, 'utf-8');
    const config: AgentConfig = JSON.parse(raw);
    return Response.json({ crons: config.crons || [] });
  } catch (err) {
    console.error(`[api/agents/${name}/crons] GET error:`, err);
    return Response.json({ crons: [] });
  }
}

// PUT /api/agents/[name]/crons - Update crons in config.json
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);

  try {
    const { agentDir, org } = resolveAgent(name);
    const configPath = path.join(agentDir, 'config.json');
    const raw = await fs.readFile(configPath, 'utf-8');
    const config: AgentConfig = JSON.parse(raw);

    const body = await request.json();
    const crons: Cron[] = body.crons;

    // Validate crons
    if (!Array.isArray(crons)) {
      return Response.json({ error: 'crons must be an array' }, { status: 400 });
    }
    for (const cron of crons) {
      if (!cron.name || !cron.prompt) {
        return Response.json(
          { error: 'Each cron must have name and prompt' },
          { status: 400 }
        );
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(cron.name)) {
        return Response.json(
          { error: `Invalid cron name: ${cron.name}` },
          { status: 400 }
        );
      }
      const cronType = cron.type ?? 'recurring';
      if (cronType === 'recurring') {
        if (!cron.interval || !/^\d+[smhd]$/.test(cron.interval)) {
          return Response.json(
            { error: `Recurring cron "${cron.name}" must have a valid interval (e.g. "4h")` },
            { status: 400 }
          );
        }
      } else if (cronType === 'once') {
        if (!cron.fire_at || isNaN(Date.parse(cron.fire_at))) {
          return Response.json(
            { error: `Once cron "${cron.name}" must have a valid fire_at ISO timestamp` },
            { status: 400 }
          );
        }
      } else {
        return Response.json(
          { error: `Invalid cron type "${cron.type}" for "${cron.name}"` },
          { status: 400 }
        );
      }
    }

    // Update config
    config.crons = crons;
    await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n');

    // Notify agent to re-read config via message bus
    const allAgents = getAllAgents();
    const entry = allAgents.find(
      a => a.name.toLowerCase() === decoded.toLowerCase()
    );
    const systemName = entry?.name ?? decoded;
    try {
      spawnSync(
        'bash',
        [
          path.join(CTX_FRAMEWORK_ROOT, 'bus', 'send-message.sh'),
          systemName,
          'normal',
          'Crons updated via dashboard. Re-read config.json and update your /loop crons.',
        ],
        { timeout: 5000, stdio: 'pipe' },
      );
    } catch {
      // Non-fatal: agent might be offline
    }

    return Response.json({ success: true, crons });
  } catch (err) {
    console.error(`[api/agents/${name}/crons] PUT error:`, err);
    return Response.json({ error: 'Failed to update crons' }, { status: 500 });
  }
}
