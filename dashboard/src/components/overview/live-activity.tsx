'use client';

import { useEffect, useRef, useState } from 'react';
import {
  IconMessage,
  IconCheckbox,
  IconShield,
  IconAlertTriangle,
  IconFlag,
  IconActivity,
  IconPlayerPause,
  IconPlayerPlay,
} from '@tabler/icons-react';
import { formatDistanceToNow } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSSE } from '@/hooks/use-sse';
import type { Event, SSEEvent } from '@/lib/types';

interface LiveActivityProps {
  initialEvents: Event[];
}

const eventTypeIcons: Record<string, React.ReactNode> = {
  message: <IconMessage size={14} />,
  task: <IconCheckbox size={14} />,
  approval: <IconShield size={14} />,
  error: <IconAlertTriangle size={14} className="text-destructive" />,
  milestone: <IconFlag size={14} className="text-primary" />,
};

function formatEventTime(timestamp: string): string {
  try {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
  } catch {
    return 'unknown';
  }
}

interface DisplayEvent {
  id: string;
  timestamp: string;
  type: string;
  agent: string;
  message: string;
}

function sseToDisplayEvent(sse: SSEEvent, index: number): DisplayEvent {
  return {
    id: `sse-${sse.timestamp}-${index}`,
    timestamp: sse.timestamp,
    type: sse.type ?? 'event',
    agent: (sse.data?.agent as string) ?? '',
    message: (sse.data?.message as string) ?? sse.type ?? 'Event',
  };
}

function eventToDisplayEvent(event: Event): DisplayEvent {
  return {
    id: event.id,
    timestamp: event.timestamp,
    type: event.type,
    agent: event.agent,
    message: event.message ?? event.category ?? event.type,
  };
}

export function LiveActivity({ initialEvents }: LiveActivityProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [liveEvents, setLiveEvents] = useState<DisplayEvent[]>([]);

  const { events: sseEvents, isConnected } = useSSE({
    bufferSize: 20,
  });

  // Convert SSE events to display events
  useEffect(() => {
    if (sseEvents.length > 0) {
      const newDisplayEvents = sseEvents.map(sseToDisplayEvent);
      setLiveEvents(newDisplayEvents);
    }
  }, [sseEvents]);

  // Combine initial + live, dedupe by id, limit to 20
  const allEvents = [
    ...liveEvents,
    ...initialEvents.map(eventToDisplayEvent),
  ];
  // Dedupe
  const seen = new Set<string>();
  const dedupedEvents = allEvents.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
  // Sort newest first, then take 20
  const displayEvents = dedupedEvents
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 20);

  // Auto-scroll when new events arrive
  useEffect(() => {
    if (!paused && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [displayEvents.length, paused]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Live Activity
            </span>
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                isConnected ? 'bg-success animate-pulse' : 'bg-warning'
              }`}
              title={isConnected ? 'Connected' : 'Reconnecting...'}
            />
          </div>
          <button
            type="button"
            onClick={() => setPaused(!paused)}
            className="rounded-md p-1 hover:bg-muted transition-colors"
            title={paused ? 'Resume auto-scroll' : 'Pause auto-scroll'}
          >
            {paused ? (
              <IconPlayerPlay size={16} className="text-muted-foreground" />
            ) : (
              <IconPlayerPause size={16} className="text-muted-foreground" />
            )}
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          ref={scrollRef}
          className="max-h-[300px] overflow-y-auto space-y-0.5"
        >
          {displayEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Your agents are starting up. Activity will appear here as they begin working.
            </p>
          ) : (
            displayEvents.map((event) => (
              <div
                key={event.id}
                className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-muted/50 text-sm"
              >
                <span className="mt-0.5 shrink-0 text-muted-foreground">
                  {eventTypeIcons[event.type] ?? (
                    <IconActivity size={14} />
                  )}
                </span>
                {event.agent && (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                    {event.agent}
                  </span>
                )}
                <span className="truncate flex-1">{event.message}</span>
                <span className="shrink-0 text-xs text-muted-foreground" suppressHydrationWarning>
                  {formatEventTime(event.timestamp)}
                </span>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
