'use client';

import Link from 'next/link';
import { IconExternalLink } from '@tabler/icons-react';
import { ProgressBar } from '@/components/charts/progress-bar';
import type { Goal } from '@/lib/types';

interface GoalProgressListProps {
  goals: Goal[];
}

export function GoalProgressList({ goals }: GoalProgressListProps) {
  if (goals.length === 0) {
    return (
      <div className="py-4 text-center text-sm text-muted-foreground">
        No goals set.{' '}
        <Link href="/strategy" className="text-primary hover:underline">
          Visit Strategy to add goals.
        </Link>
      </div>
    );
  }

  const topGoals = goals
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .slice(0, 3);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Top Goals
        </span>
        <Link
          href="/strategy"
          className="flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Edit
          <IconExternalLink size={12} />
        </Link>
      </div>
      <div className="space-y-3">
        {topGoals.map((goal) => (
          <div key={goal.id} className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium truncate mr-2">{goal.title}</span>
              <span className="text-muted-foreground tabular-nums text-xs shrink-0">
                {Math.round(goal.progress)}%
              </span>
            </div>
            <ProgressBar value={goal.progress} height="sm" />
          </div>
        ))}
      </div>
    </div>
  );
}
