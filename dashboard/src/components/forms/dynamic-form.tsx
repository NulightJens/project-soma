'use client';

// Renders a CrmForm dynamically from its JSONB questions schema and submits
// answers as JSON to /api/forms/[slug]/submit.
//
// SECURITY NOTE (tracked tonight, 2026-04-21):
// The member_handle is supplied via a URL query param (?member=<handle>) and
// is NOT token-signed. DMs sent from Skool are considered a trusted channel,
// and the worst-case abuse is an anonymous person submitting a form under
// someone else's handle — we can detect that in downstream analysis because
// each response is timestamped and rate-limited per IP. When we move forms to
// a broader audience or need anti-spoof guarantees, wire in signed tokens
// (JWT with member claim, 30-day expiry).

import { useState } from 'react';
import type { CrmForm, FormQuestion } from '@/lib/data/forms';

interface Props {
  form: CrmForm;
  memberHandle: string;
}

type AnswerValue = string | string[] | number;

function RatingStars({ value, onChange }: { value: number | null; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-1" data-testid="rating-input">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={`h-9 w-9 rounded border text-sm font-medium ${value === n ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'}`}
          data-testid={`rating-${n}`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

function SingleSelect({ q, value, onChange }: { q: FormQuestion; value: string | null; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5" data-testid={`single-${q.id}`}>
      {(q.options || []).map((opt) => (
        <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="radio"
            name={q.id}
            value={opt}
            checked={value === opt}
            onChange={() => onChange(opt)}
            required={q.required}
          />
          {opt}
        </label>
      ))}
    </div>
  );
}

function MultiSelect({ q, value, onChange }: { q: FormQuestion; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="space-y-1.5" data-testid={`multi-${q.id}`}>
      {(q.options || []).map((opt) => (
        <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={value.includes(opt)}
            onChange={(e) => {
              if (e.target.checked) onChange([...value, opt]);
              else onChange(value.filter((v) => v !== opt));
            }}
          />
          {opt}
        </label>
      ))}
    </div>
  );
}

export function DynamicForm({ form, memberHandle }: Props) {
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch(`/api/forms/${form.slug}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ member: memberHandle, answers }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `status ${r.status}`);
      setSuccess(true);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div
        className="rounded-lg border bg-green-500/10 p-6 text-center space-y-2"
        data-testid="form-success"
      >
        <h2 className="text-lg font-semibold">Thanks — response recorded.</h2>
        <p className="text-sm text-muted-foreground">
          James will see this shortly. You can close this window.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5" data-testid="dynamic-form">
      {form.questions.map((q) => {
        const val = answers[q.id];
        return (
          <div key={q.id} className="space-y-2">
            <label className="text-sm font-medium block">
              {q.label}
              {q.required && <span className="text-destructive ml-1">*</span>}
            </label>
            {q.kind === 'text' && (
              <input
                type="text"
                required={q.required}
                value={typeof val === 'string' ? val : ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                data-testid={`q-${q.id}`}
              />
            )}
            {q.kind === 'textarea' && (
              <textarea
                required={q.required}
                value={typeof val === 'string' ? val : ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[100px]"
                data-testid={`q-${q.id}`}
              />
            )}
            {q.kind === 'single_select' && (
              <SingleSelect q={q} value={typeof val === 'string' ? val : null} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
            )}
            {q.kind === 'multi_select' && (
              <MultiSelect q={q} value={Array.isArray(val) ? val : []} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
            )}
            {q.kind === 'rating_5' && (
              <RatingStars value={typeof val === 'number' ? val : null} onChange={(n) => setAnswers((a) => ({ ...a, [q.id]: n }))} />
            )}
          </div>
        );
      })}

      {error && <p className="text-sm text-destructive" data-testid="form-error">{error}</p>}

      <div className="flex items-center justify-end gap-3 pt-2 border-t">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
          data-testid="form-submit"
        >
          {submitting ? 'Submitting…' : 'Submit response'}
        </button>
      </div>
    </form>
  );
}
