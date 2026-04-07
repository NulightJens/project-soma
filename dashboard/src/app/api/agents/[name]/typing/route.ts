import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getCTXRoot } from '@/lib/config';

export const dynamic = 'force-dynamic';

/**
 * GET /api/agents/[name]/typing
 * Returns { typing: boolean } — true if the agent's stdout.log grew in the last 3 seconds.
 * fast-checker.sh writes a Unix timestamp to typing.flag while the log is growing.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;

  if (!name || !/^[a-z0-9_-]+$/.test(name)) {
    return Response.json({ typing: false });
  }

  const ctxRoot = getCTXRoot();
  const flagFile = path.join(ctxRoot, 'logs', name, 'typing.flag');

  if (!fs.existsSync(flagFile)) {
    return Response.json({ typing: false });
  }

  try {
    const content = fs.readFileSync(flagFile, 'utf-8').trim();
    const ts = parseInt(content, 10);
    const now = Math.floor(Date.now() / 1000);
    // Flag is valid if written within last 5 seconds
    const typing = !isNaN(ts) && now - ts <= 5;
    return Response.json({ typing });
  } catch {
    return Response.json({ typing: false });
  }
}
