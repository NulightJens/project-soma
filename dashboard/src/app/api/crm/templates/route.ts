import { NextResponse } from 'next/server';
import { listTemplates } from '@/lib/data/crm-templates';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const templates = await listTemplates();
    return NextResponse.json({ templates });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
