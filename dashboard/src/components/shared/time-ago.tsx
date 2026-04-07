'use client';

import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export interface TimeAgoProps {
  date: string | Date;
  className?: string;
}

function formatRelative(date: string | Date): string {
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return 'unknown';
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return 'unknown';
  }
}

function formatAbsolute(date: string | Date): string {
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return 'Invalid date';
    return d.toISOString();
  } catch {
    return 'Invalid date';
  }
}

export function TimeAgo({ date, className }: TimeAgoProps) {
  const [relative, setRelative] = useState(() => formatRelative(date));

  useEffect(() => {
    setRelative(formatRelative(date));
    const interval = setInterval(() => {
      setRelative(formatRelative(date));
    }, 60_000);
    return () => clearInterval(interval);
  }, [date]);

  return (
    <Tooltip>
      <TooltipTrigger
        className={cn('text-sm text-muted-foreground', className)}
        suppressHydrationWarning
      >
        {relative}
      </TooltipTrigger>
      <TooltipContent>{formatAbsolute(date)}</TooltipContent>
    </Tooltip>
  );
}
