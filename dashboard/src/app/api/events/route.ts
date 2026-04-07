import { NextRequest } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/events - Query historical events from SQLite.
 *
 * Query params:
 *   limit  - max rows (default 50, max 500)
 *   offset - pagination offset (default 0)
 *   type   - filter by event type
 *   agent  - filter by agent name
 *   org    - filter by org
 *   from   - ISO date lower bound (inclusive)
 *   to     - ISO date upper bound (inclusive)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const limit = Math.min(
    Math.max(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 1),
    500
  );
  const offset = Math.max(
    parseInt(searchParams.get('offset') ?? '0', 10) || 0,
    0
  );
  const type = searchParams.get('type');
  const agent = searchParams.get('agent');
  const org = searchParams.get('org');
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (type) {
    conditions.push('type = ?');
    params.push(type);
  }
  if (agent) {
    conditions.push('agent = ?');
    params.push(agent);
  }
  if (org) {
    conditions.push('org = ?');
    params.push(org);
  }
  if (from) {
    conditions.push('timestamp >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('timestamp <= ?');
    params.push(to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const rows = db
      .prepare(
        `SELECT id, timestamp, agent, org, type, category, severity, data, message, source_file
         FROM events ${where}
         ORDER BY timestamp DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset);

    // Parse the data column from JSON string back to object
    const events = (rows as Record<string, unknown>[]).map((row) => ({
      ...row,
      data: row.data ? JSON.parse(row.data as string) : null,
    }));

    return Response.json(events);
  } catch (err) {
    console.error('[api/events] Query error:', err);
    return Response.json({ error: 'Failed to query events' }, { status: 500 });
  }
}
