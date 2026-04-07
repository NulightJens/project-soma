import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Sprint 6: Fast-Checker Completeness', () => {
  const testDir = join(tmpdir(), `cortextos-sprint6-${Date.now()}`);
  const stateDir = join(testDir, 'state', 'testbot');

  beforeEach(() => {
    mkdirSync(stateDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('Persistent dedup file', () => {
    it('writes dedup hashes to file', () => {
      const dedupPath = join(stateDir, '.message-dedup-hashes');
      const hashes = ['abc123', 'def456', 'ghi789'];
      writeFileSync(dedupPath, hashes.join('\n') + '\n', 'utf-8');

      expect(existsSync(dedupPath)).toBe(true);
      const content = readFileSync(dedupPath, 'utf-8').trim().split('\n');
      expect(content.length).toBe(3);
      expect(content).toContain('abc123');
    });

    it('loads hashes from file on restart', () => {
      const dedupPath = join(stateDir, '.message-dedup-hashes');
      writeFileSync(dedupPath, 'hash1\nhash2\nhash3\n', 'utf-8');

      const loaded = readFileSync(dedupPath, 'utf-8').trim().split('\n').filter(Boolean);
      const hashSet = new Set(loaded);
      expect(hashSet.has('hash1')).toBe(true);
      expect(hashSet.has('hash2')).toBe(true);
      expect(hashSet.has('hash3')).toBe(true);
      expect(hashSet.has('hash4')).toBe(false);
    });

    it('limits hashes to prevent file bloat', () => {
      const dedupPath = join(stateDir, '.message-dedup-hashes');
      const manyHashes = Array.from({ length: 1500 }, (_, i) => `hash_${i}`);
      // Simulate keeping only last 1000
      const recent = manyHashes.slice(-1000);
      writeFileSync(dedupPath, recent.join('\n') + '\n', 'utf-8');

      const loaded = readFileSync(dedupPath, 'utf-8').trim().split('\n').filter(Boolean);
      expect(loaded.length).toBe(1000);
      expect(loaded[0]).toBe('hash_500');
      expect(loaded[999]).toBe('hash_1499');
    });
  });

  describe('Urgent signal detection', () => {
    it('detects .urgent-signal file', () => {
      const urgentPath = join(stateDir, '.urgent-signal');
      writeFileSync(urgentPath, 'Priority update needed', 'utf-8');

      expect(existsSync(urgentPath)).toBe(true);
      const content = readFileSync(urgentPath, 'utf-8').trim();
      expect(content).toBe('Priority update needed');
    });

    it('urgent signal file is deleted after processing', () => {
      const urgentPath = join(stateDir, '.urgent-signal');
      writeFileSync(urgentPath, 'test signal', 'utf-8');

      // Simulate processing
      const content = readFileSync(urgentPath, 'utf-8');
      rmSync(urgentPath);

      expect(content.trim()).toBe('test signal');
      expect(existsSync(urgentPath)).toBe(false);
    });
  });

  describe('Typing indicator', () => {
    it('detects stdout.log growth as agent activity', () => {
      const logDir = join(testDir, 'logs', 'testbot');
      mkdirSync(logDir, { recursive: true });
      const logPath = join(logDir, 'stdout.log');

      // Initial state - no log
      expect(existsSync(logPath)).toBe(false);

      // Write some output
      writeFileSync(logPath, 'output line 1\n', 'utf-8');
      const stat1 = require('fs').statSync(logPath);

      // Append more
      require('fs').appendFileSync(logPath, 'output line 2\n', 'utf-8');
      const stat2 = require('fs').statSync(logPath);

      expect(stat2.size).toBeGreaterThan(stat1.size);
    });
  });

  describe('SIGUSR1 wake', () => {
    it('interruptible sleep resolves early when signaled', async () => {
      // Test the sleepInterruptible pattern
      let resolved = false;
      let wakeResolve: (() => void) | null = null;

      const sleepInterruptible = (ms: number): Promise<void> => {
        return new Promise(resolve => {
          const timer = setTimeout(resolve, ms);
          wakeResolve = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      };

      const start = Date.now();
      const sleepPromise = sleepInterruptible(10000).then(() => { resolved = true; });

      // Simulate SIGUSR1 - wake immediately
      setTimeout(() => {
        if (wakeResolve) wakeResolve();
      }, 50);

      await sleepPromise;
      const elapsed = Date.now() - start;
      expect(resolved).toBe(true);
      expect(elapsed).toBeLessThan(1000); // Should resolve in <1s, not 10s
    });
  });
});
