'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { IconPlayerPause, IconPlayerPlay, IconRefresh } from '@tabler/icons-react';
import type { LogFile } from '@/lib/types';

interface LogsTabProps {
  agentName: string;
  org: string;
  logFiles: LogFile[];
}

export function LogsTab({ agentName, org, logFiles }: LogsTabProps) {
  const [selectedType, setSelectedType] = useState<string>(
    logFiles[0]?.type ?? 'activity',
  );
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLPreElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type: selectedType, lines: '500' });
      if (org) params.set('org', org);

      const res = await fetch(
        `/api/agents/${encodeURIComponent(agentName)}/logs?${params}`,
      );
      const text = await res.text();
      setContent(text);
    } catch {
      setContent('Failed to load logs.');
    } finally {
      setLoading(false);
    }
  }, [agentName, org, selectedType]);

  // Fetch on mount and when log type changes
  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Auto-poll every 5 seconds
  useEffect(() => {
    if (autoScroll) {
      pollRef.current = setInterval(fetchLogs, 5000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [autoScroll, fetchLogs]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content, autoScroll]);

  if (logFiles.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No log files found for this agent.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex items-center gap-2">
        <Select value={selectedType} onValueChange={(v) => { if (v !== null) setSelectedType(v); }}>
          <SelectTrigger size="sm">
            <SelectValue placeholder="Log type" />
          </SelectTrigger>
          <SelectContent>
            {logFiles.map((lf) => (
              <SelectItem key={lf.type} value={lf.type}>
                {lf.type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={fetchLogs}
          disabled={loading}
          title="Refresh"
        >
          <IconRefresh size={14} />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setAutoScroll(!autoScroll)}
          title={autoScroll ? 'Pause auto-scroll' : 'Resume auto-scroll'}
        >
          {autoScroll ? (
            <IconPlayerPause size={14} />
          ) : (
            <IconPlayerPlay size={14} />
          )}
        </Button>

        {autoScroll && (
          <span className="text-xs text-muted-foreground">Auto-refreshing</span>
        )}
      </div>

      {/* Log viewer */}
      <pre
        ref={scrollRef}
        className="max-h-[500px] overflow-auto rounded-lg border bg-muted/30 p-4 font-mono text-xs leading-relaxed"
      >
        {content || (loading ? 'Loading...' : 'No log content.')}
      </pre>
    </div>
  );
}
