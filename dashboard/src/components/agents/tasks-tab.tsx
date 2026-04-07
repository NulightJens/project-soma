'use client';

import { useState } from 'react';
import { StatusBadge } from '@/components/shared/status-badge';
import { PriorityBadge } from '@/components/shared/priority-badge';
import { Card, CardContent } from '@/components/ui/card';
import { TaskDetailSheet } from '@/components/tasks/task-detail-sheet';
import type { Task } from '@/lib/types';

interface TasksTabProps {
  tasks: Task[];
}

export function TasksTab({ tasks }: TasksTabProps) {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  if (tasks.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No tasks assigned to this agent.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {tasks.map((task) => (
          <Card
            key={task.id}
            size="sm"
            className="cursor-pointer transition-colors hover:bg-accent/50"
            onClick={() => {
              setSelectedTask(task);
              setSheetOpen(true);
            }}
          >
            <CardContent>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{task.title}</p>
                  {task.description && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {task.description}
                    </p>
                  )}
                  {task.project && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Project: {task.project}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <PriorityBadge priority={task.priority} />
                  <StatusBadge status={task.status} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {selectedTask && (
        <TaskDetailSheet
          task={selectedTask}
          open={sheetOpen}
          onOpenChange={(open) => {
            setSheetOpen(open);
            if (!open) setSelectedTask(null);
          }}
          onStatusChange={() => {}}
        />
      )}
    </>
  );
}
