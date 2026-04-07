import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

export interface OrgBadgeProps {
  org: string;
  className?: string;
}

export function OrgBadge({ org, className }: OrgBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn('bg-muted/50 text-muted-foreground font-normal', className)}
    >
      {org}
    </Badge>
  );
}
