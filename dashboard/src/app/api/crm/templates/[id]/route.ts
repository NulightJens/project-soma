import { NextRequest, NextResponse } from 'next/server';
import { getTemplate, updateTemplate } from '@/lib/data/crm-templates';

export const dynamic = 'force-dynamic';

// Middleware already guarantees an authenticated session before this route is
// reached. Use a generic label; wire next-auth v5 auth() here if multi-user
// attribution is needed later.
const AUTHOR_LABEL = 'dashboard-user';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const tpl = await getTemplate(id);
    if (!tpl) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ template: tpl });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const patch: { body?: string | null; cta?: string | null; subject?: string | null; notes?: string | null } = {};
  if (typeof body.body === 'string') patch.body = body.body;
  if (typeof body.cta === 'string') patch.cta = body.cta;
  if (typeof body.subject === 'string') patch.subject = body.subject;
  if (typeof body.notes === 'string') patch.notes = body.notes;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
  }

  try {
    const updated = await updateTemplate(id, patch, AUTHOR_LABEL);
    return NextResponse.json({ template: updated });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
