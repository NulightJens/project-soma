/**
 * `cortextos jobs` — operator CLI for the Minions durable priority queue.
 *
 * Trusted submitter per ADR-014: sets `{allowProtectedSubmit: true}` when
 * `--trusted` is passed, enabling submission of protected names (`shell`,
 * `subagent`, `subagent_aggregator`). Never set by the dashboard or
 * Telegram surfaces.
 *
 * Output follows ADR-014: plain-language primary view, raw JSON only on
 * `--json`. Keeps internals structured and full-fidelity behind the flag;
 * default surface is readable by a non-technical operator.
 */

import { Command } from 'commander';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import {
  MinionQueue,
  MinionWorker,
  openSqliteEngine,
  type MinionJob,
  type MinionJobStatus,
  type QueueEngine,
} from '../minions/index.js';

interface SharedOpts {
  instance?: string;
  db?: string;
  json?: boolean;
}

function resolveDbPath(opts: SharedOpts): string {
  if (opts.db) return opts.db;
  const instance = opts.instance || process.env.CTX_INSTANCE_ID || 'default';
  const dir = join(homedir(), '.cortextos', instance);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, 'minions.db');
}

function openQueue(opts: SharedOpts): { engine: QueueEngine; queue: MinionQueue; dbPath: string } {
  const dbPath = resolveDbPath(opts);
  const engine = openSqliteEngine({ path: dbPath });
  const queue = new MinionQueue(engine);
  return { engine, queue, dbPath };
}

function parseJsonArg(raw: string | undefined, field: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('expected a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (e) {
    throw new Error(`--${field}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function formatAge(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 1000) return 'just now';
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

function plainJob(job: MinionJob): string {
  const lines: string[] = [];
  lines.push(`Job #${job.id} — ${job.name} [${job.status}]`);
  lines.push(`  Queue:    ${job.queue}   Priority: ${job.priority}   Attempt ${job.attempts_made}/${job.max_attempts}`);
  lines.push(`  Created:  ${formatAge(job.created_at)}  (${new Date(job.created_at).toISOString()})`);
  if (job.started_at) {
    lines.push(`  Started:  ${formatAge(job.started_at)}`);
  }
  if (job.finished_at) {
    lines.push(`  Finished: ${formatAge(job.finished_at)}`);
  }
  if (job.delay_until && job.status === 'delayed') {
    const wait = job.delay_until - Date.now();
    lines.push(`  Resumes:  in ~${Math.max(0, Math.round(wait / 1000))}s`);
  }
  if (job.error_text) {
    lines.push(`  Error:    ${truncate(job.error_text, 200)}`);
  }
  if (job.result) {
    const summary = truncate(JSON.stringify(job.result), 160);
    lines.push(`  Result:   ${summary}`);
  }
  lines.push(`  (Use --json for full detail.)`);
  return lines.join('\n');
}

function plainJobList(jobs: MinionJob[]): string {
  if (jobs.length === 0) return 'No jobs matched.';
  const header = 'ID     STATUS             NAME                 PRIORITY  CREATED';
  const rows = jobs.map((j) => {
    const id = String(j.id).padEnd(6);
    const status = j.status.padEnd(18);
    const name = truncate(j.name, 19).padEnd(21);
    const prio = String(j.priority).padEnd(9);
    const created = formatAge(j.created_at);
    return `${id} ${status} ${name} ${prio} ${created}`;
  });
  return [header, ...rows].join('\n');
}

// ---------------------------------------------------------------------------
// submit
// ---------------------------------------------------------------------------

const submitCommand = new Command('submit')
  .description('Submit a new job to the queue')
  .argument('<name>', 'Job type / handler name (e.g. sync, echo, shell)')
  .option('--data <json>', "Job payload as JSON (e.g. '{\"url\":\"...\"}')")
  .option('--queue <name>', 'Queue name', 'default')
  .option('--priority <n>', 'Priority (lower = higher urgency)', '0')
  .option('--delay <ms>', 'Delay before eligible, in ms')
  .option('--max-attempts <n>', 'Maximum retry attempts', '3')
  .option('--idempotency-key <key>', 'Dedup key — same key returns the existing job')
  .option('--trusted', 'Allow submission of protected job names (shell/subagent/subagent_aggregator)')
  .option('--instance <id>', 'cortextos instance id')
  .option('--db <path>', 'Override Minions SQLite path')
  .option('--json', 'Output raw job JSON instead of a summary')
  .action(async (name: string, options: SharedOpts & {
    data?: string;
    queue?: string;
    priority?: string;
    delay?: string;
    maxAttempts?: string;
    idempotencyKey?: string;
    trusted?: boolean;
  }) => {
    const { engine, queue } = openQueue(options);
    try {
      const data = parseJsonArg(options.data, 'data');
      const priority = Number(options.priority ?? 0);
      if (!Number.isInteger(priority)) throw new Error('--priority must be an integer');
      const delay = options.delay !== undefined ? Number(options.delay) : undefined;
      if (delay !== undefined && !Number.isFinite(delay)) throw new Error('--delay must be a number (ms)');
      const maxAttempts = Number(options.maxAttempts ?? 3);
      if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
        throw new Error('--max-attempts must be a positive integer');
      }

      const job = await queue.add(
        name,
        data,
        {
          queue: options.queue,
          priority,
          max_attempts: maxAttempts,
          delay,
          idempotency_key: options.idempotencyKey,
        },
        options.trusted ? { allowProtectedSubmit: true } : undefined,
      );

      if (options.json) {
        console.log(JSON.stringify(job, null, 2));
      } else {
        console.log(`Submitted job #${job.id} (${job.name}) to queue "${job.queue}".`);
        console.log(`Status: ${job.status}. Track with: cortextos jobs get ${job.id}`);
      }
    } catch (e) {
      console.error(`submit failed: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    } finally {
      await engine.close();
    }
  });

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

const listCommand = new Command('list')
  .description('List jobs, most recent first')
  .option('--status <s>', 'Filter by status (waiting, active, completed, failed, delayed, dead, cancelled, waiting-children, paused)')
  .option('--queue <name>', 'Filter by queue')
  .option('--name <jobname>', 'Filter by job name')
  .option('--limit <n>', 'Max rows to return', '50')
  .option('--instance <id>', 'cortextos instance id')
  .option('--db <path>', 'Override Minions SQLite path')
  .option('--json', 'Output raw job JSON instead of a summary')
  .action(async (options: SharedOpts & {
    status?: MinionJobStatus;
    queue?: string;
    name?: string;
    limit?: string;
  }) => {
    const { engine, queue } = openQueue(options);
    try {
      const limit = Number(options.limit ?? 50);
      if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer');

      const jobs = await queue.getJobs({
        status: options.status,
        queue: options.queue,
        name: options.name,
        limit,
      });

      if (options.json) {
        console.log(JSON.stringify(jobs, null, 2));
      } else {
        console.log(plainJobList(jobs));
      }
    } catch (e) {
      console.error(`list failed: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    } finally {
      await engine.close();
    }
  });

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

const getCommand = new Command('get')
  .description('Show one job in detail')
  .argument('<id>', 'Job id')
  .option('--instance <id>', 'cortextos instance id')
  .option('--db <path>', 'Override Minions SQLite path')
  .option('--json', 'Output raw job JSON instead of a summary')
  .action(async (idStr: string, options: SharedOpts) => {
    const { engine, queue } = openQueue(options);
    try {
      const id = Number(idStr);
      if (!Number.isInteger(id)) throw new Error('id must be an integer');
      const job = await queue.getJob(id);
      if (!job) {
        console.error(`No job with id ${id}.`);
        process.exitCode = 1;
        return;
      }
      if (options.json) {
        console.log(JSON.stringify(job, null, 2));
      } else {
        console.log(plainJob(job));
      }
    } finally {
      await engine.close();
    }
  });

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------

const cancelCommand = new Command('cancel')
  .description('Cancel a job and cascade-cancel its descendants')
  .argument('<id>', 'Job id')
  .option('--instance <id>', 'cortextos instance id')
  .option('--db <path>', 'Override Minions SQLite path')
  .option('--json', 'Output raw job JSON instead of a summary')
  .action(async (idStr: string, options: SharedOpts) => {
    const { engine, queue } = openQueue(options);
    try {
      const id = Number(idStr);
      if (!Number.isInteger(id)) throw new Error('id must be an integer');
      const job = await queue.cancelJob(id);
      if (!job) {
        console.error(`Job ${id} not found or already terminal.`);
        process.exitCode = 1;
        return;
      }
      if (options.json) {
        console.log(JSON.stringify(job, null, 2));
      } else {
        console.log(`Cancelled job #${job.id} (${job.name}). Descendants cascaded.`);
      }
    } finally {
      await engine.close();
    }
  });

// ---------------------------------------------------------------------------
// retry
// ---------------------------------------------------------------------------

const retryCommand = new Command('retry')
  .description('Re-queue a failed / dead / cancelled job for another attempt')
  .argument('<id>', 'Job id')
  .option('--instance <id>', 'cortextos instance id')
  .option('--db <path>', 'Override Minions SQLite path')
  .option('--json', 'Output raw job JSON instead of a summary')
  .action(async (idStr: string, options: SharedOpts) => {
    const { engine, queue } = openQueue(options);
    try {
      const id = Number(idStr);
      if (!Number.isInteger(id)) throw new Error('id must be an integer');
      const job = await queue.retryJob(id);
      if (!job) {
        console.error(`Job ${id} not eligible for retry (must be failed/dead/cancelled).`);
        process.exitCode = 1;
        return;
      }
      if (options.json) {
        console.log(JSON.stringify(job, null, 2));
      } else {
        console.log(`Re-queued job #${job.id} (${job.name}). Status: ${job.status}.`);
      }
    } finally {
      await engine.close();
    }
  });

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------

const statsCommand = new Command('stats')
  .description('Summary of job counts by status')
  .option('--instance <id>', 'cortextos instance id')
  .option('--db <path>', 'Override Minions SQLite path')
  .option('--json', 'Output raw stats JSON')
  .action(async (options: SharedOpts) => {
    const { engine, queue } = openQueue(options);
    try {
      const stats = await queue.getStats();
      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log('Job counts by status:');
        for (const [status, count] of Object.entries(stats.by_status)) {
          console.log(`  ${status.padEnd(18)} ${count}`);
        }
        console.log('');
        console.log(`Queue health — waiting: ${stats.queue_health.waiting}, active: ${stats.queue_health.active}, stalled: ${stats.queue_health.stalled}`);
        if (stats.by_type.length > 0) {
          console.log('');
          console.log('Per-type (last 24h):');
          console.log('  NAME                 TOTAL  OK    FAIL  DEAD  AVG-DUR-MS');
          for (const row of stats.by_type) {
            const name = truncate(row.name, 19).padEnd(20);
            const total = String(row.total).padEnd(5);
            const ok = String(row.completed).padEnd(5);
            const fail = String(row.failed).padEnd(5);
            const dead = String(row.dead).padEnd(5);
            const avg = row.avg_duration_ms != null ? String(row.avg_duration_ms) : '—';
            console.log(`  ${name} ${total}  ${ok} ${fail} ${dead} ${avg}`);
          }
        }
      }
    } finally {
      await engine.close();
    }
  });

// ---------------------------------------------------------------------------
// work
// ---------------------------------------------------------------------------

const workCommand = new Command('work')
  .description('Run a worker: claim and execute jobs until SIGTERM/SIGINT')
  .option('--queue <name>', 'Queue to pull from', 'default')
  .option('--concurrency <n>', 'Max concurrent in-flight jobs', '1')
  .option('--lock-duration <ms>', 'Lock hold time per job in ms', '30000')
  .option('--poll-interval <ms>', 'Poll interval when the queue is empty, in ms', '2000')
  .option('--stalled-interval <ms>', 'Stall-sweep cadence in ms', '30000')
  .option('--handlers <names>', 'Comma-separated list of built-in handlers to register (echo only for now)', 'echo')
  .option('--instance <id>', 'cortextos instance id')
  .option('--db <path>', 'Override Minions SQLite path')
  .action(async (options: SharedOpts & {
    queue?: string;
    concurrency?: string;
    lockDuration?: string;
    pollInterval?: string;
    stalledInterval?: string;
    handlers?: string;
  }) => {
    const { engine } = openQueue(options);
    const concurrency = Number(options.concurrency ?? 1);
    const lockDuration = Number(options.lockDuration ?? 30_000);
    const pollInterval = Number(options.pollInterval ?? 2_000);
    const stalledInterval = Number(options.stalledInterval ?? 30_000);

    const worker = new MinionWorker(engine, {
      queue: options.queue,
      concurrency,
      lockDuration,
      pollInterval,
      stalledInterval,
    });

    const requested = (options.handlers ?? 'echo').split(',').map((s) => s.trim()).filter(Boolean);
    for (const name of requested) {
      const handler = BUILTIN_HANDLERS[name];
      if (!handler) {
        console.error(`Unknown built-in handler: "${name}". Available: ${Object.keys(BUILTIN_HANDLERS).join(', ')}`);
        process.exitCode = 1;
        await engine.close();
        return;
      }
      worker.register(name, handler);
    }

    console.log(`Minion worker starting (queue=${options.queue}, concurrency=${concurrency}, handlers=${requested.join(',')})...`);
    try {
      await worker.start();
    } finally {
      await engine.close();
    }
  });

// ---------------------------------------------------------------------------
// built-in handlers (slot B — trivial echo)
// ---------------------------------------------------------------------------

import { BUILTIN_HANDLERS } from './job-handlers.js';

// ---------------------------------------------------------------------------
// entrypoint
// ---------------------------------------------------------------------------

export const jobsCommand = new Command('jobs')
  .description('Minions queue — submit, inspect, and execute jobs')
  .addCommand(submitCommand)
  .addCommand(listCommand)
  .addCommand(getCommand)
  .addCommand(cancelCommand)
  .addCommand(retryCommand)
  .addCommand(statsCommand)
  .addCommand(workCommand);
