/**
 * Smoke tests for the Minions SQLite engine.
 *
 * These cover the floor of the engine contract — schema bootstrap, basic
 * CRUD, idempotency uniqueness, advisory lock acquire/release — so a
 * regression in the engine surfaces before queue.ts or worker.ts run.
 *
 * Fuller behavioural tests (priority ordering, stall rescue, DAG
 * cascade) live in the Phase 1 test suite once queue.ts ports.
 */

import { describe, expect, it } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { unlinkSync, existsSync } from 'fs';

import { openSqliteEngine } from '../src/minions/index.js';

function tmpDb(): string {
  return join(tmpdir(), `soma-minions-test-${randomUUID()}.db`);
}

function cleanup(path: string): void {
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // ignore
    }
    // WAL files
    for (const suffix of ['-wal', '-shm']) {
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
}

describe('Minions SQLite engine', () => {
  it('bootstraps schema on open and supports basic CRUD', async () => {
    const path = tmpDb();
    const engine = openSqliteEngine({ path });
    try {
      const { lastInsertId, changes } = await engine.exec(
        'INSERT INTO minion_jobs (name, queue, priority, data) VALUES (?, ?, ?, ?)',
        ['sync', 'default', 0, JSON.stringify({ full: true })],
      );
      expect(changes).toBe(1);
      expect(lastInsertId).toBeGreaterThan(0);

      const row = await engine.one<{
        id: number;
        name: string;
        status: string;
        priority: number;
        data: string;
      }>('SELECT id, name, status, priority, data FROM minion_jobs WHERE id = ?', [
        lastInsertId,
      ]);
      expect(row).not.toBeNull();
      expect(row!.name).toBe('sync');
      expect(row!.status).toBe('waiting');
      expect(JSON.parse(row!.data)).toEqual({ full: true });
    } finally {
      await engine.close();
      cleanup(path);
    }
  });

  it('enforces idempotency_key uniqueness', async () => {
    const path = tmpDb();
    const engine = openSqliteEngine({ path });
    try {
      await engine.exec('INSERT INTO minion_jobs (name, idempotency_key) VALUES (?, ?)', [
        'first',
        'k1',
      ]);
      await expect(
        engine.exec('INSERT INTO minion_jobs (name, idempotency_key) VALUES (?, ?)', [
          'second',
          'k1',
        ]),
      ).rejects.toThrow(/UNIQUE|constraint/i);
    } finally {
      await engine.close();
      cleanup(path);
    }
  });

  it('acquires and releases a named advisory lock', async () => {
    const path = tmpDb();
    const engine = openSqliteEngine({ path });
    try {
      const release = await engine.acquireLock('claim', 1000);
      expect(typeof release).toBe('function');
      await release();

      // Second acquire should succeed after release
      const release2 = await engine.acquireLock('claim', 1000);
      await release2();
    } finally {
      await engine.close();
      cleanup(path);
    }
  });

  it('times out when lock is held', async () => {
    const path = tmpDb();
    const engine = openSqliteEngine({ path });
    try {
      const release = await engine.acquireLock('busy', 1000);
      try {
        await expect(engine.acquireLock('busy', 200)).rejects.toThrow(/timeout/i);
      } finally {
        await release();
      }
    } finally {
      await engine.close();
      cleanup(path);
    }
  });

  it('rolls back a failed transaction', async () => {
    const path = tmpDb();
    const engine = openSqliteEngine({ path });
    try {
      await expect(
        engine.tx(async (tx) => {
          await tx.exec('INSERT INTO minion_jobs (name) VALUES (?)', ['inside-tx']);
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      const rows = await engine.all<{ name: string }>(
        'SELECT name FROM minion_jobs WHERE name = ?',
        ['inside-tx'],
      );
      expect(rows).toHaveLength(0);
    } finally {
      await engine.close();
      cleanup(path);
    }
  });

  it('commits a successful transaction', async () => {
    const path = tmpDb();
    const engine = openSqliteEngine({ path });
    try {
      await engine.tx(async (tx) => {
        await tx.exec('INSERT INTO minion_jobs (name) VALUES (?)', ['commit-1']);
        await tx.exec('INSERT INTO minion_jobs (name) VALUES (?)', ['commit-2']);
      });
      const rows = await engine.all<{ name: string }>(
        "SELECT name FROM minion_jobs WHERE name LIKE 'commit-%' ORDER BY name",
      );
      expect(rows.map((r) => r.name)).toEqual(['commit-1', 'commit-2']);
    } finally {
      await engine.close();
      cleanup(path);
    }
  });

  it('auto-bumps updated_at via trigger', async () => {
    const path = tmpDb();
    const engine = openSqliteEngine({ path });
    try {
      const { lastInsertId } = await engine.exec(
        'INSERT INTO minion_jobs (name) VALUES (?)',
        ['touch-test'],
      );
      const first = await engine.one<{ updated_at: number }>(
        'SELECT updated_at FROM minion_jobs WHERE id = ?',
        [lastInsertId],
      );
      await new Promise((r) => setTimeout(r, 5));
      await engine.exec('UPDATE minion_jobs SET priority = ? WHERE id = ?', [5, lastInsertId]);
      const second = await engine.one<{ updated_at: number }>(
        'SELECT updated_at FROM minion_jobs WHERE id = ?',
        [lastInsertId],
      );
      expect(second!.updated_at).toBeGreaterThan(first!.updated_at);
    } finally {
      await engine.close();
      cleanup(path);
    }
  });
});
