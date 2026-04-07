'use client';

import { useState } from 'react';
import { IconHistory } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { TimeAgo } from '@/components/shared/time-ago';

interface GoalHistoryProps {
  events: Array<{ timestamp: string; change: string }>;
}

const PAGE_SIZE = 20;

export function GoalHistory({ events }: GoalHistoryProps) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? events : events.slice(0, PAGE_SIZE);

  if (events.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <IconHistory className="h-5 w-5 text-muted-foreground" />
        Goal History
      </h2>

      <div className="relative pl-6">
        {/* Vertical timeline line */}
        <div className="absolute left-2 top-1 bottom-1 w-px bg-foreground/10" />

        <div className="space-y-3">
          {visible.map((event, i) => (
            <div key={`${event.timestamp}-${i}`} className="relative flex items-start gap-3">
              {/* Timeline dot */}
              <div className="absolute -left-4 top-1.5 h-2 w-2 rounded-full bg-amber-500/60 ring-2 ring-background" />

              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground/80 line-clamp-2">
                  {event.change}
                </p>
              </div>
              <TimeAgo
                date={event.timestamp}
                className="shrink-0 text-xs"
              />
            </div>
          ))}
        </div>
      </div>

      {events.length > PAGE_SIZE && !showAll && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowAll(true)}
          className="text-muted-foreground"
        >
          Show {events.length - PAGE_SIZE} more
        </Button>
      )}
    </div>
  );
}
