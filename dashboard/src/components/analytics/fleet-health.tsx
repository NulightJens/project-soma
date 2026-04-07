import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  IconHeartRateMonitor,
  IconAlertTriangle,
  IconBug,
  IconMailbox,
} from '@tabler/icons-react';
// Types inlined to avoid importing from server-only reports.ts
interface FleetHealthAgent {
  name: string;
  heartbeatAgeMin: number;
  isStale: boolean;
  events: number;
  realErrors: number;
  crashes: number;
  heartbeats: number;
  stability: number;
}

interface AgentMsgCount {
  name: string;
  sent: number;
  received: number;
}

interface FleetHealthData {
  agents: FleetHealthAgent[];
  messageBus: { totalToday: number; pending: number; perAgent: AgentMsgCount[] };
  fleetStability: number;
  staleCount: number;
  errorCount: number;
}

interface FleetHealthProps {
  data: FleetHealthData | null;
}

function StatusDot({ stability }: { stability: number }) {
  const color = stability >= 90 ? 'bg-green-500' : stability >= 70 ? 'bg-amber-500' : 'bg-red-500';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

export function FleetHealth({ data }: FleetHealthProps) {
  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Fleet Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            No health data available. Run collect-analytics.sh to generate reports.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
        Fleet Health
      </h2>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Fleet Stability</p>
                <p className="text-2xl font-semibold mt-1">{data.fleetStability}%</p>
              </div>
              <div className="rounded-md bg-muted/50 p-2">
                <IconHeartRateMonitor size={18} className="text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Stale Agents</p>
                <p className="text-2xl font-semibold mt-1">{data.staleCount}</p>
              </div>
              <div className="rounded-md bg-muted/50 p-2">
                <IconAlertTriangle size={18} className={data.staleCount > 0 ? 'text-amber-500' : 'text-muted-foreground'} />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Real Errors</p>
                <p className="text-2xl font-semibold mt-1">{data.errorCount}</p>
              </div>
              <div className="rounded-md bg-muted/50 p-2">
                <IconBug size={18} className={data.errorCount > 0 ? 'text-red-500' : 'text-muted-foreground'} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Agent health grid */}
      <Card>
        <CardContent className="pt-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="text-left pb-2 font-medium">Agent</th>
                  <th className="text-right pb-2 font-medium">Uptime</th>
                  <th className="text-right pb-2 font-medium">Restarts</th>
                  <th className="text-right pb-2 font-medium">Events Today</th>
                  <th className="text-right pb-2 font-medium">Errors</th>
                  <th className="text-right pb-2 font-medium">Last Heartbeat</th>
                </tr>
              </thead>
              <tbody>
                {data.agents.map((agent) => (
                  <tr key={agent.name} className="border-b last:border-0">
                    <td className="py-2 flex items-center gap-2">
                      <StatusDot stability={agent.stability} />
                      <span className="font-medium">{agent.name}</span>
                      {agent.isStale && (
                        <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600">stale</span>
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums">{agent.stability}%</td>
                    <td className="py-2 text-right tabular-nums">{agent.crashes}</td>
                    <td className="py-2 text-right tabular-nums">{agent.events}</td>
                    <td className="py-2 text-right tabular-nums">
                      <span className={agent.realErrors > 0 ? 'text-red-500 font-medium' : ''}>
                        {agent.realErrors}
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">
                      {agent.heartbeatAgeMin < 60
                        ? `${agent.heartbeatAgeMin}m`
                        : `${Math.round(agent.heartbeatAgeMin / 60)}h`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Message bus stats - daily totals */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <IconMailbox size={16} className="text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Messages Today</span>
            </div>
          </div>
          <div className="flex items-center gap-4 mb-3">
            <div className="text-center">
              <p className="text-lg font-semibold tabular-nums">{data.messageBus.totalToday}</p>
              <p className="text-[10px] text-muted-foreground">Delivered Today</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold tabular-nums">{data.messageBus.pending}</p>
              <p className="text-[10px] text-muted-foreground">Pending</p>
            </div>
          </div>
          {data.messageBus.perAgent.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {data.messageBus.perAgent.map(a => (
                <div key={a.name} className="rounded-md bg-muted/30 px-2.5 py-1.5">
                  <p className="text-xs font-medium">{a.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {a.sent} sent, {a.received} received
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
