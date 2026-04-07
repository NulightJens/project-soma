'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ProgressBar } from '@/components/charts/progress-bar';
import { CHART_GOLD } from '@/components/charts/chart-theme';
import type { Goal } from '@/lib/types';

interface GoalWithStaleness extends Goal {
  stalenessHours?: number;
  stalenessStatus?: 'fresh' | 'stale' | 'critical';
}

interface GoalProgressProps {
  goals: GoalWithStaleness[];
}

export function GoalProgress({ goals }: GoalProgressProps) {
  const sorted = [...goals].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Goal Progress
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No goals configured. Visit Strategy to set goals.
          </p>
        ) : (
          <div className="space-y-4">
            {sorted.map((goal) => (
              <div key={goal.id} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 min-w-0 mr-2">
                    <span className="font-medium truncate">{goal.title}</span>
                    {goal.stalenessStatus && (
                      <span className={`inline-flex items-center gap-1 text-[10px] shrink-0 ${
                        goal.stalenessStatus === 'fresh' ? 'text-green-600' :
                        goal.stalenessStatus === 'stale' ? 'text-amber-600' : 'text-red-600'
                      }`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${
                          goal.stalenessStatus === 'fresh' ? 'bg-green-500' :
                          goal.stalenessStatus === 'stale' ? 'bg-amber-500' : 'bg-red-500'
                        }`} />
                        {goal.stalenessStatus === 'fresh' ? 'Fresh' :
                         `${goal.stalenessHours}h stale`}
                      </span>
                    )}
                  </div>
                  <span className="text-muted-foreground tabular-nums text-xs shrink-0">
                    {Math.round(goal.progress)}%
                  </span>
                </div>
                <ProgressBar
                  value={goal.progress}
                  height="md"
                  color={CHART_GOLD}
                  animated={goal.progress > 0 && goal.progress < 100}
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
