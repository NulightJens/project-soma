import { NextRequest } from 'next/server';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { getFrameworkRoot } from '@/lib/config';

export const dynamic = 'force-dynamic';

const AGENT_REGEX = /^[a-z0-9_-]+$/;

function getAgentGoalsPath(agentName: string, org: string): string | null {
  const frameworkRoot = getFrameworkRoot();
  const p = join(frameworkRoot, 'orgs', org, 'agents', agentName, 'goals.json');
  return p;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const { searchParams } = request.nextUrl;
  const org = searchParams.get('org') || '';

  if (!AGENT_REGEX.test(name) || !org || !AGENT_REGEX.test(org)) {
    return Response.json({ error: 'Invalid agent or org' }, { status: 400 });
  }

  const goalsPath = getAgentGoalsPath(name, org);
  if (!goalsPath || !existsSync(goalsPath)) {
    // Return empty defaults — agent may not have goals.json yet
    return Response.json({
      goals: { focus: '', goals: [], bottleneck: '', updated_at: '', updated_by: '' },
    });
  }

  try {
    const data = JSON.parse(readFileSync(goalsPath, 'utf-8'));
    return Response.json({ goals: data });
  } catch {
    return Response.json({ error: 'Failed to read goals.json' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const { searchParams } = request.nextUrl;
  const org = searchParams.get('org') || '';

  if (!AGENT_REGEX.test(name) || !org || !AGENT_REGEX.test(org)) {
    return Response.json({ error: 'Invalid agent or org' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const goalsPath = getAgentGoalsPath(name, org)!;
  const dir = join(goalsPath, '..');
  if (!existsSync(dir)) {
    return Response.json({ error: `Agent directory not found for ${name}` }, { status: 404 });
  }

  // Read existing or start fresh
  let current: Record<string, unknown> = {
    focus: '',
    goals: [],
    bottleneck: '',
    updated_at: '',
    updated_by: '',
  };
  if (existsSync(goalsPath)) {
    try {
      current = JSON.parse(readFileSync(goalsPath, 'utf-8'));
    } catch { /* use defaults */ }
  }

  // Apply allowed fields
  if (body.focus !== undefined) {
    if (typeof body.focus !== 'string') {
      return Response.json({ error: 'focus must be a string' }, { status: 400 });
    }
    current.focus = body.focus;
  }
  if (body.goals !== undefined) {
    if (!Array.isArray(body.goals)) {
      return Response.json({ error: 'goals must be an array' }, { status: 400 });
    }
    current.goals = body.goals;
  }
  if (body.bottleneck !== undefined) {
    if (typeof body.bottleneck !== 'string') {
      return Response.json({ error: 'bottleneck must be a string' }, { status: 400 });
    }
    current.bottleneck = body.bottleneck;
  }

  current.updated_at = new Date().toISOString();
  current.updated_by = typeof body.updated_by === 'string' ? body.updated_by : 'dashboard';

  // Atomic write
  const tmp = join(os.tmpdir(), `agent-goals-${name}-${Date.now()}.json`);
  try {
    writeFileSync(tmp, JSON.stringify(current, null, 2) + '\n', 'utf-8');
    const { renameSync } = await import('fs');
    renameSync(tmp, goalsPath);
  } catch {
    return Response.json({ error: 'Failed to write goals.json' }, { status: 500 });
  }

  // Fire-and-forget: regenerate GOALS.md
  const frameworkRoot = getFrameworkRoot();
  const distCliPath = join(frameworkRoot, 'dist', 'cli.js');
  if (existsSync(distCliPath)) {
    import('child_process').then(({ spawn }) => {
      const child = spawn(process.execPath, [distCliPath, 'goals', 'generate-md', '--agent', name, '--org', org], {
        env: { ...process.env, CTX_FRAMEWORK_ROOT: frameworkRoot },
        stdio: 'pipe',
      });
      child.on('error', (err) => console.error('[api/agents/goals] generate-md error:', err));
      child.on('exit', (code) => { if (code !== 0) console.error(`[api/agents/goals] generate-md exited ${code}`); });
    }).catch((err) => console.error('[api/agents/goals] spawn import failed:', err));
  }

  return Response.json({ success: true, goals: current });
}
