'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AreaChart } from '@/components/charts/area-chart';
import { CHART_GOLD } from '@/components/charts/chart-theme';

interface TaskThroughputProps {
  data: Array<{ date: string; tasks: number }>;
}

export function TaskThroughput({ data }: TaskThroughputProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Task Throughput
        </CardTitle>
        <p className="text-xs text-muted-foreground">Tasks completed per day (30 days)</p>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No task data available yet.
          </p>
        ) : data.length === 1 ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-center">
              <p className="text-4xl font-bold tabular-nums" style={{ color: CHART_GOLD }}>{data[0].tasks}</p>
              <p className="text-xs text-muted-foreground mt-1">tasks completed on {data[0].date}</p>
            </div>
          </div>
        ) : (
          <AreaChart
            data={data}
            xKey="date"
            yKeys={['tasks']}
            colors={[CHART_GOLD]}
            height={220}
          />
        )}
      </CardContent>
    </Card>
  );
}
