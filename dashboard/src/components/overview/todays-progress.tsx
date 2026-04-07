import { format } from 'date-fns';
import { IconChecks, IconFlag } from '@tabler/icons-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Task, Event } from '@/lib/types';

interface TodaysProgressProps {
  completedTasks: Task[];
  milestones: Event[];
}

export function TodaysProgress({ completedTasks, milestones }: TodaysProgressProps) {
  const todayStr = format(new Date(), 'MMM d, yyyy');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Today&apos;s Progress
          </span>
          <span className="text-xs text-muted-foreground font-normal">{todayStr}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Task count */}
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-primary/10 p-2">
            <IconChecks size={20} className="text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums">{completedTasks.length}</p>
            <p className="text-xs text-muted-foreground">
              task{completedTasks.length !== 1 ? 's' : ''} completed
            </p>
          </div>
        </div>

        {/* Task list */}
        {completedTasks.length > 0 ? (
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {completedTasks.slice(0, 8).map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between text-sm px-2 py-1 rounded hover:bg-muted/50"
              >
                <span className="truncate mr-2">{task.title}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {task.assignee ?? 'unassigned'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No tasks completed yet today. Try messaging your Orchestrator on Telegram to get started.</p>
        )}

        {/* Milestones */}
        {milestones.length > 0 && (
          <div className="border-t pt-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <IconFlag size={14} />
              Milestones
            </div>
            {milestones.slice(0, 5).map((event) => (
              <div key={event.id} className="text-sm px-2 py-1">
                <span>{event.message ?? event.category}</span>
                <span className="text-xs text-muted-foreground ml-2">
                  {event.agent}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
