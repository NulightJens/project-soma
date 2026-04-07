'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import {
  IconFlask,
  IconCheck,
  IconX,
  IconTrendingUp,
  IconTrendingDown,
  IconPlayerPlay,
  IconClock,
  IconBulb,
  IconRefresh,
  IconChevronDown,
  IconChevronUp,
} from '@tabler/icons-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Experiment {
  id: string;
  agent: string;
  metric: string;
  hypothesis: string;
  changes_description?: string | null;
  measurement?: string;
  surface: string;
  direction: string;
  window: string;
  status: string;
  baseline_value: number;
  result_value: number | null;
  decision: string | null;
  learning: string | null;
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
  measurement: string;
  loop_interval: string;
  direction: string;
  window: string;
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

interface ApiResponse {
  agents: AgentExperiments[];
  summary: {
    totalExperiments: number;
    totalCycles: number;
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

function timeAgo(iso: string | null): string {
  if (!iso) return '-';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function statusBadge(status: string) {
  const map: Record<string, { variant: 'default' | 'secondary' | 'outline' | 'destructive'; icon: React.ReactNode }> = {
    running: { variant: 'default', icon: <IconPlayerPlay size={12} /> },
    proposed: { variant: 'secondary', icon: <IconClock size={12} /> },
    completed: { variant: 'outline', icon: <IconCheck size={12} /> },
    crashed: { variant: 'destructive', icon: <IconX size={12} /> },
    discarded: { variant: 'destructive', icon: <IconX size={12} /> },
  };
  const s = map[status] ?? { variant: 'secondary' as const, icon: null };
  return (
    <Badge variant={s.variant} className="gap-1 text-[11px]">
      {s.icon}
      {status}
    </Badge>
  );
}

function decisionBadge(decision: string | null) {
  if (!decision) return null;
  if (decision === 'keep') {
    return (
      <Badge variant="outline" className="gap-1 text-[11px] border-green-500/30 text-green-600 dark:text-green-400">
        <IconCheck size={12} />
        kept
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-[11px] border-red-500/30 text-red-600 dark:text-red-400">
      <IconX size={12} />
      discarded
    </Badge>
  );
}

function metricDelta(exp: Experiment) {
  if (exp.result_value == null) return null;
  const delta = exp.result_value - exp.baseline_value;
  const positive = exp.direction === 'higher' ? delta > 0 : delta < 0;
  return (
    <span className={positive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
      {delta > 0 ? '+' : ''}{delta.toFixed(1)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ExperimentsPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const fetchData = () => {
    setLoading(true);
    const org = typeof window !== 'undefined' ? localStorage.getItem('selectedOrg') || '' : '';
    const params = org ? `?org=${org}` : '';
    fetch(`/api/experiments${params}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        // Auto-expand first agent
        if (d.agents?.length > 0 && !expandedAgent) {
          setExpandedAgent(d.agents[0].agent);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = data?.summary;
  const agents = data?.agents ?? [];
  const allExperiments = agents.flatMap((a) => a.experiments);
  const hasData = allExperiments.length > 0 || agents.some((a) => a.cycles.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Experiments</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Autoresearch cycles across your agent fleet
          </p>
        </div>
        <button
          onClick={fetchData}
          className="p-2 rounded-md hover:bg-muted transition-colors"
          title="Refresh"
        >
          <IconRefresh size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Summary cards */}
      {summary && hasData && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Active Cycles</p>
              <p className="text-2xl font-semibold mt-1">{summary.totalCycles}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Running</p>
              <p className="text-2xl font-semibold mt-1 text-green-600 dark:text-green-400">{summary.running}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Completed</p>
              <p className="text-2xl font-semibold mt-1">{summary.completed}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Keep Rate</p>
              <p className="text-2xl font-semibold mt-1">
                {summary.keepRate > 0 ? `${summary.keepRate}%` : '-'}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total</p>
              <p className="text-2xl font-semibold mt-1">{summary.totalExperiments}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Loading */}
      {loading && !data && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-lg bg-muted/30 animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !hasData && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-full bg-muted p-4 mb-4">
              <IconFlask size={32} className="text-muted-foreground/50" />
            </div>
            <h3 className="text-lg font-medium mb-1">No experiments yet</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Experiments are autonomous research cycles where agents test hypotheses
              and measure results. The analyst sets up cycles via theta wave, and
              agents run them automatically.
            </p>
            <div className="mt-6 rounded-lg bg-muted/50 p-4 text-left max-w-sm w-full">
              <p className="text-xs font-medium text-muted-foreground mb-2">Get started:</p>
              <p className="text-xs text-muted-foreground">
                Use <code className="bg-muted px-1 rounded">manage-cycle.sh create</code> to
                assign a research cycle to an agent, or enable theta wave on the analyst
                to have cycles created automatically.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Agent experiment sections */}
      {!loading && hasData && (
        <Tabs defaultValue="by-agent" className="space-y-4">
          <TabsList>
            <TabsTrigger value="by-agent">By Agent</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="learnings">Learnings</TabsTrigger>
          </TabsList>

          {/* By Agent tab */}
          <TabsContent value="by-agent" className="space-y-3">
            {agents.map((agentData) => {
              const isExpanded = expandedAgent === agentData.agent;
              return (
                <Card key={agentData.agent}>
                  <button
                    className="w-full text-left"
                    onClick={() => setExpandedAgent(isExpanded ? null : agentData.agent)}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <CardTitle className="text-base">{agentData.agent}</CardTitle>
                          <span className="text-xs text-muted-foreground">{agentData.org}</span>
                          {agentData.stats.running > 0 && (
                            <Badge variant="default" className="text-[10px]">
                              {agentData.stats.running} running
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right text-xs text-muted-foreground">
                            <span>{agentData.stats.total} experiments</span>
                            {agentData.stats.total > 0 && (
                              <span className="ml-2">
                                {agentData.stats.keepRate}% kept
                              </span>
                            )}
                          </div>
                          {isExpanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                        </div>
                      </div>
                    </CardHeader>
                  </button>

                  {isExpanded && (
                    <CardContent className="pt-0 space-y-4">
                      {/* Keep/discard bar */}
                      {(agentData.stats.kept + agentData.stats.discarded) > 0 && (
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>{agentData.stats.kept} kept</span>
                            <span>{agentData.stats.discarded} discarded</span>
                          </div>
                          <Progress value={agentData.stats.keepRate} className="h-2" />
                        </div>
                      )}

                      {/* Active cycles */}
                      {agentData.cycles.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                            Research Cycles
                          </p>
                          <div className="grid gap-2">
                            {agentData.cycles.map((cycle) => (
                              <div
                                key={cycle.name}
                                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="font-medium">{cycle.name}</span>
                                  <div className="flex flex-col min-w-0">
                                    <div className="flex items-center gap-1">
                                      {cycle.direction === 'higher' ? (
                                        <IconTrendingUp size={12} className="inline shrink-0 text-muted-foreground" />
                                      ) : (
                                        <IconTrendingDown size={12} className="inline shrink-0 text-muted-foreground" />
                                      )}
                                      <span className="text-xs text-muted-foreground">{cycle.metric}</span>
                                      {cycle.metric_type && (
                                        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                                          {cycle.metric_type}
                                        </Badge>
                                      )}
                                    </div>
                                    {cycle.measurement && (
                                      <span className="text-xs text-muted-foreground">{cycle.measurement}</span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-xs text-muted-foreground">
                                    {cycle.window}{cycle.loop_interval ? ` • every ${cycle.loop_interval}` : ''}
                                  </span>
                                  <Badge variant={cycle.enabled ? 'default' : 'secondary'} className="text-[10px]">
                                    {cycle.enabled ? 'active' : 'paused'}
                                  </Badge>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Experiments list */}
                      {agentData.experiments.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                            Experiments
                          </p>
                          <div className="space-y-2">
                            {agentData.experiments.map((exp) => (
                              <div
                                key={exp.id}
                                className="rounded-md border px-3 py-2.5 space-y-1.5"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      {statusBadge(exp.status)}
                                      {decisionBadge(exp.decision)}
                                      <span className="text-xs text-muted-foreground font-mono">
                                        {exp.id.slice(0, 16)}
                                      </span>
                                    </div>
                                    <p className="text-sm mt-1">{exp.hypothesis}</p>
                                    {exp.changes_description && (
                                      <p className="text-xs text-muted-foreground mt-0.5">{exp.changes_description}</p>
                                    )}
                                  </div>
                                  <div className="text-right shrink-0">
                                    <div className="text-sm font-mono tabular-nums">
                                      {exp.baseline_value}
                                      {exp.result_value != null && (
                                        <>
                                          {' '}&rarr;{' '}
                                          {exp.result_value}
                                          {' '}
                                          {metricDelta(exp)}
                                        </>
                                      )}
                                    </div>
                                    <p className="text-[10px] text-muted-foreground">
                                      {exp.metric} ({exp.direction})
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                                  <span>Created {timeAgo(exp.created_at)}</span>
                                  {exp.completed_at && (
                                    <span>Completed {timeAgo(exp.completed_at)}</span>
                                  )}
                                  {exp.surface && (
                                    <span className="font-mono">{exp.surface.split('/').pop()}</span>
                                  )}
                                </div>
                                {exp.learning && (
                                  <p className="text-xs text-muted-foreground border-t pt-1.5 mt-1">
                                    <IconBulb size={12} className="inline mr-1 text-amber-500" />
                                    {exp.learning}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </TabsContent>

          {/* Timeline tab */}
          <TabsContent value="timeline" className="space-y-2">
            {allExperiments.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No experiments yet</p>
            ) : (
              allExperiments
                .sort(
                  (a, b) =>
                    new Date(b.created_at).getTime() -
                    new Date(a.created_at).getTime(),
                )
                .map((exp) => (
                  <div
                    key={exp.id}
                    className="flex items-center gap-3 rounded-md border px-3 py-2.5"
                  >
                    <div className="shrink-0">
                      {exp.decision === 'keep' ? (
                        <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center">
                          <IconCheck size={16} className="text-green-500" />
                        </div>
                      ) : exp.decision === 'discard' ? (
                        <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center">
                          <IconX size={16} className="text-red-500" />
                        </div>
                      ) : exp.status === 'running' ? (
                        <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
                          <IconPlayerPlay size={16} className="text-blue-500" />
                        </div>
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                          <IconClock size={16} className="text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{exp.agent}</span>
                        <span className="text-xs text-muted-foreground">{exp.metric}</span>
                        {statusBadge(exp.status)}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{exp.hypothesis}</p>
                    </div>
                    <div className="text-right shrink-0">
                      {exp.result_value != null ? (
                        <div className="text-sm font-mono tabular-nums">
                          {exp.baseline_value} &rarr; {exp.result_value}
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">-</div>
                      )}
                      <p className="text-[10px] text-muted-foreground">{timeAgo(exp.created_at)}</p>
                    </div>
                  </div>
                ))
            )}
          </TabsContent>

          {/* Learnings tab */}
          <TabsContent value="learnings" className="space-y-4">
            {agents.filter((a) => a.learnings).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No learnings recorded yet. Learnings accumulate as experiments complete.
              </p>
            ) : (
              agents
                .filter((a) => a.learnings)
                .map((agentData) => (
                  <Card key={agentData.agent}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">{agentData.agent}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <pre className="text-xs whitespace-pre-wrap font-sans bg-transparent p-0 m-0">
                          {agentData.learnings}
                        </pre>
                      </div>
                    </CardContent>
                  </Card>
                ))
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
