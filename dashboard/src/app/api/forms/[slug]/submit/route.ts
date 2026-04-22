import { NextRequest, NextResponse } from 'next/server';
import { getActiveFormBySlug, submitFormResponse, validateAnswers } from '@/lib/data/forms';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}

function cleanHandle(raw: string): string {
  return raw.replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 80);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!slug) return NextResponse.json({ error: 'missing slug' }, { status: 400 });

  const ip = clientIp(req);
  const { allowed, retryAfter } = checkRateLimit(`form:${ip}`);
  if (!allowed) {
    return NextResponse.json(
      { error: 'rate limited — try again shortly', retryAfter },
      { status: 429 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const memberHandle = typeof body.member === 'string' ? cleanHandle(body.member) : '';
  const answers = (body.answers && typeof body.answers === 'object') ? (body.answers as Record<string, unknown>) : {};
  if (!memberHandle) {
    return NextResponse.json({ error: 'member handle required' }, { status: 400 });
  }

  let form;
  try {
    form = await getActiveFormBySlug(slug);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'form lookup failed' }, { status: 500 });
  }
  if (!form) return NextResponse.json({ error: 'form not found' }, { status: 404 });

  const validationError = validateAnswers(form.questions, answers);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 422 });

  try {
    const result = await submitFormResponse({
      formId: form.id,
      memberHandle,
      answers,
      channel: 'web',
    });
    return NextResponse.json({
      ok: true,
      responseId: result.responseId,
      message: 'Thanks — response recorded',
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'submit failed' }, { status: 500 });
  }
}
