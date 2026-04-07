import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { IconRefresh, IconTrendingUp } from '@tabler/icons-react';

interface SystemIntelligenceProps {
  latestReport?: {
    totalSessions?: number;
    totalCrashes?: number;
  } | null;
}

export function SystemIntelligence({ latestReport }: SystemIntelligenceProps) {
  if (!latestReport) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            System Intelligence
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground py-4 text-center">
            System intelligence data will appear here once agents start generating activity reports.
          </p>
        </CardContent>
      </Card>
    );
  }

  const sessionStability = latestReport.totalSessions && latestReport.totalSessions > 0
    ? Math.round(((latestReport.totalSessions - (latestReport.totalCrashes || 0)) / latestReport.totalSessions) * 100)
    : 100;

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
        System Intelligence
      </h2>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-2">
              <IconRefresh size={14} className="text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Sessions</span>
            </div>
            <p className="text-lg font-semibold tabular-nums">{latestReport.totalSessions ?? 0}</p>
            <p className="text-[10px] text-muted-foreground">{latestReport.totalCrashes ?? 0} crashes</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-2">
              <IconTrendingUp size={14} className="text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Stability</span>
            </div>
            <p className="text-lg font-semibold tabular-nums">{sessionStability}%</p>
            <p className="text-[10px] text-muted-foreground">session success rate</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
