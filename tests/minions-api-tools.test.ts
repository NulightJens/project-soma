/**
 * Tool registry + built-in tools tests.
 *
 * Covers: registry leaf-module API, default-tool resolution with allow-list
 * filter, the 3 built-in tools' behaviour against a real MinionQueue +
 * SQLite engine (no mocking — exercises the actual queue/inbox SQL).
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { openSqliteEngine } from '../src/minions/engine-sqlite.js';
import { MinionQueue } from '../src/minions/queue.js';
import type { QueueEngine } from '../src/minions/engine.js';
import type { ApiToolContext, ApiToolDef } from '../src/minions/handlers/engines/api/types.js';
import {
  registerToolFactory,
  listToolFactories,
  resetToolFactoriesForTests,
  bindToolRegistryQueue,
  unbindToolRegistryQueueForTests,
  getBoundQueueForTests,
  getDefaultTools,
} from '../src/minions/handlers/engines/api/tools/registry.js';
import {
  submitMinionFactory,
  sendMessageFactory,
  readOwnInboxFactory,
} from '../src/minions/handlers/engines/api/tools/builtin.js';

// ── Test fixtures ────────────────────────────────────────────

interface Scope {
  engine: QueueEngine;
  queue: MinionQueue;
  cleanup: () => Promise<void>;
}

async function setup(): Promise<Scope> {
  const engine = await openSqliteEngine({ path: ':memory:' });
  const queue = new MinionQueue(engine);
  return { engine, queue, cleanup: () => engine.close() };
}

function makeToolCtx(jobId: number, queue: MinionQueue, lockToken?: string): ApiToolContext {
  return {
    jobId,
    signal: new AbortController().signal,
    readOwnInbox: () => (lockToken ? queue.readInbox(jobId, lockToken) : Promise.resolve([])),
  };
}

// ── Registry tests ───────────────────────────────────────────

describe('tools — registry', () => {
  // Save the production builtins around each test so registry-mutating
  // tests don't bleed into others.
  let saved: Array<{ name: string; factory: import('../src/minions/handlers/engines/api/tools/registry.js').ToolFactory }> = [];

  beforeEach(() => {
    // Snapshot via getDefaultTools while the queue is bound to a throwaway.
    saved = [];
    for (const name of listToolFactories()) {
      // The factory itself isn't reachable via the public API — we re-import
      // it from builtin.ts. For non-builtin tests this is fine; the suite
      // restores the 3 known factories after each test.
    }
    resetToolFactoriesForTests();
  });

  afterEach(() => {
    resetToolFactoriesForTests();
    registerToolFactory('submit_minion', submitMinionFactory);
    registerToolFactory('send_message', sendMessageFactory);
    registerToolFactory('read_own_inbox', readOwnInboxFactory);
  });

  it('rejects duplicate factory registration', () => {
    registerToolFactory('thing', submitMinionFactory);
    expect(() => registerToolFactory('thing', submitMinionFactory)).toThrow(/already registered/);
  });

  it('listToolFactories returns sorted names', () => {
    registerToolFactory('zebra', submitMinionFactory);
    registerToolFactory('alpha', submitMinionFactory);
    expect(listToolFactories()).toEqual(['alpha', 'zebra']);
  });

  it('getDefaultTools returns [] when no queue is bound', () => {
    registerToolFactory('a', submitMinionFactory);
    expect(getBoundQueueForTests()).toBeNull();
    expect(getDefaultTools()).toEqual([]);
  });

  it('getDefaultTools materialises factories when a queue is bound', async () => {
    const scope = await setup();
    bindToolRegistryQueue(scope.queue);
    registerToolFactory('a', submitMinionFactory);
    registerToolFactory('b', sendMessageFactory);
    const tools = getDefaultTools();
    expect(tools.map((t) => t.name)).toEqual(['submit_minion', 'send_message']);
    unbindToolRegistryQueueForTests();
    await scope.cleanup();
  });

  it('getDefaultTools filters by allowed list', async () => {
    const scope = await setup();
    bindToolRegistryQueue(scope.queue);
    registerToolFactory('a', submitMinionFactory);
    registerToolFactory('b', sendMessageFactory);
    registerToolFactory('c', readOwnInboxFactory);
    const tools = getDefaultTools({ allowed: ['a', 'c'] });
    expect(tools.map((t) => t.name).sort()).toEqual(['read_own_inbox', 'submit_minion']);
    unbindToolRegistryQueueForTests();
    await scope.cleanup();
  });

  it('getDefaultTools accepts an explicit queue (test override)', async () => {
    const scope = await setup();
    registerToolFactory('a', submitMinionFactory);
    const tools = getDefaultTools({ queue: scope.queue });
    expect(tools.map((t) => t.name)).toEqual(['submit_minion']);
    expect(getBoundQueueForTests()).toBeNull();
    await scope.cleanup();
  });
});

// ── submit_minion tests ──────────────────────────────────────

describe('tools — submit_minion', () => {
  it('enqueues a child job under the calling job', async () => {
    const scope = await setup();
    const parent = await scope.queue.add('subagent', {}, undefined, { allowProtectedSubmit: true });
    const tool = submitMinionFactory(scope.queue);
    const ctx = makeToolCtx(parent.id, scope.queue);
    const result = await tool.execute({ name: 'echo', data: { msg: 'hi' } }, ctx) as {
      job_id: number;
      name: string;
      status: string;
    };
    expect(result.name).toBe('echo');
    expect(result.status).toBe('waiting');
    const child = await scope.queue.getJob(result.job_id);
    expect(child!.parent_job_id).toBe(parent.id);
    await scope.cleanup();
  });

  it('rejects protected job names (untrusted submitter)', async () => {
    const scope = await setup();
    const parent = await scope.queue.add('subagent', {}, undefined, { allowProtectedSubmit: true });
    const tool = submitMinionFactory(scope.queue);
    await expect(
      tool.execute({ name: 'shell', data: { cmd: 'ls' } }, makeToolCtx(parent.id, scope.queue)),
    ).rejects.toThrow(/protected job name/);
    await scope.cleanup();
  });

  it('validates input.name', async () => {
    const scope = await setup();
    const parent = await scope.queue.add('subagent', {}, undefined, { allowProtectedSubmit: true });
    const tool = submitMinionFactory(scope.queue);
    await expect(
      tool.execute({ name: '' }, makeToolCtx(parent.id, scope.queue)),
    ).rejects.toThrow(/input.name is required/);
    await expect(
      tool.execute({}, makeToolCtx(parent.id, scope.queue)),
    ).rejects.toThrow(/input.name is required/);
    await scope.cleanup();
  });

  it('forwards optional queue + priority', async () => {
    const scope = await setup();
    const parent = await scope.queue.add('subagent', {}, undefined, { allowProtectedSubmit: true });
    const tool = submitMinionFactory(scope.queue);
    const result = await tool.execute(
      { name: 'echo', data: {}, queue: 'priority', priority: 7 },
      makeToolCtx(parent.id, scope.queue),
    ) as { job_id: number };
    const child = await scope.queue.getJob(result.job_id);
    expect(child!.queue).toBe('priority');
    expect(child!.priority).toBe(7);
    await scope.cleanup();
  });

  it('is non-idempotent', () => {
    expect(submitMinionFactory({} as MinionQueue).idempotent).toBe(false);
  });
});

// ── send_message tests ───────────────────────────────────────

describe('tools — send_message', () => {
  it('delivers payload to a child job inbox; sender is the calling job', async () => {
    const scope = await setup();
    const parent = await scope.queue.add('subagent', {}, undefined, { allowProtectedSubmit: true });
    const child = await scope.queue.add('echo', {}, { parent_job_id: parent.id });
    const tool = sendMessageFactory(scope.queue);
    const ctx = makeToolCtx(parent.id, scope.queue);
    const result = await tool.execute(
      { target_job_id: child.id, payload: { kind: 'hello', n: 1 } },
      ctx,
    ) as { delivered: boolean; message_id: number };
    expect(result.delivered).toBe(true);
    expect(result.message_id).toBeGreaterThan(0);

    // Confirm it landed in the child's inbox under the right sender.
    const claim = await scope.queue.claim('w-1', 30000, 'default', ['echo']);
    const inbox = await scope.queue.readInbox(claim!.id, claim!.lock_token!);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].sender).toBe(String(parent.id));
    expect(inbox[0].payload).toEqual({ kind: 'hello', n: 1 });
    await scope.cleanup();
  });

  it('returns delivered:false when target is not a child of the caller', async () => {
    const scope = await setup();
    const me = await scope.queue.add('subagent', {}, undefined, { allowProtectedSubmit: true });
    const stranger = await scope.queue.add('echo', {});  // no parent
    const tool = sendMessageFactory(scope.queue);
    const result = await tool.execute(
      { target_job_id: stranger.id, payload: 'hi' },
      makeToolCtx(me.id, scope.queue),
    ) as { delivered: boolean };
    expect(result.delivered).toBe(false);
    await scope.cleanup();
  });

  it('validates target_job_id and payload', async () => {
    const scope = await setup();
    const me = await scope.queue.add('subagent', {}, undefined, { allowProtectedSubmit: true });
    const tool = sendMessageFactory(scope.queue);
    await expect(
      tool.execute({ target_job_id: 'nope', payload: 'x' }, makeToolCtx(me.id, scope.queue)),
    ).rejects.toThrow(/target_job_id must be an integer/);
    await expect(
      tool.execute({ target_job_id: 1 }, makeToolCtx(me.id, scope.queue)),
    ).rejects.toThrow(/payload is required/);
    await scope.cleanup();
  });
});

// ── read_own_inbox tests ─────────────────────────────────────

describe('tools — read_own_inbox', () => {
  it('returns inbox messages by going through ctx.readOwnInbox', async () => {
    const scope = await setup();
    const job = await scope.queue.add('subagent', {}, undefined, { allowProtectedSubmit: true });
    // Claim the job so we have a lock token that readInbox needs.
    const claim = await scope.queue.claim('w-1', 30000, 'default', ['subagent']);
    expect(claim!.id).toBe(job.id);
    // Inject an inbox row directly via sendMessage from 'admin'.
    await scope.queue.sendMessage(job.id, { hello: 'world' }, 'admin');

    const tool = readOwnInboxFactory(scope.queue);
    const ctx = makeToolCtx(job.id, scope.queue, claim!.lock_token!);
    const result = await tool.execute({}, ctx) as { count: number; messages: unknown[] };
    expect(result.count).toBe(1);

    // Subsequent call sees an empty inbox (messages now marked read).
    const result2 = await tool.execute({}, ctx) as { count: number };
    expect(result2.count).toBe(0);
    await scope.cleanup();
  });

  it('input_schema accepts only an empty object', () => {
    const tool = readOwnInboxFactory({} as MinionQueue);
    expect(tool.input_schema).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
  });
});

// ── Loop integration: data.tools = undefined → registry default ──

describe('api engine loop — default tool resolution', () => {
  it('uses getDefaultTools when data.tools is absent', async () => {
    // Indirect verification: bind a queue + registry with one factory,
    // call getDefaultTools, confirm what comes out matches what the loop
    // would receive. The loop's main happy-path tests in
    // minions-api-engine.test.ts already cover the dispatch wiring.
    const scope = await setup();
    bindToolRegistryQueue(scope.queue);
    const tools = getDefaultTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'read_own_inbox',
      'send_message',
      'submit_minion',
    ]);
    unbindToolRegistryQueueForTests();
    await scope.cleanup();
  });
});
