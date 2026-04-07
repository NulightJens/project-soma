'use client';

import { IconPlus } from '@tabler/icons-react';
import { Card, CardContent } from '@/components/ui/card';

interface AddAgentCardProps {
  onClick?: () => void;
}

export function AddAgentCard({ onClick }: AddAgentCardProps) {
  return (
    <Card
      className="h-full cursor-pointer border-dashed transition-colors hover:bg-muted/30"
      onClick={onClick}
    >
      <CardContent className="flex h-full min-h-[120px] flex-col items-center justify-center gap-2 text-muted-foreground">
        <IconPlus size={24} />
        <span className="text-sm font-medium">Add Agent</span>
      </CardContent>
    </Card>
  );
}
