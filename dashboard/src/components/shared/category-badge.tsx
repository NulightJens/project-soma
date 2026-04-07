import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
export interface CategoryBadgeProps {
  category: string;
  className?: string;
}

const categoryConfig: Record<string, { className: string; label: string }> = {
  'external-comms': {
    className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    label: 'External Comms',
  },
  financial: {
    className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    label: 'Financial',
  },
  deployment: {
    className: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
    label: 'Deployment',
  },
  'data-deletion': {
    className: 'bg-red-500/10 text-red-600 dark:text-red-400',
    label: 'Data Deletion',
  },
  other: {
    className: 'bg-muted text-muted-foreground',
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
