'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { SSEEvent } from '@/lib/types';

export interface UseSSEOptions {
  /** Filter function - return true to keep the event */
  filter?: (event: SSEEvent) => boolean;
  /** Callback fired for each (filtered) event */
  onEvent?: (event: SSEEvent) => void;
  /** Max events to keep in buffer (default 50) */
  bufferSize?: number;
}

export interface UseSSEReturn {
  /** Buffered events, most recent first */
  events: SSEEvent[];
  /** Whether the EventSource is connected */
  isConnected: boolean;
  /** Manually trigger a reconnect */
  reconnect: () => void;
}

const SSE_URL = '/api/events/stream';
const RECONNECT_DELAY_MS = 3_000;

export function useSSE(options: UseSSEOptions = {}): UseSSEReturn {
  const { bufferSize = 50 } = options;

  // Use refs for callbacks to avoid reconnecting when they change
  const filterRef = useRef(options.filter);
  filterRef.current = options.filter;

  const onEventRef = useRef(options.onEvent);
  onEventRef.current = options.onEvent;

  const bufferSizeRef = useRef(bufferSize);
  bufferSizeRef.current = bufferSize;

  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    // Clean up any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    const es = new EventSource(SSE_URL);
    eventSourceRef.current = es;

    es.onopen = () => {
      setIsConnected(true);
    };

    es.onmessage = (messageEvent: MessageEvent) => {
      try {
        const parsed: SSEEvent = JSON.parse(messageEvent.data);

        // Apply optional filter
        if (filterRef.current && !filterRef.current(parsed)) return;

        // Fire callback
        onEventRef.current?.(parsed);

        // Buffer event (most recent first)
        setEvents((prev) => {
          const next = [parsed, ...prev];
          return next.length > bufferSizeRef.current
            ? next.slice(0, bufferSizeRef.current)
            : next;
        });
      } catch {
        // Malformed event, skip
      }
    };

    es.onerror = () => {
      setIsConnected(false);
      es.close();
      eventSourceRef.current = null;

      // Auto-reconnect after delay
      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, RECONNECT_DELAY_MS);
    };
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [connect]);

  const reconnect = useCallback(() => {
    connect();
  }, [connect]);

  return { events, isConnected, reconnect };
}
