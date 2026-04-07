import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { TaskPriority } from '@/lib/types';

export interface PriorityBadgeProps {
  priority: TaskPriority;
  className?: string;
}

const priorityConfig: Record<
  string,
  { variant: 'destructive' | 'default' | 'secondary' | 'outline'; label: string }
> = {
  critical: { variant: 'destructive', label: 'Critical' },
  urgent: { variant: 'destructive', label: 'Urgent' },
  high: { variant: 'default', label: 'High' },
  normal: { variant: 'secondary', label: 'Normal' },
  low: { variant: 'outline', label: 'Low' },
};

const fallbackConfig = { variant: 'secondary' as const, label: 'Normal' };

export function PriorityBadge({ priority, className }: PriorityBadgeProps) {
  const config = priorityConfig[priority] || fallbackConfig;

  return (
    <Badge variant={config.variant} className={cn(className)}>
      {config.label}
    </Badge>
  );
}
