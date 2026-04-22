import { getSkoolSupabase } from '@/lib/supabase-client';

export type QuestionKind = 'text' | 'textarea' | 'single_select' | 'multi_select' | 'rating_5';

export interface FormQuestion {
  id: string;
  kind: QuestionKind;
  label: string;
  required: boolean;
  options?: string[];
}

export interface CrmForm {
  id: string;
  slug: string;
  version: number;
  title: string;
  purpose: string;
  trigger_type: string;
  questions: FormQuestion[];
  active: boolean;
  created_at: string;
}

export async function getActiveFormBySlug(slug: string): Promise<CrmForm | null> {
  const sb = getSkoolSupabase();
  const { data, error } = await sb
    .from('crm_forms')
    .select('id, slug, version, title, purpose, trigger_type, questions, active, created_at')
    .eq('slug', slug)
    .eq('active', true)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`form ${slug}: ${error.message}`);
  if (!data) return null;
  return data as CrmForm;
}

export interface SubmitResult {
  responseId: string;
  formId: string;
  memberHandle: string;
}

export async function submitFormResponse(params: {
  formId: string;
  memberHandle: string;
  answers: Record<string, unknown>;
  channel?: string | null;
  notes?: string | null;
}): Promise<SubmitResult> {
  const sb = getSkoolSupabase();
  const { data, error } = await sb
    .from('crm_form_responses')
    .insert({
      form_id: params.formId,
      member_handle: params.memberHandle,
      answers: params.answers,
      channel: params.channel ?? null,
      notes: params.notes ?? null,
    })
    .select('id, form_id, member_handle')
    .single();
  if (error) throw new Error(`submit: ${error.message}`);
  return { responseId: data.id as string, formId: data.form_id as string, memberHandle: data.member_handle as string };
}

export function validateAnswers(questions: FormQuestion[], answers: Record<string, unknown>): string | null {
  for (const q of questions) {
    const v = answers[q.id];
    if (q.required) {
      if (v === undefined || v === null) return `missing answer for "${q.id}"`;
      if (typeof v === 'string' && v.trim() === '') return `empty answer for "${q.id}"`;
      if (Array.isArray(v) && v.length === 0) return `empty selection for "${q.id}"`;
    }
    if (v === undefined || v === null) continue;
    if (q.kind === 'single_select' && typeof v === 'string' && q.options && !q.options.includes(v)) {
      return `invalid option for "${q.id}"`;
    }
    if (q.kind === 'multi_select' && Array.isArray(v) && q.options) {
      for (const sel of v) if (typeof sel !== 'string' || !q.options.includes(sel)) return `invalid option in "${q.id}"`;
    }
    if (q.kind === 'rating_5') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 5) return `rating out of 1..5 for "${q.id}"`;
    }
  }
  return null;
}
