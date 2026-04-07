'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { updateBottleneck } from '@/lib/actions/goals';
import { TimeAgo } from '@/components/shared/time-ago';

interface BottleneckSectionProps {
  bottleneck: string;
  org: string;
  history: Array<{ timestamp: string; change: string }>;
}

export function BottleneckSection({
  bottleneck: initialBottleneck,
  org,
  history,
}: BottleneckSectionProps) {
  const [value, setValue] = useState(initialBottleneck);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef(initialBottleneck);

  // Sync with parent if bottleneck changes externally
  useEffect(() => {
    setValue(initialBottleneck);
    lastSavedRef.current = initialBottleneck;
  }, [initialBottleneck]);

  const handleSave = useCallback(async () => {
    const trimmed = value.trim();
    if (trimmed === lastSavedRef.current) return;

    setSaveStatus('saving');
    const result = await updateBottleneck(org, trimmed);
    if (result.success) {
      lastSavedRef.current = trimmed;
      setSaveStatus('saved');
      // Clear "Saved" after 2s
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setSaveStatus('idle'), 2000);
    } else {
      setSaveStatus('error');
    }
  }, [value, org]);

  const charCount = value.length;
  const charLimit = 500;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border-2 border-amber-500/40 bg-amber-500/5 p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-amber-700 dark:text-amber-200">
            Current Bottleneck
          </h2>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground tabular-nums">
              {charCount}/{charLimit}
            </span>
            {saveStatus === 'saving' && (
              <span className="text-amber-400 animate-pulse">Saving...</span>
            )}
            {saveStatus === 'saved' && (
              <span className="text-green-600 dark:text-green-400">Saved</span>
            )}
            {saveStatus === 'error' && (
              <span className="text-red-400">Error saving</span>
            )}
          </div>
        </div>
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, charLimit))}
          onBlur={handleSave}
          placeholder="What is the current bottleneck for your team?"
          className="min-h-24 text-lg border-amber-500/20 bg-transparent focus-visible:border-amber-500/50 focus-visible:ring-amber-500/20 resize-none"
        />
      </div>

      {/* Recent bottleneck changes */}
      {history.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            Recent Changes
          </h3>
          <div className="space-y-1">
            {history.slice(0, 5).map((entry, i) => (
              <div
                key={`${entry.timestamp}-${i}`}
                className="flex items-start gap-2 text-sm text-muted-foreground"
              >
                <span className="shrink-0 mt-0.5 h-1.5 w-1.5 rounded-full bg-amber-500/50" />
                <span className="flex-1 line-clamp-1">{entry.change}</span>
                <TimeAgo
                  date={entry.timestamp}
                  className="shrink-0 text-xs"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
