/**
 * Built-in API-engine tools — Phase 1 minimal queue-internal set.
 *
 * Three tools, each thin wrapper over MinionQueue surface that's already
 * proven safe:
 *   - submit_minion    — enqueue a new (untrusted) child job
 *   - send_message     — write to one of THIS agent's children's inboxes
 *   - read_own_inbox   — read the calling job's unread inbox
 *
 * Untrusted by design: tools never set `allowProtectedSubmit`, so the
 * `shell` / `subagent` / `subagent_aggregator` names are blocked at the
 * MinionQueue.add() boundary. A subagent can submit `echo`, `noop`,
 * `sleep`, plus anything an operator has registered in `BUILTIN_HANDLERS`,
 * but cannot self-bootstrap a shell or another subagent without operator
 * intervention.
 *
 * No shell, no filesystem, no network — those expand the attack surface
 * and land with the brain layer + worktree isolation in later phases.
 */

import type { MinionQueue } from '../../../../queue.js';
import type { ApiToolDef } from '../types.js';
import { registerToolFactory } from './registry-leaf.js';

// ── submit_minion ───────────────────────────────────────────

const submitMinionFactory = (queue: MinionQueue): ApiToolDef => ({
  name: 'submit_minion',
  description:
    'Submit a new minion job to the durable queue. The job runs asynchronously; ' +
    'use `read_own_inbox` later to receive the child_done message when it completes. ' +
    'Returns the new job id and initial status.',
  input_schema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description:
          'Job handler name. Cannot be a protected name (shell, subagent, subagent_aggregator) — those require trusted submission via the operator CLI.',
      },
      data: {
        type: 'object',
        description: 'Handler-specific JSON data. Defaults to {}.',
        additionalProperties: true,
      },
      queue: {
        type: 'string',
        description: 'Queue to enqueue to. Defaults to "default".',
      },
      priority: {
        type: 'integer',
        description: 'Higher values claim sooner. Defaults to 0.',
      },
    },
    required: ['name'],
    additionalProperties: false,
  },
  // Two submissions of the same payload create two jobs — never idempotent.
  idempotent: false,
  async execute(rawInput, ctx) {
    const input = rawInput as {
      name?: unknown;
      data?: unknown;
      queue?: unknown;
      priority?: unknown;
    };
    if (typeof input.name !== 'string' || input.name.length === 0) {
      throw new Error('submit_minion: input.name is required (non-empty string)');
    }
    const data = (input.data && typeof input.data === 'object' ? input.data : {}) as Record<string, unknown>;
    const job = await queue.add(
      input.name,
      data,
      {
        queue: typeof input.queue === 'string' ? input.queue : undefined,
        priority: typeof input.priority === 'number' ? input.priority : undefined,
        parent_job_id: ctx.jobId,
      },
      // No `trusted` arg — submissions inherit the calling job's trust
      // boundary, which is "untrusted" for any model-driven tool call.
    );
    return { job_id: job.id, name: job.name, queue: job.queue, status: job.status };
  },
});

// ── send_message ────────────────────────────────────────────

const sendMessageFactory = (queue: MinionQueue): ApiToolDef => ({
  name: 'send_message',
  description:
    "Write a JSON payload to one of this agent's child jobs' inboxes. " +
    'The recipient must be a non-terminal child job (one this agent submitted via submit_minion). ' +
    'Returns the inserted message metadata, or null if the recipient was missing or terminal.',
  input_schema: {
    type: 'object',
    properties: {
      target_job_id: {
        type: 'integer',
        description: 'Recipient job id. Must be a child of the calling job.',
      },
      payload: {
        description: 'JSON value to deliver. Stored verbatim in the inbox row.',
      },
    },
    required: ['target_job_id', 'payload'],
    additionalProperties: false,
  },
  idempotent: false,
  async execute(rawInput, ctx) {
    const input = rawInput as { target_job_id?: unknown; payload?: unknown };
    if (typeof input.target_job_id !== 'number' || !Number.isInteger(input.target_job_id)) {
      throw new Error('send_message: input.target_job_id must be an integer');
    }
    if (input.payload === undefined) {
      throw new Error('send_message: input.payload is required');
    }
    // queue.sendMessage enforces parent-or-admin authorization; we send
    // as the caller's job-id-string so only this agent's children accept it.
    const msg = await queue.sendMessage(
      input.target_job_id,
      input.payload,
      String(ctx.jobId),
    );
    if (msg === null) {
      return { delivered: false, reason: 'recipient missing, terminal, or not a child of this job' };
    }
    return { delivered: true, message_id: msg.id, sent_at: msg.sent_at };
  },
});

// ── read_own_inbox ──────────────────────────────────────────

const readOwnInboxFactory = (_queue: MinionQueue): ApiToolDef => ({
  name: 'read_own_inbox',
  description:
    "Read this agent's unread inbox messages (typically `child_done` rollups from submitted minions). " +
    'Marks them as read so subsequent calls only see new entries.',
  input_schema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  // Idempotent in the read sense — but each call CONSUMES messages so
  // the second call sees a different snapshot. Mark non-idempotent so
  // crash-resumable replay never re-reads the inbox.
  idempotent: false,
  async execute(_input, ctx) {
    const messages = await ctx.readOwnInbox();
    return {
      count: messages.length,
      messages: messages.map((m) => ({
        id: m.id,
        sender: m.sender,
        payload: m.payload,
        sent_at: m.sent_at,
      })),
    };
  },
});

// ── Auto-register at module load ────────────────────────────

registerToolFactory('submit_minion', submitMinionFactory);
registerToolFactory('send_message', sendMessageFactory);
registerToolFactory('read_own_inbox', readOwnInboxFactory);

// Re-export factories so tests can build per-tool instances.
export { submitMinionFactory, sendMessageFactory, readOwnInboxFactory };
