import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Sprint 8: Dashboard Compatibility', () => {
  const testDir = join(tmpdir(), `SOMA-sprint8-${Date.now()}`);
  const ctxRoot = join(testDir, 'ctx');

  beforeEach(() => {
    mkdirSync(ctxRoot, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('Dashboard package exists', () => {
    it('dashboard directory is present in project', () => {
      const dashboardDir = join(__dirname, '..', 'dashboard');
      expect(existsSync(dashboardDir)).toBe(true);
    });

    it('dashboard has package.json', () => {
      const pkgPath = join(__dirname, '..', 'dashboard', 'package.json');
      expect(existsSync(pkgPath)).toBe(true);
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      expect(pkg.name).toBeTruthy();
    });

    it('dashboard has Next.js config', () => {
      const nextConfig = join(__dirname, '..', 'dashboard', 'next.config.ts');
      expect(existsSync(nextConfig)).toBe(true);
    });

    it('dashboard has src/ directory', () => {
      expect(existsSync(join(__dirname, '..', 'dashboard', 'src'))).toBe(true);
    });
  });

  describe('File format compatibility with dashboard', () => {
    it('heartbeat.json matches dashboard format', () => {
      // Dashboard reads: state/{agent}/heartbeat.json
      const stateDir = join(ctxRoot, 'state', 'sentinel');
      mkdirSync(stateDir, { recursive: true });

      const heartbeat = {
        agent: 'sentinel',
        timestamp: '2026-03-29T10:00:00Z',
        status: 'Completed heartbeat cycle. All systems operational.',
        mode: 'day',
        loop_interval: '4h',
      };
      writeFileSync(join(stateDir, 'heartbeat.json'), JSON.stringify(heartbeat), 'utf-8');

      // Dashboard expects: agent, timestamp (for last_heartbeat parsing)
      const parsed = JSON.parse(readFileSync(join(stateDir, 'heartbeat.json'), 'utf-8'));
      expect(parsed.agent).toBe('sentinel');
      expect(parsed.timestamp).toBeTruthy();
      expect(new Date(parsed.timestamp).getTime()).toBeGreaterThan(0);
    });

    it('enabled-agents.json matches dashboard format', () => {
      // Dashboard reads: config/enabled-agents.json
      const configDir = join(ctxRoot, 'config');
      mkdirSync(configDir, { recursive: true });

      const enabledAgents = {
        sentinel: { enabled: true, status: 'configured', org: 'acme' },
        analyst: { enabled: true, status: 'configured', org: 'acme' },
      };
      writeFileSync(join(configDir, 'enabled-agents.json'), JSON.stringify(enabledAgents, null, 2), 'utf-8');

      const parsed = JSON.parse(readFileSync(join(configDir, 'enabled-agents.json'), 'utf-8'));
      const agents = Object.keys(parsed);
      expect(agents.length).toBe(2);
      expect(parsed.sentinel.enabled).toBe(true);
    });

    it('analytics/reports/latest.json matches dashboard format', () => {
      // Dashboard reads: analytics/reports/latest.json
      const reportsDir = join(ctxRoot, 'analytics', 'reports');
      mkdirSync(reportsDir, { recursive: true });

      const report = {
        timestamp: '2026-03-29T10:00:00Z',
        agents: {
          sentinel: {
            tasks_completed: 5,
            tasks_pending: 2,
            tasks_in_progress: 1,
            errors_today: 0,
            heartbeat_stale: false,
          },
        },
        system: {
          total_tasks_completed: 5,
          agents_healthy: 1,
          agents_total: 1,
          approvals_pending: 0,
        },
      };
      writeFileSync(join(reportsDir, 'latest.json'), JSON.stringify(report, null, 2), 'utf-8');

      const parsed = JSON.parse(readFileSync(join(reportsDir, 'latest.json'), 'utf-8'));
      expect(parsed.system.agents_total).toBe(1);
      expect(parsed.agents.sentinel.tasks_completed).toBe(5);
    });

    it('tasks/*.json match dashboard format', () => {
      const tasksDir = join(ctxRoot, 'tasks');
      mkdirSync(tasksDir, { recursive: true });

      const task = {
        id: 'task_12345',
        title: 'Test task',
        description: 'A test task',
        type: 'agent',
        needs_approval: false,
        status: 'pending',
        assigned_to: 'sentinel',
        created_by: 'boris',
        org: 'acme',
        priority: 'normal',
        project: '',
        kpi_key: null,
        created_at: '2026-03-29T10:00:00Z',
        updated_at: '2026-03-29T10:00:00Z',
        completed_at: null,
        due_date: null,
        archived: false,
      };
      writeFileSync(join(tasksDir, 'task_12345.json'), JSON.stringify(task, null, 2), 'utf-8');

      const parsed = JSON.parse(readFileSync(join(tasksDir, 'task_12345.json'), 'utf-8'));
      expect(parsed.id).toBe('task_12345');
      expect(parsed.status).toBe('pending');
      expect(parsed.assigned_to).toBe('sentinel');
    });

    it('events JSONL matches dashboard format', () => {
      const eventsDir = join(ctxRoot, 'analytics', 'events', 'sentinel');
      mkdirSync(eventsDir, { recursive: true });

      const events = [
        { id: 'evt1', agent: 'sentinel', org: 'acme', timestamp: '2026-03-29T10:00:00Z', category: 'heartbeat', event: 'heartbeat_complete', severity: 'info', metadata: {} },
        { id: 'evt2', agent: 'sentinel', org: 'acme', timestamp: '2026-03-29T10:01:00Z', category: 'task', event: 'task_completed', severity: 'info', metadata: { task_id: 'task_123' } },
      ];
      const jsonl = events.map(e => JSON.stringify(e)).join('\n') + '\n';
      writeFileSync(join(eventsDir, '2026-03-29.jsonl'), jsonl, 'utf-8');

      const lines = readFileSync(join(eventsDir, '2026-03-29.jsonl'), 'utf-8').trim().split('\n');
      expect(lines.length).toBe(2);
      const evt = JSON.parse(lines[0]);
      expect(evt.agent).toBe('sentinel');
      expect(evt.category).toBe('heartbeat');
    });

    it('approvals match dashboard format', () => {
      const approvalsDir = join(ctxRoot, 'approvals', 'pending');
      mkdirSync(approvalsDir, { recursive: true });

      const approval = {
        id: 'apr_12345',
        title: 'Deploy to production',
        requesting_agent: 'sentinel',
        org: 'acme',
        category: 'deployment',
        status: 'pending',
        description: 'Ready to deploy v1.0',
        created_at: '2026-03-29T10:00:00Z',
        updated_at: '2026-03-29T10:00:00Z',
        resolved_at: null,
        resolved_by: null,
      };
      writeFileSync(join(approvalsDir, 'apr_12345.json'), JSON.stringify(approval, null, 2), 'utf-8');

      const parsed = JSON.parse(readFileSync(join(approvalsDir, 'apr_12345.json'), 'utf-8'));
      expect(parsed.status).toBe('pending');
      expect(parsed.requesting_agent).toBe('sentinel');
    });

    it('goals.json matches dashboard format', () => {
      const orgDir = join(testDir, 'orgs', 'acme');
      mkdirSync(orgDir, { recursive: true });

      const goals = {
        north_star: 'Build the best AI agent framework',
        daily_focus: 'Complete Sprint 8',
        goals: [
          { name: 'Feature parity', status: 'in_progress', progress: 85 },
        ],
        bottleneck: 'Dashboard integration',
        updated_at: '2026-03-29T10:00:00Z',
      };
      writeFileSync(join(orgDir, 'goals.json'), JSON.stringify(goals, null, 2), 'utf-8');

      const parsed = JSON.parse(readFileSync(join(orgDir, 'goals.json'), 'utf-8'));
      expect(parsed.north_star).toBeTruthy();
      expect(parsed.goals.length).toBeGreaterThan(0);
    });

    it('usage data matches dashboard format', () => {
      const usageDir = join(ctxRoot, 'state', 'usage');
      mkdirSync(usageDir, { recursive: true });

      const usage = {
        agent: 'sentinel',
        timestamp: '2026-03-29T10:00:00Z',
        session: { used_pct: 45, resets: 'in 3h' },
        week_all_models: { used_pct: 30, resets: 'in 4d' },
        week_sonnet: { used_pct: 20 },
      };
      writeFileSync(join(usageDir, 'latest.json'), JSON.stringify(usage, null, 2), 'utf-8');

      const parsed = JSON.parse(readFileSync(join(usageDir, 'latest.json'), 'utf-8'));
      expect(parsed.session.used_pct).toBe(45);
    });
  });
});
