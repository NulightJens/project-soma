import { notFound } from 'next/navigation';
import { getActiveFormBySlug } from '@/lib/data/forms';
import { DynamicForm } from '@/components/forms/dynamic-form';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function asStr(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export default async function FormPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const memberHandleRaw = asStr(sp.member) || '';
  // Strip leading @ if present, lowercase, keep only safe chars.
  const memberHandle = memberHandleRaw.replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 80);

  const form = await getActiveFormBySlug(slug);
  if (!form) notFound();

  return (
    <div className="space-y-5" data-testid="form-page">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="form-title">{form.title}</h1>
        <p className="text-sm text-muted-foreground">{form.purpose}</p>
        {!memberHandle && (
          <p
            className="text-xs text-amber-700 dark:text-amber-400 mt-2"
            data-testid="missing-member-warning"
          >
            No member handle in the link. If James sent you this, the link should include <code>?member=your-handle</code>. Filling without it still works but we will not be able to map this response back to you automatically.
          </p>
        )}
        {memberHandle && (
          <p className="text-xs text-muted-foreground" data-testid="member-context">
            responding as <span className="font-mono">@{memberHandle}</span>
          </p>
        )}
      </div>

      <DynamicForm form={form} memberHandle={memberHandle || 'anonymous'} />

      <p className="text-[11px] text-muted-foreground text-center pt-2">
        Agent Architects — {form.slug} v{form.version}
      </p>
    </div>
  );
}
