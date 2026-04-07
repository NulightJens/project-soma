import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { homedir } from 'os';
import { getAgentDir, getOrgs, getAgentsForOrg } from '@/lib/config';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET /api/agents/[name]/memory?path=/absolute/path/to/file.md
// When path is omitted, returns MEMORY.md for the named agent.
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  const { searchParams } = request.nextUrl;
  const filePath = searchParams.get('path');

  // If explicit path provided, serve that file directly
  if (filePath) {
    if (!filePath.endsWith('.md')) {
      return Response.json({ error: 'Invalid file path' }, { status: 400 });
    }

    // Security (C3): Confine path reads to this agent's own directory.
    // path.resolve() neutralizes any ../ traversal before startsWith comparison.
    const frameworkRoot = process.env.CTX_FRAMEWORK_ROOT ?? homedir();
    // Auto-discover org if not provided — avoids 403 when org param is missing
    let orgName = searchParams.get('org');
    if (!orgName) {
      for (const org of getOrgs()) {
        if (getAgentsForOrg(org).includes(decoded)) {
          orgName = org;
          break;
        }
      }
      orgName = orgName ?? getOrgs()[0] ?? 'default';
    }
    const agentDir = path.resolve(frameworkRoot, 'orgs', orgName, 'agents', decoded);
    const resolved = path.resolve(agentDir, filePath);

    if (!resolved.startsWith(agentDir + path.sep)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    try {
      const content = await fs.readFile(resolved, 'utf-8');
      return new Response(content, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    } catch {
      return new Response('', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  }

  // No path — return MEMORY.md for this agent (auto-discover org)
  let agentDir: string | null = null;
  for (const org of getOrgs()) {
    if (getAgentsForOrg(org).includes(decoded)) {
      agentDir = getAgentDir(decoded, org);
      break;
    }
  }
  if (!agentDir) agentDir = getAgentDir(decoded);

  try {
    const memoryPath = path.join(agentDir, 'MEMORY.md');
    const content = await fs.readFile(memoryPath, 'utf-8');
    return new Response(content, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch {
    return new Response('', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
