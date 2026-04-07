'use client';

import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  IconDots,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconTrash,
  IconLoader2,
} from '@tabler/icons-react';
import type { HealthStatus } from '@/lib/types';

interface AgentActionsProps {
  agentName: string;
  org: string;
  health: HealthStatus;
  onAction?: () => void;
}

type LifecycleAction = 'start' | 'stop' | 'restart_continue' | 'restart_fresh';

export function AgentActions({
  agentName,
  org,
  health,
  onAction,
}: AgentActionsProps) {
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  async function handleLifecycle(action: LifecycleAction) {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentName)}/lifecycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, org }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Action failed (${res.status})`);
      }

      setFeedback({ type: 'success', message: `${action.replace('_', ' ')} succeeded` });
      onAction?.();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setLoading(false);
      setTimeout(() => setFeedback(null), 3000);
    }
  }

  async function handleDelete() {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentName)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Delete failed (${res.status})`);
      }

      setFeedback({ type: 'success', message: 'Agent deleted' });
      setConfirmDelete(false);
      onAction?.();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setLoading(false);
      setTimeout(() => setFeedback(null), 3000);
    }
  }

  const isDown = health === 'down' || health === 'stale';
  const isHealthy = health === 'healthy';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" className="h-6 w-6" />
          }
          onClick={(e) => e.preventDefault()}
        >
          {loading ? (
            <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <IconDots className="h-3.5 w-3.5" />
          )}
          <span className="sr-only">Agent actions</span>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" sideOffset={4}>
          {isDown && (
            <DropdownMenuItem onClick={() => handleLifecycle('start')}>
              <IconPlayerPlay className="h-4 w-4" />
              Start
            </DropdownMenuItem>
          )}
          {isHealthy && (
            <DropdownMenuItem onClick={() => handleLifecycle('stop')}>
              <IconPlayerStop className="h-4 w-4" />
              Stop
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => handleLifecycle('restart_continue')}>
            <IconRefresh className="h-4 w-4" />
            Restart (Continue)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleLifecycle('restart_fresh')}>
            <IconRefresh className="h-4 w-4" />
            Restart (Fresh)
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            variant="destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <IconTrash className="h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Feedback toast-like display */}
      {feedback && (
        <span
          className={`absolute -bottom-6 right-0 z-10 whitespace-nowrap text-xs ${
            feedback.type === 'success' ? 'text-green-600' : 'text-destructive'
          }`}
        >
          {feedback.message}
        </span>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Agent</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{agentName}</strong>? This
              action cannot be undone. All agent configuration and data will be
              permanently removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={loading}
            >
              {loading && <IconLoader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Delete Agent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
