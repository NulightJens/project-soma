/**
 * Minions attachments — validation + CRUD round-trip.
 *
 * Two layers:
 *   1. Pure `validateAttachment` covers every rejection path (no DB).
 *   2. `MinionQueue.{add,list,get,delete}Attachment` covers the DB round-trip,
 *      the BLOB round-trip, the UNIQUE (job_id, filename) fence, and FK
 *      cascade when the parent job is removed.
 */

import { describe, expect, it } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID, createHash } from 'crypto';
import { unlinkSync, existsSync } from 'fs';

import {
  MinionQueue,
  openSqliteEngine,
  validateAttachment,
} from '../src/minions/index.js';
import type { QueueEngine } from '../src/minions/index.js';

function tmpPath(): string {
  return join(tmpdir(), `soma-attach-test-${randomUUID()}.db`);
}

function cleanup(path: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = path + suffix;
    if (existsSync(f)) {
      try {
        unlinkSync(f);
      } catch {
        // ignore
      }
    }
  }
}

async function withQueue<T>(
  fn: (q: MinionQueue, e: QueueEngine) => Promise<T>,
  opts: { maxAttachmentBytes?: number } = {},
): Promise<T> {
  const path = tmpPath();
  const engine = openSqliteEngine({ path });
  const queue = new MinionQueue(engine, {
    maxAttachmentBytes: opts.maxAttachmentBytes,
  });
  try {
    return await fn(queue, engine);
  } finally {
    await engine.close();
    cleanup(path);
  }
}

function b64(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64');
}

describe('validateAttachment — pure validation', () => {
  const opts = { maxBytes: 1024 };

  it('accepts a well-formed attachment and computes sha256 + size', () => {
    const result = validateAttachment(
      {
        filename: 'report.txt',
        content_type: 'text/plain',
        content_base64: b64('hello'),
      },
      opts,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.normalized.filename).toBe('report.txt');
    expect(result.normalized.content_type).toBe('text/plain');
    expect(result.normalized.size_bytes).toBe(5);
    expect(result.normalized.sha256).toBe(
      createHash('sha256').update('hello').digest('hex'),
    );
  });

  it.each([
    ['', 'filename is required'],
    ['   ', 'filename is required'],
    ['../secrets', 'invalid characters'],
    ['a/b.txt', 'invalid characters'],
    ['a\\b.txt', 'invalid characters'],
    ['has\0null.txt', 'invalid characters'],
  ])('rejects bad filename %j', (filename, expected) => {
    const result = validateAttachment(
      { filename, content_type: 'text/plain', content_base64: b64('x') },
      opts,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(expected);
  });

  it('rejects missing or malformed content_type', () => {
    const r1 = validateAttachment(
      { filename: 'a.txt', content_type: '', content_base64: b64('x') },
      opts,
    );
    expect(r1.ok).toBe(false);
    const r2 = validateAttachment(
      { filename: 'a.txt', content_type: 'notamime', content_base64: b64('x') },
      opts,
    );
    expect(r2.ok).toBe(false);
  });

  it('rejects empty or non-base64 content', () => {
    const r1 = validateAttachment(
      { filename: 'a.txt', content_type: 'text/plain', content_base64: '' },
      opts,
    );
    expect(r1.ok).toBe(false);
    const r2 = validateAttachment(
      {
        filename: 'a.txt',
        content_type: 'text/plain',
        content_base64: 'hello world!',
      },
      opts,
    );
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.error).toMatch(/invalid characters/);
  });

  it('rejects size over the cap', () => {
    const big = 'A'.repeat(2000);
    const result = validateAttachment(
      {
        filename: 'big.txt',
        content_type: 'text/plain',
        content_base64: Buffer.from(big, 'utf-8').toString('base64'),
      },
      { maxBytes: 1024 },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/exceeds maxBytes/);
  });

  it('rejects an in-flight duplicate filename via existingFilenames', () => {
    const result = validateAttachment(
      { filename: 'dup.txt', content_type: 'text/plain', content_base64: b64('x') },
      { maxBytes: 1024, existingFilenames: new Set(['dup.txt']) },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/already exists/);
  });
});

describe('MinionQueue — attachment CRUD', () => {
  it('round-trips bytes, sha256, and size through add → get', async () => {
    await withQueue(async (q) => {
      const job = await q.add('sync');
      const payload = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x10, 0x20]);
      const meta = await q.addAttachment(job.id, {
        filename: 'blob.bin',
        content_type: 'application/octet-stream',
        content_base64: payload.toString('base64'),
      });
      expect(meta.filename).toBe('blob.bin');
      expect(meta.size_bytes).toBe(payload.length);
      expect(meta.sha256).toBe(
        createHash('sha256').update(payload).digest('hex'),
      );

      const fetched = await q.getAttachment(job.id, 'blob.bin');
      expect(fetched).not.toBeNull();
      expect(fetched?.meta.id).toBe(meta.id);
      expect(Buffer.isBuffer(fetched?.bytes)).toBe(true);
      expect(fetched?.bytes.equals(payload)).toBe(true);
    });
  });

  it('list orders by created_at asc and excludes bytes', async () => {
    await withQueue(async (q) => {
      const job = await q.add('sync');
      await q.addAttachment(job.id, {
        filename: 'a.txt',
        content_type: 'text/plain',
        content_base64: b64('first'),
      });
      await q.addAttachment(job.id, {
        filename: 'b.txt',
        content_type: 'text/plain',
        content_base64: b64('second'),
      });
      const listed = await q.listAttachments(job.id);
      expect(listed.map((a) => a.filename)).toEqual(['a.txt', 'b.txt']);
      // Metadata only — Attachment type has no bytes field.
      for (const a of listed) {
        expect(a.size_bytes).toBeGreaterThan(0);
      }
    });
  });

  it('getAttachment returns null for unknown filename', async () => {
    await withQueue(async (q) => {
      const job = await q.add('sync');
      expect(await q.getAttachment(job.id, 'missing.txt')).toBeNull();
    });
  });

  it('delete removes a single attachment and leaves siblings intact', async () => {
    await withQueue(async (q) => {
      const job = await q.add('sync');
      await q.addAttachment(job.id, {
        filename: 'a.txt',
        content_type: 'text/plain',
        content_base64: b64('aaa'),
      });
      await q.addAttachment(job.id, {
        filename: 'b.txt',
        content_type: 'text/plain',
        content_base64: b64('bbb'),
      });
      expect(await q.deleteAttachment(job.id, 'a.txt')).toBe(true);
      expect(await q.deleteAttachment(job.id, 'a.txt')).toBe(false);
      const remaining = await q.listAttachments(job.id);
      expect(remaining.map((a) => a.filename)).toEqual(['b.txt']);
    });
  });

  it('rejects duplicate filename via the in-memory pre-check', async () => {
    await withQueue(async (q) => {
      const job = await q.add('sync');
      await q.addAttachment(job.id, {
        filename: 'dup.txt',
        content_type: 'text/plain',
        content_base64: b64('one'),
      });
      await expect(
        q.addAttachment(job.id, {
          filename: 'dup.txt',
          content_type: 'text/plain',
          content_base64: b64('two'),
        }),
      ).rejects.toThrow(/already exists/);
    });
  });

  it('rejects oversize attachments at the queue boundary', async () => {
    await withQueue(
      async (q) => {
        const job = await q.add('sync');
        await expect(
          q.addAttachment(job.id, {
            filename: 'big.bin',
            content_type: 'application/octet-stream',
            content_base64: Buffer.alloc(200).toString('base64'),
          }),
        ).rejects.toThrow(/exceeds maxBytes/);
      },
      { maxAttachmentBytes: 128 },
    );
  });

  it('rejects when the job does not exist', async () => {
    await withQueue(async (q) => {
      await expect(
        q.addAttachment(9999, {
          filename: 'x.txt',
          content_type: 'text/plain',
          content_base64: b64('x'),
        }),
      ).rejects.toThrow(/not found/);
    });
  });

  it('cascades on job removal (FK ON DELETE CASCADE)', async () => {
    await withQueue(async (q) => {
      const job = await q.add('sync');
      await q.addAttachment(job.id, {
        filename: 'a.txt',
        content_type: 'text/plain',
        content_base64: b64('hello'),
      });
      expect((await q.listAttachments(job.id)).length).toBe(1);

      // removeJob requires a terminal status — cancel first, then remove.
      await q.cancelJob(job.id);
      expect(await q.removeJob(job.id)).toBe(true);
      expect((await q.listAttachments(job.id)).length).toBe(0);
    });
  });
});
