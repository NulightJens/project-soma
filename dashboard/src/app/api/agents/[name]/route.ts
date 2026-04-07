import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import { getAgentDetail, getAgentPaths } from '@/lib/data/agents';
import {
  parseIdentityMd,
  serializeIdentityMd,
  parseSoulMd,
  serializeSoulMd,
} from '@/lib/markdown-parser';
import type { IdentityFields, SoulFields } from '@/lib/types';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET /api/agents/[name] - Get full agent detail
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);

  try {
    const detail = await getAgentDetail(decoded);
    return Response.json(detail);
  } catch (err) {
    console.error(`[api/agents/${decoded}] GET error:`, err);
    return Response.json({ error: 'Agent not found' }, { status: 404 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/agents/[name] - Update identity and/or soul markdown
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const org = (body.org as string) || undefined;
  const paths = getAgentPaths(decoded, org);

  const results: { identity?: boolean; soul?: boolean } = {};

  // Update IDENTITY.md
  if (body.identity) {
    const identityFields = body.identity as IdentityFields;
    try {
      let rawIdentity = '';
      try {
        rawIdentity = await fs.readFile(paths.identityMd, 'utf-8');
      } catch {
        // File doesn't exist yet, start fresh
      }

      const { parsed } = parseIdentityMd(rawIdentity);
      const newContent = serializeIdentityMd(identityFields, parsed);
      await fs.writeFile(paths.identityMd, newContent, 'utf-8');
      results.identity = true;
    } catch (err) {
      console.error(`[api/agents/${decoded}] PATCH identity error:`, err);
      return Response.json(
        { error: 'Failed to update identity', detail: String(err), path: paths.identityMd },
        { status: 500 },
      );
    }
  }

  // Update SOUL.md
  if (body.soul) {
    const soulFields = body.soul as SoulFields;
    try {
      let rawSoul = '';
      try {
        rawSoul = await fs.readFile(paths.soulMd, 'utf-8');
      } catch {
        // File doesn't exist yet
      }

      const { parsed } = parseSoulMd(rawSoul);
      const newContent = serializeSoulMd(soulFields, parsed);
      await fs.writeFile(paths.soulMd, newContent, 'utf-8');
      results.soul = true;
    } catch (err) {
      console.error(`[api/agents/${decoded}] PATCH soul error:`, err);
      return Response.json(
        { error: 'Failed to update soul' },
        { status: 500 },
      );
    }
  }

  // Update MEMORY.md
  if (typeof body.memoryRaw === 'string') {
    try {
      await fs.writeFile(paths.memoryMd, body.memoryRaw as string, 'utf-8');
    } catch (err) {
      console.error(`[api/agents/${decoded}] PATCH memory error:`, err);
      return Response.json(
        { error: 'Failed to update memory' },
        { status: 500 },
      );
    }
  }

  return Response.json({ success: true, updated: results });
}
