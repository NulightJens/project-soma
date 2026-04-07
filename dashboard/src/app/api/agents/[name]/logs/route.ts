import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { getAgentPaths } from '@/lib/data/agents';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET /api/agents/[name]/logs?type=activity&lines=500
// Returns the last N lines of a log file for the agent.
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);

  const { searchParams } = request.nextUrl;
  const logType = searchParams.get('type') ?? 'activity';
  const lines = Math.min(Number(searchParams.get('lines') ?? '500'), 5000);

  // Validate log type to prevent directory traversal
  if (!/^[\w.-]+$/.test(logType)) {
    return Response.json({ error: 'Invalid log type' }, { status: 400 });
  }

  const org = searchParams.get('org') || undefined;
  const paths = getAgentPaths(decoded, org);
  const logFile = path.join(paths.logsDir, `${logType}.log`);

  try {
    const content = await fs.readFile(logFile, 'utf-8');
    // Strip ANSI escape codes from log output
    const stripped = content.replace(
      // eslint-disable-next-line no-control-regex
      /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b\[[\?]?[0-9;]*[a-zA-Z]/g,
      '',
    );
    // Clean up control chars and excessive whitespace
    const cleaned = stripped
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '') // remove control chars except \n \r \t
      .replace(/\r/g, '') // remove carriage returns
      .replace(/\n{3,}/g, '\n\n'); // collapse 3+ newlines to 2
    const allLines = cleaned.split('\n');
    const tail = allLines.slice(-lines).join('\n');
    return new Response(tail, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch {
    return new Response('', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
