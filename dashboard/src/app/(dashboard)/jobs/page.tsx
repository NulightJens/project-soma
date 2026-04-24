/**
 * Jobs (Minions queue) dashboard route.
 *
 * Per ADR-014 (user-facing edge filters both directions):
 *   - Primary view = plain-language summaries. Row-level: "N minutes
 *     ago, echo job completed, returned 'hello'" rather than raw JSON.
 *   - Progressive disclosure: clicking a row opens a detail sheet with
 *     a human-readable summary up top + a "Raw JSON" toggle at the
 *     bottom that reveals the full structured record for the technical
 *     operator.
 *
 * This surface is an **untrusted submitter** — it never sets
 * `{allowProtectedSubmit: true}` when/if the submit form later lands.
 * Mutations (cancel / retry) route through the `cortextos jobs` CLI
 * so the authoritative state-machine logic stays in queue.ts.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  IconRefresh,
  IconCircleCheck,
  IconCircleX,
  IconCircleDot,
  IconClock,
  IconAlertCircle,
  IconHourglass,
  IconPlayerPause,
  IconCode,
  IconRotateClockwise2,
} from '@tabler/icons-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

interface MinionJob {
  id: number;
  name: string;
  queue: string;
  status: string;
  priority: number;
  data: Record<string, unknown>;
  max_attempts: number;
  attempts_made: number;
  stalled_counter: number;
  lock_until: number | null;
  delay_until: number | null;
  parent_job_id: number | null;
  tokens_input: number;
  tokens_output: number;
  tokens_cache_read: number;
  timeout_ms: number | null;
  idempotency_key: string | null;
  result: Record<string, unknown> | null;
  error_text: string | null;
  stacktrace: string[];
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  updated_at: number;
}

interface QueueStats {
  by_status: Record<string, number>;
  total: number;
  stalled: number;
}

const STATUS_FILTERS: Array<{ label: string; value: string | null }> = [
  { label: 'All', value: null },
  { label: 'Waiting', value: 'waiting' },
  { label: 'Active', value: 'active' },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed', value: 'failed' },
  { label: 'Delayed', value: 'delayed' },
  { label: 'Dead', value: 'dead' },
  { label: 'Cancelled', value: 'cancelled' },
];

function formatAge(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 1000) return 'just now';
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

function StatusIcon({ status }: { status: string }) {
  const icon = (() => {
    switch (status) {
      case 'completed':
        return IconCircleCheck;
      case 'active':
        return IconCircleDot;
      case 'waiting':
        return IconClock;
      case 'delayed':
        return IconHourglass;
      case 'waiting-children':
        return IconHourglass;
      case 'paused':
        return IconPlayerPause;
      case 'failed':
        return IconAlertCircle;
      case 'dead':
      case 'cancelled':
        return IconCircleX;
      default:
        return IconCircleDot;
    }
  })();
  const Icon = icon;
  return <Icon size={16} className={cn('shrink-0', statusToneClass(status))} />;
}

function statusToneClass(status: string): string {
  switch (status) {
    case 'completed':
      return 'text-[var(--soma-fg)]';
    case 'active':
      return 'text-[var(--soma-accent)]';
    case 'waiting':
    case 'delayed':
    case 'waiting-children':
    case 'paused':
      return 'text-[var(--soma-fg-muted)]';
    case 'failed':
    case 'dead':
    case 'cancelled':
      return 'text-[var(--soma-fg-muted)]';
    default:
      return 'text-[var(--soma-fg)]';
  }
}

/**
 * Build a one-line plain-language summary of a job. Internal detail
 * (raw JSON, stacktrace, token counters, internal IDs) stays out of
 * this string — that's the progressive-disclosure layer.
 */
function summarise(job: MinionJob): string {
  const age = formatAge(job.created_at);
  const name = job.name;
  switch (job.status) {
    case 'completed': {
      const hint =
        job.result && Object.keys(job.result).length > 0
          ? describeResult(job.result)
          : 'finished cleanly';
      return `${name} completed ${age} — ${hint}`;
    }
    case 'active': {
      const since = job.started_at ? formatAge(job.started_at) : age;
      return `${name} running since ${since} (attempt ${job.attempts_made + 1}/${job.max_attempts})`;
    }
    case 'waiting':
      return `${name} waiting to run (queued ${age}, priority ${job.priority})`;
    case 'delayed': {
      if (!job.delay_until) return `${name} delayed`;
      const wait = job.delay_until - Date.now();
      if (wait > 0) {
        return `${name} retrying in ~${Math.max(1, Math.round(wait / 1000))}s (attempt ${job.attempts_made + 1}/${job.max_attempts})`;
      }
      return `${name} ready to retry (attempt ${job.attempts_made + 1}/${job.max_attempts})`;
    }
    case 'failed':
      return `${name} failed ${age}${job.error_text ? ` — ${job.error_text.slice(0, 80)}` : ''}`;
    case 'dead':
      return `${name} dead-lettered ${age}${job.error_text ? ` — ${job.error_text.slice(0, 80)}` : ''}`;
    case 'cancelled':
      return `${name} cancelled ${age}${job.error_text ? ` — ${job.error_text.slice(0, 80)}` : ''}`;
    case 'waiting-children':
      return `${name} waiting on children to finish`;
    case 'paused':
      return `${name} paused (manual hold)`;
    default:
      return `${name} (${job.status}) — ${age}`;
  }
}

function describeResult(result: Record<string, unknown>): string {
  const keys = Object.keys(result);
  if (keys.length === 0) return 'returned nothing';
  if (keys.length === 1) {
    const k = keys[0];
    const v = result[k];
    if (v == null) return `returned ${k}=null`;
    if (typeof v === 'string') return `${k}: ${v.slice(0, 60)}`;
    if (typeof v === 'number' || typeof v === 'boolean') return `${k}: ${v}`;
    if (Array.isArray(v)) return `${k}: array of ${v.length}`;
    return `${k}: <object>`;
  }
  return `returned ${keys.length} fields`;
}

function canCancel(status: string): boolean {
  return ['waiting', 'active', 'delayed', 'waiting-children', 'paused'].includes(status);
}

function canRetry(status: string): boolean {
  return ['failed', 'dead', 'cancelled'].includes(status);
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<MinionJob[]>([]);
  const [stats, setStats] = useState<QueueStats>({ by_status: {}, total: 0, stalled: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<MinionJob | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);
  const [actionPending, setActionPending] = useState(false);

  const fetchJobs = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    try {
      setError(null);
      const res = await fetch(`/api/jobs?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { jobs: MinionJob[]; stats: QueueStats };
      setJobs(body.jobs);
      setStats(body.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchJobs();
    const timer = setInterval(fetchJobs, 5_000);
    return () => clearInterval(timer);
  }, [fetchJobs]);

  const openDetail = (job: MinionJob) => {
    setSelected(job);
    setShowRawJson(false);
    setSheetOpen(true);
  };

  const runAction = async (action: 'cancel' | 'retry') => {
    if (!selected) return;
    setActionPending(true);
    try {
      const res = await fetch(`/api/jobs/${selected.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (body.job) setSelected(body.job);
      await fetchJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionPending(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
        <span className="text-sm text-[var(--soma-fg-muted)]">
          Minions queue — {stats.total} total, {stats.stalled} stalled
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchJobs}
            disabled={loading}
            className="gap-1.5"
          >
            <IconRefresh size={16} />
            Refresh
          </Button>
        </div>
      </header>

      <nav className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((f) => {
          const active = (f.value ?? null) === statusFilter;
          const count = f.value ? stats.by_status[f.value] ?? 0 : stats.total;
          return (
            <button
              key={f.label}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                active
                  ? 'border-[var(--soma-fg)] bg-[var(--soma-surface-strong)] text-[var(--soma-fg)]'
                  : 'border-[var(--soma-border)] text-[var(--soma-fg-muted)] hover:border-[var(--soma-fg-muted)]',
              )}
            >
              {f.label}
              <span className="tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </nav>

      {error && (
        <div className="rounded-md border border-[var(--soma-border)] bg-[var(--soma-surface)] p-3 text-sm text-[var(--soma-fg-muted)]">
          Could not load jobs: {error}
          <div className="mt-1 text-xs">
            If this is a fresh install, the queue DB (<code className="text-[var(--soma-fg)]">~/.cortextos/&lt;instance&gt;/minions.db</code>) is created on first submit.
          </div>
        </div>
      )}

      <Card className="flex-1 overflow-hidden p-0">
        {loading && jobs.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-sm text-[var(--soma-fg-muted)]">
            Loading…
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-sm">
            <span className="text-[var(--soma-fg-muted)]">No jobs match this filter.</span>
            <span className="text-xs text-[var(--soma-fg-muted)]">
              Submit one with: <code className="text-[var(--soma-fg)]">cortextos jobs submit echo --data {`'{"msg":"hi"}'`}</code>
            </span>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--soma-border)]">
            {jobs.map((job) => (
              <li key={job.id}>
                <button
                  type="button"
                  onClick={() => openDetail(job)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--soma-surface-strong)]"
                >
                  <div className="pt-0.5">
                    <StatusIcon status={job.status} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-[var(--soma-fg-muted)]">
                        #{job.id}
                      </span>
                      <span className="truncate text-sm">{summarise(job)}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--soma-fg-muted)]">
                      <span>queue: {job.queue}</span>
                      <span>priority: {job.priority}</span>
                      {job.idempotency_key && <span>idempotency: {job.idempotency_key}</span>}
                      {job.tokens_input + job.tokens_output > 0 && (
                        <span>
                          tokens: {job.tokens_input}/{job.tokens_output}
                        </span>
                      )}
                    </div>
                  </div>
                  <Badge variant="outline" className="shrink-0 font-mono uppercase">
                    {job.status}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full max-w-xl overflow-y-auto sm:max-w-xl">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <StatusIcon status={selected.status} />
                  Job #{selected.id} — {selected.name}
                </SheetTitle>
                <SheetDescription>{summarise(selected)}</SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-5 text-sm">
                <section className="space-y-1">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--soma-fg-muted)]">
                    At a glance
                  </h3>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    <dt className="text-[var(--soma-fg-muted)]">Status</dt>
                    <dd className="font-mono">{selected.status}</dd>

                    <dt className="text-[var(--soma-fg-muted)]">Queue</dt>
                    <dd>{selected.queue}</dd>

                    <dt className="text-[var(--soma-fg-muted)]">Priority</dt>
                    <dd>{selected.priority}</dd>

                    <dt className="text-[var(--soma-fg-muted)]">Attempts</dt>
                    <dd>
                      {selected.attempts_made} / {selected.max_attempts}
                    </dd>

                    <dt className="text-[var(--soma-fg-muted)]">Created</dt>
                    <dd>
                      {formatAge(selected.created_at)} ({new Date(selected.created_at).toISOString()})
                    </dd>

                    {selected.started_at && (
                      <>
                        <dt className="text-[var(--soma-fg-muted)]">Started</dt>
                        <dd>{formatAge(selected.started_at)}</dd>
                      </>
                    )}

                    {selected.finished_at && (
                      <>
                        <dt className="text-[var(--soma-fg-muted)]">Finished</dt>
                        <dd>{formatAge(selected.finished_at)}</dd>
                      </>
                    )}

                    {selected.parent_job_id && (
                      <>
                        <dt className="text-[var(--soma-fg-muted)]">Parent job</dt>
                        <dd className="font-mono">#{selected.parent_job_id}</dd>
                      </>
                    )}
                  </dl>
                </section>

                {selected.error_text && (
                  <section className="space-y-1.5">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--soma-fg-muted)]">
                      Last error
                    </h3>
                    <pre className="whitespace-pre-wrap rounded-md border border-[var(--soma-border)] bg-[var(--soma-surface)] p-3 text-xs">
                      {selected.error_text}
                    </pre>
                  </section>
                )}

                {selected.result && Object.keys(selected.result).length > 0 && (
                  <section className="space-y-1.5">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--soma-fg-muted)]">
                      Result
                    </h3>
                    <pre className="whitespace-pre-wrap rounded-md border border-[var(--soma-border)] bg-[var(--soma-surface)] p-3 text-xs">
                      {JSON.stringify(selected.result, null, 2)}
                    </pre>
                  </section>
                )}

                {selected.stacktrace.length > 0 && (
                  <section className="space-y-1.5">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--soma-fg-muted)]">
                      Transcript ({selected.stacktrace.length} entries)
                    </h3>
                    <ul className="space-y-1 rounded-md border border-[var(--soma-border)] bg-[var(--soma-surface)] p-3 text-xs">
                      {selected.stacktrace.map((entry, i) => (
                        <li key={i} className="font-mono">
                          {entry}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <Separator />

                <section>
                  <button
                    type="button"
                    onClick={() => setShowRawJson((v) => !v)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--soma-fg-muted)] hover:text-[var(--soma-fg)]"
                  >
                    <IconCode size={14} />
                    {showRawJson ? 'Hide raw JSON' : 'Show raw JSON'}
                  </button>
                  {showRawJson && (
                    <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--soma-border)] bg-[var(--soma-surface)] p-3 text-[11px]">
                      {JSON.stringify(selected, null, 2)}
                    </pre>
                  )}
                </section>

                <div className="flex gap-2 pt-2">
                  {canCancel(selected.status) && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={actionPending}
                      onClick={() => runAction('cancel')}
                    >
                      Cancel job
                    </Button>
                  )}
                  {canRetry(selected.status) && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={actionPending}
                      onClick={() => runAction('retry')}
                      className="gap-1.5"
                    >
                      <IconRotateClockwise2 size={14} />
                      Retry
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
