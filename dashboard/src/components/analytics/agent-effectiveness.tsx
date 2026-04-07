'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AgentAvatar } from '@/components/shared/agent-avatar';
import { SparkLine } from '@/components/charts/spark-line';
import { CHART_GOLD } from '@/components/charts/chart-theme';

export interface AgentStat {
  name: string;
  emoji?: string;
  completionRate: number; // 0-100
  errorCount: number;
  tasksCompleted: number;
  recentTrend: number[]; // last 7 days of completed tasks
  tokensToday?: number;
  tokensPerTask?: number;
  fleetLoadPct?: number;
}

interface AgentEffectivenessProps {
  agents: AgentStat[];
}

export function AgentEffectiveness({ agents }: AgentEffectivenessProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Agent Effectiveness
        </CardTitle>
      </CardHeader>
      <CardContent>
        {agents.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No agent data available yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {agents.map((agent) => (
              <div
                key={agent.name}
                className="flex items-center gap-3 rounded-lg border p-3"
              >
                <AgentAvatar name={agent.name} emoji={agent.emoji} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{agent.name}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                    <span>{agent.tasksCompleted} done</span>
                    <span>{Math.round(agent.completionRate)}% rate</span>
                    {agent.errorCount > 0 && (
                      <span className="text-destructive">
                        {agent.errorCount} errors
                      </span>
                    )}
                  </div>
                  {agent.tokensToday !== undefined && (
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                      <span>{(agent.tokensToday / 1000).toFixed(0)}K tokens</span>
                      {agent.tokensPerTask !== undefined && (
                        <span className={
                          agent.tokensPerTask < 15000 ? 'text-green-600' :
                          agent.tokensPerTask < 40000 ? 'text-amber-600' : 'text-red-600'
                        }>
                          {(agent.tokensPerTask / 1000).toFixed(1)}K/task
                        </span>
                      )}
                      {agent.fleetLoadPct !== undefined && (
                        <span>{agent.fleetLoadPct}% load</span>
                      )}
                    </div>
                  )}
                </div>
                <SparkLine
                  data={agent.recentTrend}
                  color={CHART_GOLD}
                  width={64}
                  height={20}
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
