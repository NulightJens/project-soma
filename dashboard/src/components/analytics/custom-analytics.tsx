'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { IconChartBar } from '@tabler/icons-react';

export function CustomAnalytics() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Custom Analytics
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <IconChartBar size={40} className="text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">Coming Soon</p>
          <p className="text-xs text-muted-foreground mt-1">
            Custom dashboards, saved queries, and metric alerts.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
