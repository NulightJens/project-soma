'use client';

import { Card } from '@/components/ui/card';
import { CategoryBadge, OrgBadge, TimeAgo } from '@/components/shared';
import type { Approval } from '@/lib/types';

interface ApprovalCardProps {
  approval: Approval;
  onClick: (approval: Approval) => void;
}

export function ApprovalCard({ approval, onClick }: ApprovalCardProps) {
  return (
    <Card
      className="cursor-pointer p-4 transition-colors hover:bg-muted/50"
      onClick={() => onClick(approval)}
    >
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-snug line-clamp-2">
            {approval.title}
          </p>
          <CategoryBadge category={approval.category} />
        </div>
        {approval.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {approval.description}
          </p>
        )}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>{approval.agent}</span>
            <OrgBadge org={approval.org} />
          </div>
          <TimeAgo date={approval.created_at} className="text-xs" />
        </div>
      </div>
    </Card>
  );
}
