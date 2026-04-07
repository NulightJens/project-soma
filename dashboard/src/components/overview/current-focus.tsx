import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BottleneckEditor } from './bottleneck-editor';
import { GoalProgressList } from './goal-progress-list';
import type { Goal } from '@/lib/types';

interface CurrentFocusProps {
  org: string;
  bottleneck: string;
  goals: Goal[];
}

export function CurrentFocus({ org, bottleneck, goals }: CurrentFocusProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Current Focus
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <BottleneckEditor org={org} initialValue={bottleneck} />
        <GoalProgressList goals={goals} />
      </CardContent>
    </Card>
  );
}
