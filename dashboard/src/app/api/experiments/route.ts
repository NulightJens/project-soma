import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Experiment {
  id: string;
  agent: string;
  metric: string;
  hypothesis: string;
  surface: string;
  direction: string;
  window: string;
  measurement: string;
  status: string;
  baseline_value: number;
  result_value: number | null;
  decision: string | null;
  changes_description?: string | null;
  learning: string | null;
  experiment_commit: string | null;
  tracking_commit: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface Cycle {
  name: string;
  agent: string;
  surface: string;
  metric: string;
  metric_type: string;
  direction: string;
  window: string;
  measurement: string;
  loop_interval: string;
  enabled: boolean;
  created_by: string;
  created_at: string;
}

interface AgentExperiments {
  agent: string;
  org: string;
  cycles: Cycle[];
  experiments: Experiment[];
  learnings: string;
  stats: {
    total: number;
    running: number;
    proposed: number;
    completed: number;
    kept: number;
    discarded: number;
    keepRate: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFrameworkRoot(): string {
  return (
    process.env.CTX_FRAMEWORK_ROOT ??
    path.resolve(process.cwd(), '..')
  );
}

function scanExperiments(): AgentExperiments[] {
  const frameworkRoot = getFrameworkRoot();
  const orgsDir = path.join(frameworkRoot, 'orgs');
  if (!fs.existsSync(orgsDir)) return [];

  const results: AgentExperiments[] = [];

  for (const org of fs.readdirSync(orgsDir, { withFileTypes: true })) {
    if (!org.isDirectory()) continue;
    const agentsDir = path.join(orgsDir, org.name, 'agents');
    if (!fs.existsSync(agentsDir)) continue;

    for (const agent of fs.readdirSync(agentsDir, { withFileTypes: true })) {
      if (!agent.isDirectory()) continue;
      const expDir = path.join(agentsDir, agent.name, 'experiments');
      if (!fs.existsSync(expDir)) continue;

      // Read config
      let cycles: Cycle[] = [];
      const configPath = path.join(expDir, 'config.json');
      if (fs.existsSync(configPath)) {
        try {
          const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          cycles = cfg.cycles ?? [];
        } catch { /* ignore parse errors */ }
      }

      // Read experiments from history/
      const experiments: Experiment[] = [];
      const histDir = path.join(expDir, 'history');
      if (fs.existsSync(histDir)) {
        for (const f of fs.readdirSync(histDir)) {
          if (!f.endsWith('.json')) continue;
          try {
            const exp = JSON.parse(
              fs.readFileSync(path.join(histDir, f), 'utf-8'),
            );
            experiments.push(exp);
          } catch { /* skip bad files */ }
        }
      }

      // Sort by created_at descending
      experiments.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );

      // Read learnings
      let learnings = '';
      const learningsPath = path.join(expDir, 'learnings.md');
      if (fs.existsSync(learningsPath)) {
        learnings = fs.readFileSync(learningsPath, 'utf-8');
      }

      // Calculate stats
      const total = experiments.length;
      const running = experiments.filter((e) => e.status === 'running').length;
      const proposed = experiments.filter(
        (e) => e.status === 'proposed',
      ).length;
      const completed = experiments.filter(
        (e) => e.status === 'completed',
      ).length;
      const kept = experiments.filter((e) => e.decision === 'keep').length;
      const discarded = experiments.filter(
        (e) => e.decision === 'discard',
      ).length;
      const decided = kept + discarded;
      const keepRate = decided > 0 ? Math.round((kept / decided) * 100) : 0;

      // Only include agents that have cycles or experiments
      if (cycles.length > 0 || experiments.length > 0) {
        results.push({
          agent: agent.name,
          org: org.name,
          cycles,
          experiments,
          learnings,
          stats: { total, running, proposed, completed, kept, discarded, keepRate },
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// GET /api/experiments
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const filterAgent = searchParams.get('agent');
  const filterOrg = searchParams.get('org');

  try {
    let data = scanExperiments();

    if (filterOrg) {
      data = data.filter((d) => d.org === filterOrg);
    }
    if (filterAgent) {
      data = data.filter((d) => d.agent === filterAgent);
    }

    // Aggregate stats across all agents
    const allExperiments = data.flatMap((d) => d.experiments);
    const allCycles = data.flatMap((d) => d.cycles);
    const totalKept = allExperiments.filter(
      (e) => e.decision === 'keep',
    ).length;
    const totalDiscarded = allExperiments.filter(
      (e) => e.decision === 'discard',
    ).length;
    const totalDecided = totalKept + totalDiscarded;

    return Response.json({
      agents: data,
      summary: {
        totalExperiments: allExperiments.length,
        totalCycles: allCycles.length,
        running: allExperiments.filter((e) => e.status === 'running').length,
        proposed: allExperiments.filter((e) => e.status === 'proposed').length,
        completed: allExperiments.filter((e) => e.status === 'completed')
          .length,
        kept: totalKept,
        discarded: totalDiscarded,
        keepRate:
          totalDecided > 0 ? Math.round((totalKept / totalDecided) * 100) : 0,
      },
    });
  } catch (err) {
    console.error('[api/experiments] GET error:', err);
    return Response.json(
      { error: 'Failed to fetch experiments' },
      { status: 500 },
    );
  }
}
