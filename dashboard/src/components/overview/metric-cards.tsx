'use client';

import { useRouter } from 'next/navigation';
import {
  IconRobot,
  IconChecklist,
  IconShieldCheck,
  IconAlertTriangle,
} from '@tabler/icons-react';
import { cn } from '@/lib/utils';

interface MetricCardProps {
  label: string;
  value: number | string;
  sublabel?: string;
  icon: React.ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  href?: string;
}

function MetricCard({ label, value, sublabel, icon, href }: MetricCardProps) {
  const router = useRouter();
  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-4 transition-shadow hover:shadow-sm",
        href && "cursor-pointer hover:border-primary/30"
      )}
      onClick={href ? () => router.push(href) : undefined}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {label}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
          {sublabel && (
            <p className="mt-0.5 text-xs text-muted-foreground">{sublabel}</p>
          )}
        </div>
        <div className="rounded-md bg-muted/50 p-2">{icon}</div>
      </div>
    </div>
  );
}

interface MetricCardsProps {
  agentsOnline: number;
  agentsTotal: number;
  tasksCompleted: number;
  tasksInProgress: number;
  tasksPending: number;
  pendingApprovals: number;
  blockedTasks: number;
}

export function MetricCards({
  agentsOnline,
  agentsTotal,
  tasksCompleted,
  tasksInProgress,
  tasksPending,
  pendingApprovals,
  blockedTasks,
}: MetricCardsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <MetricCard
        label="Agents Online"
        value={`${agentsOnline}/${agentsTotal}`}
        sublabel={agentsOnline === agentsTotal ? 'All systems go' : `${agentsTotal - agentsOnline} offline`}
        icon={<IconRobot size={18} className="text-primary" />}
        href="/agents"
      />
      <MetricCard
        label="Tasks Today"
        value={tasksCompleted}
        sublabel={`${tasksInProgress} active, ${tasksPending} queued`}
        icon={<IconChecklist size={18} className="text-primary" />}
        href="/tasks"
      />
      <MetricCard
        label="Approvals"
        value={pendingApprovals}
        sublabel={pendingApprovals === 0 ? 'Queue clear' : 'Awaiting review'}
        icon={<IconShieldCheck size={18} className="text-primary" />}
        href="/approvals"
      />
      <MetricCard
        label="Blocked"
        value={blockedTasks}
        sublabel={blockedTasks === 0 ? 'No blockers' : 'Needs attention'}
        icon={<IconAlertTriangle size={18} className="text-primary" />}
        href="/tasks?status=blocked"
      />
    </div>
  );
}
