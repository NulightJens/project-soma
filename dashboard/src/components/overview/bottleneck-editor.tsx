'use client';

import { useState, useRef, useTransition } from 'react';
import { IconPencil, IconCheck, IconLoader2 } from '@tabler/icons-react';
import { updateBottleneck } from '@/lib/actions/goals';

interface BottleneckEditorProps {
  org: string;
  initialValue: string;
}

export function BottleneckEditor({ org, initialValue }: BottleneckEditorProps) {
  const [value, setValue] = useState(initialValue);
  const [isEditing, setIsEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleEdit() {
    setIsEditing(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function handleBlur() {
    setIsEditing(false);
    const trimmed = value.trim();

    if (trimmed === initialValue) return;

    startTransition(async () => {
      const result = await updateBottleneck(org, trimmed);
      if (result.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      textareaRef.current?.blur();
    }
    if (e.key === 'Escape') {
      setValue(initialValue);
      setIsEditing(false);
    }
  }

  const isEmpty = !value.trim();

  return (
    <div className="group relative">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Current Bottleneck
        </span>
        {isPending && (
          <IconLoader2 size={14} className="animate-spin text-muted-foreground" />
        )}
        {saved && (
          <IconCheck size={14} className="text-success" />
        )}
      </div>
      {isEditing ? (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="w-full resize-none rounded-md border border-primary/30 bg-background px-3 py-2 text-lg font-medium focus:outline-none focus:ring-2 focus:ring-primary/50"
          rows={2}
          maxLength={500}
          placeholder="Click to set the current bottleneck..."
        />
      ) : (
        <button
          type="button"
          onClick={handleEdit}
          className="flex w-full items-start gap-2 rounded-md px-3 py-2 text-left hover:bg-muted/60 transition-colors cursor-text"
        >
          <span
            className={
              isEmpty
                ? 'text-lg italic text-muted-foreground'
                : 'text-lg font-medium'
            }
          >
            {isEmpty ? 'Click to set the current bottleneck...' : value}
          </span>
          <IconPencil
            size={16}
            className="mt-1 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
          />
        </button>
      )}
    </div>
  );
}
