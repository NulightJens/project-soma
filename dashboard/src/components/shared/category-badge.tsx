import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
export interface CategoryBadgeProps {
  category: string;
  className?: string;
}

const categoryConfig: Record<string, { className: string; label: string }> = {
  'external-comms': {
    className: 'bg-muted text-foreground uppercase tracking-wider font-semibold text-[10px]',
    label: 'External Comms',
  },
  financial: {
    className: 'bg-muted text-foreground uppercase tracking-wider font-semibold text-[10px]',
    label: 'Financial',
  },
  deployment: {
    className: 'bg-muted text-foreground uppercase tracking-wider font-semibold text-[10px]',
    label: 'Deployment',
  },
  'data-deletion': {
    className: 'bg-destructive/10 text-destructive uppercase tracking-wider font-semibold text-[10px]',
    label: 'Data Deletion',
  },
  other: {
    className: 'bg-muted text-muted-foreground uppercase tracking-wider font-semibold text-[10px]',
    label: 'Other',
  },
};

export function CategoryBadge({ category, className }: CategoryBadgeProps) {
  const config = categoryConfig[category] ?? categoryConfig.other;

  return (
    <Badge variant="secondary" className={cn(config.className, className)}>
      {config.label}
    </Badge>
  );
}
