import { NextRequest } from 'next/server';
import {
  getPendingApprovals,
  getResolvedApprovals,
} from '@/lib/data/approvals';
import { syncAll } from '@/lib/sync';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET /api/approvals - List approvals with optional filters
//
// Query params:
//   status   - "pending" (default) | "resolved" | "all"
//   org      - filter by org
//   agent    - filter by agent (resolved only)
//   category - filter by category (resolved only)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  try { syncAll(); } catch { /* best-effort */ }

  const status = searchParams.get('status') || 'pending';
  const org = searchParams.get('org') || undefined;
  const agent = searchParams.get('agent') || undefined;
  const category = searchParams.get('category') || undefined;

  try {
    let approvals;

    if (status === 'pending') {
      approvals = getPendingApprovals(org);
    } else if (status === 'resolved') {
      approvals = getResolvedApprovals(org, { agent, category });
    } else if (status === 'all') {
      const pending = getPendingApprovals(org);
      const resolved = getResolvedApprovals(org, { agent, category });
      approvals = [...pending, ...resolved];
    } else {
      return Response.json(
        { error: 'Invalid status. Must be one of: pending, resolved, all' },
        { status: 400 },
      );
    }

    return Response.json(approvals);
  } catch (err) {
    console.error('[api/approvals] GET error:', err);
    return Response.json(
      { error: 'Failed to fetch approvals' },
      { status: 500 },
    );
  }
}
