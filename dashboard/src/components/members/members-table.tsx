import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { DirectoryMember } from '@/lib/data/skool';

function tabVariant(tab: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (tab === 'active') return 'default';
  if (tab === 'cancelling') return 'destructive';
  if (tab === 'churned') return 'secondary';
  return 'outline';
}

function priorityDot(p: 'high' | 'medium' | 'low' | undefined) {
  if (p === 'high') return <span className="inline-block h-2 w-2 rounded-full bg-red-500 mr-1" />;
  if (p === 'medium') return <span className="inline-block h-2 w-2 rounded-full bg-amber-500 mr-1" />;
  if (p === 'low') return <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/60 mr-1" />;
  return null;
}

export function MembersTable({ members }: { members: DirectoryMember[] }) {
  if (members.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground" data-testid="members-empty">
          No members match the current filters.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border" data-testid="members-table">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Tab</TableHead>
            <TableHead className="text-right">Level</TableHead>
            <TableHead className="text-right">$/mo</TableHead>
            <TableHead>Source</TableHead>
            <TableHead className="text-right">Tenure</TableHead>
            <TableHead className="text-right">Days to churn</TableHead>
            <TableHead>Intervention</TableHead>
            <TableHead className="text-right">Open outreach</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => (
            <TableRow key={m.handle} data-testid="members-row" data-tab={m.tab}>
              <TableCell>
                <div className="font-medium">{m.name ?? '—'}</div>
                <div className="text-[11px] text-muted-foreground">@{m.handle}</div>
              </TableCell>
              <TableCell><Badge variant={tabVariant(m.tab)} className="text-[10px]">{m.tab}</Badge></TableCell>
              <TableCell className="text-right tabular-nums">{m.level ?? '—'}</TableCell>
              <TableCell className="text-right tabular-nums">
                {m.subscription_price != null ? `$${m.subscription_price}` : '—'}
              </TableCell>
              <TableCell className="text-xs">{m.acquisition_source ?? '—'}</TableCell>
              <TableCell className="text-right tabular-nums">{m.days_in_community != null ? `${m.days_in_community}d` : '—'}</TableCell>
              <TableCell className="text-right tabular-nums">{m.cancelled_churns_in_days ?? '—'}</TableCell>
              <TableCell className="text-xs">
                {m.intervention ? (
                  <span className="inline-flex items-center" title={m.intervention.rationale}>
                    {priorityDot(m.intervention.priority)}
                    {m.intervention.label}
                  </span>
                ) : <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums" data-testid="members-open-outreach">
                {m.open_outreach > 0 ? (
                  <Badge variant="secondary" className="text-[10px]">{m.open_outreach}</Badge>
                ) : <span className="text-muted-foreground">0</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
