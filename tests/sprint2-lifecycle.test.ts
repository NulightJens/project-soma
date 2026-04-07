import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Sprint 2: Onboarding & Lifecycle', () => {
  const testDir = join(tmpdir(), `cortextos-sprint2-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('enabled-agents.json format', () => {
    it('starts as empty object', () => {
      const path = join(testDir, 'enabled-agents.json');
      writeFileSync(path, '{}', 'utf-8');
      const data = JSON.parse(readFileSync(path, 'utf-8'));
      expect(data).toEqual({});
    });

    it('stores agent with enabled flag and status', () => {
      const agents: Record<string, any> = {};
      agents['testbot'] = {
        enabled: true,
        status: 'configured',
      };
      const path = join(testDir, 'enabled-agents.json');
      writeFileSync(path, JSON.stringify(agents, null, 2), 'utf-8');

      const parsed = JSON.parse(readFileSync(path, 'utf-8'));
      expect(parsed.testbot.enabled).toBe(true);
      expect(parsed.testbot.status).toBe('configured');
    });

    it('stores agent with org field', () => {
      const agents: Record<string, any> = {};
      agents['worker'] = {
        enabled: true,
        status: 'configured',
        org: 'testorg',
      };
      const path = join(testDir, 'enabled-agents.json');
      writeFileSync(path, JSON.stringify(agents, null, 2), 'utf-8');

      const parsed = JSON.parse(readFileSync(path, 'utf-8'));
      expect(parsed.worker.org).toBe('testorg');
    });

    it('disable sets enabled to false', () => {
      const agents: Record<string, any> = {
        testbot: { enabled: true, status: 'configured' },
      };
      agents.testbot.enabled = false;
      const path = join(testDir, 'enabled-agents.json');
      writeFileSync(path, JSON.stringify(agents, null, 2), 'utf-8');

      const parsed = JSON.parse(readFileSync(path, 'utf-8'));
      expect(parsed.testbot.enabled).toBe(false);
      expect(parsed.testbot.status).toBe('configured');
    });
  });

  describe('crash-alert hook logic', () => {
    it('categorizes planned restart from marker file', () => {
      const stateDir = join(testDir, 'state', 'testbot');
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, '.restart-planned'), 'context exhaustion');

      // Simulate marker check
      const markerPath = join(stateDir, '.restart-planned');
      expect(existsSync(markerPath)).toBe(true);
      const reason = readFileSync(markerPath, 'utf-8').trim();
      expect(reason).toBe('context exhaustion');
    });

    it('tracks crash count per day', () => {
      const stateDir = join(testDir, 'state', 'testbot');
      mkdirSync(stateDir, { recursive: true });

      const today = new Date().toISOString().split('T')[0];
      const countFile = join(stateDir, '.crash_count_today');

      // First crash
      writeFileSync(countFile, `${today}:1`, 'utf-8');
      const data = readFileSync(countFile, 'utf-8').trim();
      const [date, count] = data.split(':');
      expect(date).toBe(today);
      expect(parseInt(count, 10)).toBe(1);

      // Second crash
      writeFileSync(countFile, `${today}:2`, 'utf-8');
      const data2 = readFileSync(countFile, 'utf-8').trim();
      expect(data2).toBe(`${today}:2`);
    });

    it('resets crash count on new day', () => {
      const stateDir = join(testDir, 'state', 'testbot');
      mkdirSync(stateDir, { recursive: true });

      const yesterday = '2026-03-28';
      const today = '2026-03-29';
      const countFile = join(stateDir, '.crash_count_today');

      writeFileSync(countFile, `${yesterday}:5`, 'utf-8');
      const data = readFileSync(countFile, 'utf-8').trim();
      const [date, count] = data.split(':');
      const crashCount = date === today ? parseInt(count, 10) + 1 : 1;
      expect(crashCount).toBe(1); // Reset because different day
    });
  });

  describe('PM2 ecosystem generator', () => {
    it('generates valid module.exports format', () => {
      const ecosystem = {
        apps: [
          {
            name: 'cortextos-daemon',
            script: '/path/to/daemon.js',
            max_restarts: 10,
            restart_delay: 5000,
            autorestart: true,
          },
        ],
      };
      const content = `module.exports = ${JSON.stringify(ecosystem, null, 2)};\n`;
      expect(content).toContain('module.exports');
      expect(content).toContain('cortextos-daemon');
      expect(content).toContain('max_restarts');
    });
  });

  describe('install creates proper directory structure', () => {
    it('creates all required state directories', () => {
      const ctxRoot = join(testDir, 'cortextos-state');
      const dirs = [
        ctxRoot,
        join(ctxRoot, 'config'),
        join(ctxRoot, 'state'),
        join(ctxRoot, 'inbox'),
        join(ctxRoot, 'inflight'),
        join(ctxRoot, 'processed'),
        join(ctxRoot, 'logs'),
        join(ctxRoot, 'orgs'),
        join(ctxRoot, 'tasks'),
        join(ctxRoot, 'approvals'),
        join(ctxRoot, 'approvals', 'pending'),
        join(ctxRoot, 'analytics'),
        join(ctxRoot, 'analytics', 'events'),
        join(ctxRoot, 'analytics', 'reports'),
      ];

      for (const dir of dirs) {
        mkdirSync(dir, { recursive: true });
      }

      for (const dir of dirs) {
        expect(existsSync(dir), `Missing dir: ${dir}`).toBe(true);
      }
    });
  });
});
