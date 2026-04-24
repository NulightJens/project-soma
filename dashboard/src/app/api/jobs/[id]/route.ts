import { NextRequest } from 'next/server';
import { getJob, runCliAction } from '@/lib/data/minions';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || !Number.isInteger(id)) {
    return Response.json({ error: 'id must be an integer' }, { status: 400 });
  }
  const job = getJob(id);
  if (!job) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json(job);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || !Number.isInteger(id)) {
    return Response.json({ error: 'id must be an integer' }, { status: 400 });
  }

  let body: { action?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const action = body.action;
  if (action !== 'cancel' && action !== 'retry') {
    return Response.json(
      { error: "action must be 'cancel' or 'retry'" },
      { status: 400 },
    );
  }

  const result = await runCliAction(action, id);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 500 });
  }
  const job = getJob(id);
  return Response.json({ message: result.message, job });
}
