/**
 * Minions — durable priority job queue for SOMA.
 *
 * Ported from gbrain (MIT © Garry Tan). See `./README.md` for port status
 * and deviations. Deviations from the original are annotated `// SOMA:`.
 *
 * Usage:
 *   const queue = new MinionQueue(engine);
 *   const job = await queue.add('sync', { full: true });
 *
 *   const worker = new MinionWorker(engine);
 *   worker.register('sync', async (ctx) => {
 *     // ...do work...
 *     return { pages_synced: 42 };
 *   });
 *   await worker.start();
 */

// --- Status & type unions ---

export type MinionJobStatus =
  | 'waiting'
  | 'active'
  | 'completed'
  | 'failed'
  | 'delayed'
  | 'dead'
  | 'cancelled'
  | 'waiting-children'
  | 'paused';

export type BackoffType = 'fixed' | 'exponential';

export type ChildFailPolicy = 'fail_parent' | 'remove_dep' | 'ignore' | 'continue';

// --- Job record ---
// SOMA: timestamps are Unix ms (number), not Date, so SQLite rows map 1:1.
// Caller-side code that wants a Date can `new Date(job.created_at)`.

export interface MinionJob {
  id: number;
  name: string;
  queue: string;
  status: MinionJobStatus;
  priority: number;
  data: Record<string, unknown>;

  max_attempts: number;
  attempts_made: number;
  attempts_started: number;
  backoff_type: BackoffType;
  backoff_delay: number;
  backoff_jitter: number;

  stalled_counter: number;
  max_stalled: number;
  lock_token: string | null;
  lock_until: number | null;

  delay_until: number | null;

  parent_job_id: number | null;
  on_child_fail: ChildFailPolicy;

  tokens_input: number;
  tokens_output: number;
  tokens_cache_read: number;

  depth: number;
  max_children: number | null;
  timeout_ms: number | null;
  timeout_at: number | null;
  remove_on_complete: boolean;
  remove_on_fail: boolean;
  idempotency_key: string | null;

  quiet_hours: Record<string, unknown> | null;
  stagger_key: string | null;

  result: Record<string, unknown> | null;
  progress: unknown | null;
  error_text: string | null;
  stacktrace: string[];

  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  updated_at: number;
}

// --- Input types ---

export interface MinionJobInput {
  name: string;
  data?: Record<string, unknown>;
  queue?: string;
  priority?: number;
  max_attempts?: number;
  backoff_type?: BackoffType;
  backoff_delay?: number;
  backoff_jitter?: number;
  /**
   * Per-job override for how many stall windows are tolerated before the
   * queue dead-letters the job. When omitted, the schema column DEFAULT
   * applies. Clamped to [1, 100] on insert.
   */
  max_stalled?: number;
  /** ms delay before eligible. */
  delay?: number;
  parent_job_id?: number;
  on_child_fail?: ChildFailPolicy;
  /** Cap on live (non-terminal) children of THIS job. NULL = unlimited. */
  max_children?: number;
  /** Wall-clock per-job deadline in ms. Terminal on expire (no retry). */
  timeout_ms?: number;
  remove_on_complete?: boolean;
  remove_on_fail?: boolean;
  /** Override the queue's maxSpawnDepth for THIS submission only. */
  max_spawn_depth?: number;
  /** Global dedup key. Same key returns the existing job, no second row created. */
  idempotency_key?: string;
  /** Claim-time gate. Jobs falling inside the window are deferred or skipped. */
  quiet_hours?: { start: number; end: number; tz: string; policy?: 'skip' | 'defer' };
  /** Hash-based minute-offset to decorrelate same-key jobs firing together. */
  stagger_key?: string;
}

export interface MinionQueueOpts {
  /** Max parent→child→... depth. Default 5. Enforced on add() with parent_job_id. */
  maxSpawnDepth?: number;
  /** Max attachment size in bytes. Default 5 MiB. */
  maxAttachmentBytes?: number;
}

export interface MinionWorkerOpts {
  queue?: string;
  concurrency?: number;
  lockDuration?: number;
  stalledInterval?: number;
  maxStalledCount?: number;
  pollInterval?: number;
}

// --- Job context (passed to handlers) ---

export interface MinionJobContext {
  id: number;
  name: string;
  data: Record<string, unknown>;
  attempts_made: number;
  /** AbortSignal for cooperative cancellation (timeout / cancel / pause / lock loss). */
  signal: AbortSignal;
  /** AbortSignal that fires only on worker SIGTERM/SIGINT. */
  shutdownSignal: AbortSignal;
  updateProgress(progress: unknown): Promise<void>;
  updateTokens(tokens: TokenUpdate): Promise<void>;
  log(message: string | TranscriptEntry): Promise<void>;
  isActive(): Promise<boolean>;
  readInbox(): Promise<InboxMessage[]>;
  /**
   * Job-scoped persistence for the API engine's multi-turn-with-tools loop.
   * Wired by the worker; the API engine consumes this without ever touching
   * the underlying QueueEngine. SOMA: scoped namespace mirrors the existing
   * scoped helpers (log, updateTokens, ...) — keeps SQL in queue.ts per
   * ADR-012 while letting the engine remain engine-agnostic.
   *
   * Optional on the type because non-API handlers (echo, noop, sleep, shell,
   * subscription) don't touch it and many tests construct ctx by hand. The
   * production worker always provides a real implementation; the api engine
   * asserts presence at runtime and throws UnrecoverableError when missing.
   */
  subagent?: SubagentApi;
}

// --- Subagent persistence (used by API engine, exposed via ctx.subagent) ---

/**
 * Provider-neutral content block. Mirrors the Anthropic Messages API shape
 * because it's a strict superset of the conversation primitives we need.
 * The OpenAI provider translates these to OpenAI's role-tagged messages at
 * its boundary; the canonical internal storage stays in this shape.
 */
export type SubagentContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface SubagentMessage {
  message_idx: number;
  role: 'user' | 'assistant';
  content_blocks: SubagentContentBlock[];
  tokens_in: number | null;
  tokens_out: number | null;
  tokens_cache_read: number | null;
  tokens_cache_create: number | null;
  model: string | null;
}

export type SubagentToolStatus = 'pending' | 'complete' | 'failed';

export interface SubagentToolExec {
  message_idx: number;
  tool_use_id: string;
  tool_name: string;
  input: unknown;
  status: SubagentToolStatus;
  output: unknown;
  error: string | null;
}

/**
 * Job-scoped API-engine persistence. Every method operates on the current
 * job (jobId is bound by the worker). All writes are append-only or
 * idempotent UPSERTs; replay-after-crash is the explicit design goal.
 */
export interface SubagentApi {
  /** Append a Messages-API-shaped message. ON CONFLICT (job_id, message_idx) DO NOTHING. */
  appendMessage(msg: SubagentMessage): Promise<void>;
  /** Load all persisted messages for this job in message_idx order. */
  loadMessages(): Promise<SubagentMessage[]>;
  /** Mark a tool dispatch as in-flight. ON CONFLICT (job_id, tool_use_id) DO NOTHING. */
  appendToolExecPending(args: {
    message_idx: number;
    tool_use_id: string;
    tool_name: string;
    input: unknown;
  }): Promise<void>;
  /** Settle an in-flight tool dispatch as complete with its output. */
  markToolExecComplete(args: { tool_use_id: string; output: unknown }): Promise<void>;
  /** Settle an in-flight tool dispatch (or insert a fresh failed row). */
  markToolExecFailed(args: {
    message_idx: number;
    tool_use_id: string;
    tool_name: string;
    input: unknown;
    error: string;
  }): Promise<void>;
  /** Load the tool ledger for this job (used by replay reconciliation). */
  loadToolExecs(): Promise<SubagentToolExec[]>;
}

export type MinionHandler = (job: MinionJobContext) => Promise<unknown>;

// --- Inbox ---

export interface InboxMessage {
  id: number;
  job_id: number;
  sender: string;
  payload: unknown;
  sent_at: number;
  read_at: number | null;
}

export function rowToInboxMessage(row: Record<string, unknown>): InboxMessage {
  return {
    id: row.id as number,
    job_id: row.job_id as number,
    sender: row.sender as string,
    payload: typeof row.payload === 'string' ? JSON.parse(row.payload as string) : row.payload,
    sent_at: row.sent_at as number,
    read_at: (row.read_at as number | null) ?? null,
  };
}

export type ChildOutcome = 'complete' | 'failed' | 'dead' | 'cancelled' | 'timeout';

export interface ChildDoneMessage {
  type: 'child_done';
  child_id: number;
  job_name: string;
  result: unknown;
  outcome?: ChildOutcome;
  error?: string | null;
}

// --- Attachments ---

export interface AttachmentInput {
  filename: string;
  content_type: string;
  /** Base64-encoded file bytes. Validated server-side. */
  content_base64: string;
}

export interface Attachment {
  id: number;
  job_id: number;
  filename: string;
  content_type: string;
  storage_uri: string | null;
  size_bytes: number;
  sha256: string;
  created_at: number;
}

export function rowToAttachment(row: Record<string, unknown>): Attachment {
  return {
    id: row.id as number,
    job_id: row.job_id as number,
    filename: row.filename as string,
    content_type: row.content_type as string,
    storage_uri: (row.storage_uri as string) || null,
    size_bytes: row.size_bytes as number,
    sha256: row.sha256 as string,
    created_at: row.created_at as number,
  };
}

// --- Token accounting ---

export interface TokenUpdate {
  input?: number;
  output?: number;
  cache_read?: number;
}

// --- Structured progress (convention, not enforced) ---

export interface AgentProgress {
  step: number;
  total: number;
  message: string;
  tokens_in: number;
  tokens_out: number;
  last_tool: string;
  started_at: string;
}

// --- Transcript entries ---

export type TranscriptEntry =
  | { type: 'log'; message: string; ts: string }
  | { type: 'tool_call'; tool: string; args_size: number; result_size: number; ts: string }
  | { type: 'llm_turn'; model: string; tokens_in: number; tokens_out: number; ts: string }
  | { type: 'error'; message: string; stack?: string; ts: string };

// --- Errors ---

/** Throw from a handler to skip retry and go straight to 'dead'. */
export class UnrecoverableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnrecoverableError';
  }
}

// --- Row mapping ---

export function rowToMinionJob(row: Record<string, unknown>): MinionJob {
  const parseJson = <T>(v: unknown, fallback: T): T => {
    if (v === null || v === undefined) return fallback;
    if (typeof v === 'string') {
      try {
        return JSON.parse(v) as T;
      } catch {
        return fallback;
      }
    }
    return v as T;
  };

  return {
    id: row.id as number,
    name: row.name as string,
    queue: row.queue as string,
    status: row.status as MinionJobStatus,
    priority: row.priority as number,
    data: parseJson<Record<string, unknown>>(row.data, {}),
    max_attempts: row.max_attempts as number,
    attempts_made: row.attempts_made as number,
    attempts_started: row.attempts_started as number,
    backoff_type: row.backoff_type as BackoffType,
    backoff_delay: row.backoff_delay as number,
    backoff_jitter: row.backoff_jitter as number,
    stalled_counter: row.stalled_counter as number,
    max_stalled: row.max_stalled as number,
    lock_token: (row.lock_token as string) || null,
    lock_until: (row.lock_until as number | null) ?? null,
    delay_until: (row.delay_until as number | null) ?? null,
    parent_job_id: (row.parent_job_id as number | null) ?? null,
    on_child_fail: row.on_child_fail as ChildFailPolicy,
    tokens_input: (row.tokens_input as number) ?? 0,
    tokens_output: (row.tokens_output as number) ?? 0,
    tokens_cache_read: (row.tokens_cache_read as number) ?? 0,
    depth: (row.depth as number) ?? 0,
    max_children: (row.max_children as number | null) ?? null,
    timeout_ms: (row.timeout_ms as number | null) ?? null,
    timeout_at: (row.timeout_at as number | null) ?? null,
    remove_on_complete: row.remove_on_complete === 1 || row.remove_on_complete === true,
    remove_on_fail: row.remove_on_fail === 1 || row.remove_on_fail === true,
    idempotency_key: (row.idempotency_key as string) || null,
    quiet_hours: parseJson<Record<string, unknown> | null>(row.quiet_hours, null),
    stagger_key: (row.stagger_key as string) || null,
    result: parseJson<Record<string, unknown> | null>(row.result, null),
    progress: parseJson<unknown>(row.progress, null),
    error_text: (row.error_text as string) || null,
    stacktrace: parseJson<string[]>(row.stacktrace, []),
    created_at: row.created_at as number,
    started_at: (row.started_at as number | null) ?? null,
    finished_at: (row.finished_at as number | null) ?? null,
    updated_at: row.updated_at as number,
  };
}
