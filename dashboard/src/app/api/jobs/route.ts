import { NextRequest } from 'next/server';
import { listJobs, getQueueStats, type MinionJobStatus } from '@/lib/data/minions';

export const dynamic = 'force-dynamic';

const VALID_STATUSES: MinionJobStatus[] = [
  'waiting',
  'active',
  'completed',
  'failed',
  'delayed',
  'dead',
  'cancelled',
  'waiting-children',
  'paused',
];

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const statusRaw = searchParams.get('status');
  const status = statusRaw && VALID_STATUSES.includes(statusRaw as MinionJobStatus)
    ? (statusRaw as MinionJobStatus)
    : undefined;
  const queueName = searchParams.get('queue') || undefined;
  const name = searchParams.get('name') || undefined;
  const limitRaw = Number(searchParams.get('limit') || '100');
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100;

  try {
    const [jobs, stats] = [
      listJobs({ status, queue: queueName, name, limit }),
      getQueueStats(),
    ];
    return Response.json({ jobs, stats });
  } catch (err) {
    console.error('[api/jobs] GET error:', err);
    return Response.json({ error: 'Failed to read jobs' }, { status: 500 });
  }
}
