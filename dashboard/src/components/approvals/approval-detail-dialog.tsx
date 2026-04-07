'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { CategoryBadge, OrgBadge, TimeAgo } from '@/components/shared';
import { Badge } from '@/components/ui/badge';
import type { Approval } from '@/lib/types';

interface ApprovalDetailDialogProps {
  approval: Approval | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResolve?: (id: string, decision: 'approved' | 'rejected', note?: string) => void;
}

export function ApprovalDetailDialog({
  approval,
  open,
  onOpenChange,
  onResolve,
}: ApprovalDetailDialogProps) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!approval) return null;

  const isPending = approval.status === 'pending';

  async function handleResolve(decision: 'approved' | 'rejected') {
    if (!approval || !onResolve) return;
    setSubmitting(true);
    try {
      await onResolve(approval.id, decision, note.trim() || undefined);
      setNote('');
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{approval.title}</DialogTitle>
          <DialogDescription>Approval ID: {approval.id}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Meta badges */}
          <div className="flex flex-wrap items-center gap-2">
            <CategoryBadge category={approval.category} />
            <OrgBadge org={approval.org} />
            {!isPending && (
              <Badge
                variant={approval.status === 'approved' ? 'default' : 'destructive'}
              >
                {approval.status === 'approved' ? 'Approved' : 'Rejected'}
              </Badge>
            )}
          </div>

          {/* Details */}
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">Requested by</span>
              <p className="font-medium">{approval.agent}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Created</span>
              <div><TimeAgo date={approval.created_at} /></div>
            </div>
            {approval.resolved_at && (
              <>
                <div>
                  <span className="text-muted-foreground">Resolved by</span>
                  <p className="font-medium">{approval.resolved_by ?? '-'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Resolved at</span>
                  <div><TimeAgo date={approval.resolved_at} /></div>
                </div>
              </>
            )}
          </div>

          {/* Description */}
          {approval.description && (
            <>
              <Separator />
              <div>
                <p className="text-sm text-muted-foreground mb-1">Context</p>
                <p className="text-sm whitespace-pre-wrap">{approval.description}</p>
              </div>
            </>
          )}

          {/* Resolution note (for history items) */}
          {approval.resolution_note && (
            <>
              <Separator />
              <div>
                <p className="text-sm text-muted-foreground mb-1">Resolution note</p>
                <p className="text-sm whitespace-pre-wrap">{approval.resolution_note}</p>
              </div>
            </>
          )}

          {/* Note input for pending */}
          {isPending && (
            <>
              <Separator />
              <div className="grid gap-2">
                <Label htmlFor="approval-note">Note (optional)</Label>
                <Textarea
                  id="approval-note"
                  placeholder="Add a note for your decision..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={1000}
                />
              </div>
            </>
          )}
        </div>

        {isPending && (
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={submitting}
              onClick={() => handleResolve('rejected')}
            >
              Reject
            </Button>
            <Button
              disabled={submitting}
              onClick={() => handleResolve('approved')}
            >
              Approve
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
