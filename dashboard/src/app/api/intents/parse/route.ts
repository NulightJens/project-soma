/**
 * POST /api/intents/parse — freeform-text → structured queue.add intent.
 *
 * Per ADR-014 (user-facing edge filter): users type simple phrases like
 * "sleep 5 seconds" or "echo hello". This endpoint maps them to a
 * structured `{name, data, queue, priority}` shape the operator can
 * confirm before submission.
 *
 * Implementation note: this v1 ships the deterministic pattern-matcher
 * only. An LLM-routed fallback (using the subscription engine via a
 * synchronous high-priority Minion) is the natural next step — tracked
 * as a follow-up slot. Pattern path covers the common cases without
 * requiring `claude` CLI OAuth or the API engine; falls back to
 * `couldn't parse` for everything else, which the UI surfaces as
 * "use the Advanced tab".
 */

import { NextRequest } from 'next/server';
import { parseIntent, type ParseResult } from './pattern-parser';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return Response.json({ error: 'body must be a JSON object' }, { status: 400 });
  }
  const text = (body as { text?: unknown }).text;
  if (typeof text !== 'string' || text.trim().length === 0) {
    return Response.json({ error: 'text is required (non-empty string)' }, { status: 400 });
  }

  const result: ParseResult = parseIntent(text);
  return Response.json(result);
}
