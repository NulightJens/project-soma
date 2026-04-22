import { getSkoolSupabase } from '@/lib/supabase-client';

export interface CrmCopyTemplate {
  id: string;
  sequence_slug: string;
  step: number;
  variant: string;
  subject: string | null;
  body: string | null;
  cta: string | null;
  notes: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

// Human-readable copy for the sequence / trigger mapping shown in the editor.
export const SEQUENCE_PURPOSE: Record<string, { label: string; trigger: string }> = {
  'new-member-welcome': {
    label: 'New member welcome',
    trigger: 'Fires the moment a new member appears in the active tab (tab_changed reason=new_member).',
  },
  'active-milestone': {
    label: 'Active milestone',
    trigger: 'Fires on join; steps schedule out at day 30, day 90, day 180.',
  },
  'cancellation-retention': {
    label: 'Cancellation retention',
    trigger: 'Fires the moment a member transitions to the cancelling tab. Steps at 0h, 24h, 48h.',
  },
  'churned-winback': {
    label: 'Churned win-back',
    trigger: 'Fires the moment a member transitions to the churned tab. Steps at day 30, 90, 180.',
  },
};

export async function listTemplates(): Promise<CrmCopyTemplate[]> {
  const sb = getSkoolSupabase();
  const { data, error } = await sb
    .from('crm_copy_templates')
    .select('*')
    .order('sequence_slug', { ascending: true })
    .order('step', { ascending: true })
    .order('variant', { ascending: true });
  if (error) throw new Error(`list templates: ${error.message}`);
  return (data ?? []) as CrmCopyTemplate[];
}

export async function getTemplate(id: string): Promise<CrmCopyTemplate | null> {
  const sb = getSkoolSupabase();
  const { data, error } = await sb
    .from('crm_copy_templates')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`get template: ${error.message}`);
  return (data as CrmCopyTemplate) || null;
}

export async function updateTemplate(
  id: string,
  patch: { body?: string | null; cta?: string | null; subject?: string | null; notes?: string | null },
  updatedBy: string,
): Promise<CrmCopyTemplate> {
  const sb = getSkoolSupabase();
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  };
  if (patch.body !== undefined) payload.body = patch.body;
  if (patch.cta !== undefined) payload.cta = patch.cta;
  if (patch.subject !== undefined) payload.subject = patch.subject;
  if (patch.notes !== undefined) payload.notes = patch.notes;

  const { data, error } = await sb
    .from('crm_copy_templates')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(`update template: ${error.message}`);
  return data as CrmCopyTemplate;
}

// Fetch the latest template for a given (sequence, step, variant). Used by
// trigger-crm-outreach and by the Refresh-copy button on existing outreach rows.
export async function lookupTemplate(sequence_slug: string, step: number, variant = 'default'): Promise<CrmCopyTemplate | null> {
  const sb = getSkoolSupabase();
  const { data, error } = await sb
    .from('crm_copy_templates')
    .select('*')
    .eq('sequence_slug', sequence_slug)
    .eq('step', step)
    .eq('variant', variant)
    .maybeSingle();
  if (error) throw new Error(`lookup: ${error.message}`);
  return (data as CrmCopyTemplate) || null;
}

// Refresh an existing crm_outreach row's payload.copy from the latest template.
export async function refreshOutreachCopy(outreachId: string): Promise<{ updated: boolean; template_id: string | null }> {
  const sb = getSkoolSupabase();
  const { data: row, error: rowErr } = await sb
    .from('crm_outreach')
    .select('id, sequence_slug, step, payload, status')
    .eq('id', outreachId)
    .maybeSingle();
  if (rowErr) throw new Error(`fetch outreach: ${rowErr.message}`);
  if (!row) throw new Error('outreach row not found');
  if (row.status === 'sent' || row.status === 'responded') {
    throw new Error(`refuse to refresh copy on ${row.status} row`);
  }

  const variant = (row.payload as { copy?: { variant?: string } } | null)?.copy?.variant || 'default';
  const tpl = await lookupTemplate(row.sequence_slug as string, row.step as number, variant);
  if (!tpl) return { updated: false, template_id: null };

  const existingPayload = (row.payload as Record<string, unknown>) || {};
  const newPayload = {
    ...existingPayload,
    copy: {
      ...(existingPayload.copy as Record<string, unknown> || {}),
      body: tpl.body,
      cta: tpl.cta,
      subject: tpl.subject,
      variant,
      refreshed_from_template_at: new Date().toISOString(),
    },
  };

  const { error: upErr } = await sb
    .from('crm_outreach')
    .update({ payload: newPayload })
    .eq('id', outreachId);
  if (upErr) throw new Error(`update outreach: ${upErr.message}`);
  return { updated: true, template_id: tpl.id };
}
