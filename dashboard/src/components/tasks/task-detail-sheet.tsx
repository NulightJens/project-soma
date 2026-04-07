'use client';

import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  PriorityBadge,
  StatusBadge,
  OrgBadge,
  TimeAgo,
} from '@/components/shared';
import { IconPencil } from '@tabler/icons-react';
import type { Task, TaskStatus, TaskPriority } from '@/lib/types';

export interface TaskDetailSheetProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStatusChange: (taskId: string, status: TaskStatus, note?: string) => void;
  onDelete?: (taskId: string) => void;
  onEdit?: (taskId: string) => void;
}

const STATUS_TRANSITIONS: Record<TaskStatus, { label: string; status: TaskStatus; variant: 'default' | 'outline' | 'destructive' | 'secondary' }[]> = {
  pending: [
    { label: 'Start', status: 'in_progress', variant: 'default' },
    { label: 'Block', status: 'blocked', variant: 'destructive' },
  ],
  in_progress: [
    { label: 'Complete', status: 'completed', variant: 'default' },
    { label: 'Block', status: 'blocked', variant: 'destructive' },
    { label: 'Back to Pending', status: 'pending', variant: 'outline' },
  ],
  blocked: [
    { label: 'Unblock', status: 'in_progress', variant: 'default' },
    { label: 'Back to Pending', status: 'pending', variant: 'outline' },
  ],
  completed: [
    { label: 'Reopen', status: 'pending', variant: 'outline' },
  ],
};

export function TaskDetailSheet({
  task,
  open,
  onOpenChange,
  onStatusChange,
  onDelete,
  onEdit,
}: TaskDetailSheetProps) {
  const [note, setNote] = useState('');
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editPriority, setEditPriority] = useState<string>('normal');
  const [editAssignee, setEditAssignee] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!task) return null;

  const transitions = STATUS_TRANSITIONS[task.status] ?? [];

  function startEditing() {
    setEditTitle(task!.title);
    setEditDesc(task!.description || '');
    setEditPriority(task!.priority);
    setEditAssignee(task!.assignee || '');
    setEditing(true);
    setError(null);
  }

  async function saveEdit() {
    if (!task || !editTitle.trim()) {
      setError('Title is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle.trim(),
          description: editDesc.trim(),
          priority: editPriority,
          assignee: editAssignee.trim() || undefined,
        }),
      });
      if (res.ok) {
        setEditing(false);
        onEdit?.(task.id);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to save');
      }
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(newStatus: TaskStatus) {
    if (!task) return;
    setUpdating(true);
    setError(null);
    try {
      await onStatusChange(task.id, newStatus, note.trim() || undefined);
      setNote('');
    } catch {
      setError('Failed to update status');
    } finally {
      setUpdating(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setEditing(false); setConfirmDelete(false); setError(null); } }}>
      <SheetContent side="right" className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          {editing ? (
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="text-lg font-semibold"
              placeholder="Task title..."
            />
          ) : (
            <div className="flex items-start gap-2 pr-8">
              <SheetTitle className="flex-1">{task.title}</SheetTitle>
              <Button variant="ghost" size="icon-sm" onClick={startEditing} title="Edit task" className="shrink-0">
                <IconPencil size={14} />
              </Button>
            </div>
          )}
          <SheetDescription>Task ID: {task.id}</SheetDescription>
        </SheetHeader>

        {/* Error banner */}
        {error && (
          <div className="mx-4 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <div className="space-y-4 px-4">
          {/* Status + Priority + Org row */}
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={task.status} />
            {editing ? (
              <Select value={editPriority} onValueChange={(v) => { if (v) setEditPriority(v); }}>
                <SelectTrigger className="w-28 h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <PriorityBadge priority={task.priority} />
            )}
            <OrgBadge org={task.org} />
            {task.needs_approval && (
              <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                Needs Approval
              </span>
            )}
          </div>

          <Separator />

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
            <div>
              <span className="text-muted-foreground">Assignee</span>
              {editing ? (
                <Input
                  value={editAssignee}
                  onChange={(e) => setEditAssignee(e.target.value)}
                  placeholder="agent name or human"
                  className="mt-1 h-7 text-sm"
                />
              ) : (
                <p className="font-medium">{task.assignee ?? 'Unassigned'}</p>
              )}
            </div>
            <div>
              <span className="text-muted-foreground">Project</span>
              <p className="font-medium">{task.project ?? '-'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Created</span>
              <div><TimeAgo date={task.created_at} /></div>
            </div>
            {task.updated_at && (
              <div>
                <span className="text-muted-foreground">Updated</span>
                <div><TimeAgo date={task.updated_at} /></div>
              </div>
            )}
            {task.completed_at && (
              <div>
                <span className="text-muted-foreground">Completed</span>
                <div><TimeAgo date={task.completed_at} /></div>
              </div>
            )}
          </div>

          {/* Description */}
          <Separator />
          {editing ? (
            <div className="grid gap-2">
              <Label className="text-xs text-muted-foreground">Description</Label>
              <Textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                rows={4}
                placeholder="Task description..."
              />
            </div>
          ) : task.description ? (
            <div>
              <p className="text-sm text-muted-foreground mb-1">Description</p>
              <p className="text-sm whitespace-pre-wrap">{task.description}</p>
            </div>
          ) : null}

          {/* Edit save/cancel */}
          {editing && (
            <div className="flex gap-2">
              <Button size="sm" onClick={saveEdit} disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          )}

          {/* Existing notes */}
          {!editing && task.notes && (
            <>
              <Separator />
              <div>
                <p className="text-sm text-muted-foreground mb-1">Notes</p>
                <p className="text-sm whitespace-pre-wrap">{task.notes}</p>
              </div>
            </>
          )}

          {!editing && (
            <>
              <Separator />
              {/* Note input + status buttons */}
              <div className="space-y-3">
                <div className="grid gap-2">
                  <Label htmlFor="task-note">Add note (optional)</Label>
                  <Textarea
                    id="task-note"
                    placeholder="Note for status change..."
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={2000}
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {!editing && (
          <SheetFooter>
            <div className="flex flex-wrap items-center gap-2 w-full">
              {transitions.map((t) => (
                <Button
                  key={t.status}
                  variant={t.variant}
                  size="sm"
                  disabled={updating || deleting}
                  onClick={() => handleStatusChange(t.status)}
                >
                  {t.label}
                </Button>
              ))}
              <div className="ml-auto">
                {confirmDelete ? (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-destructive mr-1">Delete?</span>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={deleting}
                      onClick={async () => {
                        if (!task || !onDelete) return;
                        setDeleting(true);
                        await onDelete(task.id);
                        setDeleting(false);
                        setConfirmDelete(false);
                      }}
                    >
                      {deleting ? 'Deleting...' : 'Yes'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmDelete(false)}
                    >
                      No
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setConfirmDelete(true)}
                  >
                    Delete
                  </Button>
                )}
              </div>
            </div>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
