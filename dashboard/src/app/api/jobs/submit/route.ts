/**
 * POST /api/jobs/submit — untrusted submission entry point.
 *
 * Per ADR-014, the dashboard is an UNTRUSTED submitter — never sets
 * `--trusted` on the CLI (and therefore never `allowProtectedSubmit: true`
 * on MinionQueue.add). Submissions of `shell` / `subagent` /
 * `subagent_aggregator` bounce at the queue's protected-name gate, and
 * the UI surfaces the equivalent CLI command for the operator instead of
 * silently failing.
 *
 * Implementation: validates the input shape client-side and server-side,
 * then shells out to `cortextos jobs submit` so the authoritative
 * state-machine logic stays in queue.ts (mirrors the cancel/retry pattern
 * already in lib/data/minions.ts).
 */

import { NextRequest } from 'next/server';
import { runCli } from '@/lib/data/cortextos-cli';
import { isProtectedJobName } from './protected-names';

export const dynamic = 'force-dynamic';

interface SubmitInput {
  name: string;
  data?: Record<string, unknown>;
  queue?: string;
  priority?: number;
  delay?: number;
  max_attempts?: number;
  idempotency_key?: string;
}

function validate(body: unknown): { ok: true; input: SubmitInput } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'body must be a JSON object' };
  const b = body as Record<string, unknown>;

  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (name.length === 0) return { ok: false, error: 'name is required (non-empty string)' };
  if (name.length > 200) return { ok: false, error: 'name is too long (max 200 chars)' };

  const data = b.data === undefined
    ? {}
    : typeof b.data === 'object' && b.data !== null && !Array.isArray(b.data)
      ? b.data as Record<string, unknown>
      : null;
  if (data === null) return { ok: false, error: 'data must be a JSON object' };

  const queue = b.queue === undefined ? undefined : typeof b.queue === 'string' ? b.queue : null;
  if (queue === null) return { ok: false, error: 'queue must be a string' };

  const priority = b.priority === undefined ? undefined : typeof b.priority === 'number' && Number.isInteger(b.priority) ? b.priority : null;
  if (priority === null) return { ok: false, error: 'priority must be an integer' };

  const delay = b.delay === undefined ? undefined : typeof b.delay === 'number' && Number.isFinite(b.delay) && b.delay >= 0 ? b.delay : null;
  if (delay === null) return { ok: false, error: 'delay must be a non-negative number (ms)' };

  const max_attempts = b.max_attempts === undefined ? undefined : typeof b.max_attempts === 'number' && Number.isInteger(b.max_attempts) && b.max_attempts >= 1 ? b.max_attempts : null;
  if (max_attempts === null) return { ok: false, error: 'max_attempts must be a positive integer' };

  const idempotency_key = b.idempotency_key === undefined ? undefined : typeof b.idempotency_key === 'string' ? b.idempotency_key : null;
  if (idempotency_key === null) return { ok: false, error: 'idempotency_key must be a string' };

  return { ok: true, input: { name, data, queue, priority, delay, max_attempts, idempotency_key } };
}

function buildCliArgs(input: SubmitInput): string[] {
  const args: string[] = ['jobs', 'submit', input.name, '--data', JSON.stringify(input.data ?? {}), '--json'];
  if (input.queue) args.push('--queue', input.queue);
  if (input.priority !== undefined) args.push('--priority', String(input.priority));
  if (input.delay !== undefined) args.push('--delay', String(input.delay));
  if (input.max_attempts !== undefined) args.push('--max-attempts', String(input.max_attempts));
  if (input.idempotency_key) args.push('--idempotency-key', input.idempotency_key);
  // No --trusted — dashboard is untrusted by design (ADR-014).
  return args;
}

/**
 * Construct the operator-facing equivalent CLI command. Used by the UI
 * when a submission is gated by the protected-name check, so the operator
 * can copy/paste the right command into a terminal.
 */
function equivalentCliCommand(input: SubmitInput, trusted: boolean): string {
  const parts = ['soma', 'jobs', 'submit', JSON.stringify(input.name), '--data', JSON.stringify(JSON.stringify(input.data ?? {}))];
  if (input.queue) parts.push('--queue', JSON.stringify(input.queue));
  if (input.priority !== undefined) parts.push('--priority', String(input.priority));
  if (input.delay !== undefined) parts.push('--delay', String(input.delay));
  if (input.max_attempts !== undefined) parts.push('--max-attempts', String(input.max_attempts));
  if (input.idempotency_key) parts.push('--idempotency-key', JSON.stringify(input.idempotency_key));
  if (trusted) parts.push('--trusted');
  return parts.join(' ');
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const v = validate(body);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });

  // Protected-name gate at the surface — return 422 with an
  // operator-actionable CLI command rather than letting the queue's
  // gate throw a generic error after a process spawn.
  if (isProtectedJobName(v.input.name)) {
    return Response.json(
      {
        error: 'protected_job_name',
        detail:
          `Job name '${v.input.name}' is protected (high-stakes / RCE-adjacent). ` +
          `Submit from the operator CLI with --trusted, not the dashboard.`,
        cli_command: equivalentCliCommand(v.input, true),
      },
      { status: 422 },
    );
  }

  const cli = await runCli(buildCliArgs(v.input));
  if (!cli.ok) {
    return Response.json(
      { error: 'cli_submit_failed', detail: cli.stderr.trim().slice(0, 1000) },
      { status: 500 },
    );
  }

  // The CLI emits the new job as JSON when --json is passed.
  try {
    const job = JSON.parse(cli.stdout);
    return Response.json({ job });
  } catch {
    return Response.json(
      { error: 'cli_output_unparseable', detail: cli.stdout.slice(0, 500) },
      { status: 500 },
    );
  }
}
