import { cn } from '@/lib/utils';
import type { HealthStatus } from '@/lib/types';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export interface HealthDotProps {
  status: HealthStatus;
  showLabel?: boolean;
  className?: string;
}

const statusConfig: Record<HealthStatus, { color: string; label: string }> = {
  healthy: { color: 'bg-success', label: 'Healthy' },
  stale: { color: 'bg-warning', label: 'Stale' },
  down: { color: 'bg-destructive', label: 'Down' },
};

export function HealthDot({ status, showLabel = false, className }: HealthDotProps) {
  const config = statusConfig[status];

  return (
    <Tooltip>
      <TooltipTrigger
        className={cn('inline-flex items-center gap-1.5', className)}
      >
        <span
          className={cn(
            'inline-block h-2.5 w-2.5 rounded-full',
            config.color,
            status === 'healthy' && 'animate-pulse-dot'
          )}
        />
        {showLabel && (
          <span className="text-xs text-muted-foreground">{config.label}</span>
        )}
      </TooltipTrigger>
      <TooltipContent>{config.label}</TooltipContent>
    </Tooltip>
  );
}
