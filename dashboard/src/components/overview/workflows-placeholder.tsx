import { IconLock } from '@tabler/icons-react';
import { Card, CardContent } from '@/components/ui/card';

export function WorkflowsPlaceholder() {
  return (
    <Card className="border-dashed border-primary/30">
      <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
        <div className="rounded-full bg-primary/10 p-3">
          <IconLock size={24} className="text-primary/50" />
        </div>
        <div>
          <h3 className="font-semibold">Custom Workflows</h3>
          <p className="text-sm text-muted-foreground">Coming Soon</p>
        </div>
      </CardContent>
    </Card>
  );
}
