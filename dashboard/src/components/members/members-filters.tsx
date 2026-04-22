'use client';

import Link from 'next/link';
import { useSearchParams, usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useTransition } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface Props {
  priceTiers: string[];
  sources: string[];
}

function ChipSelector({ label, paramKey, current, options }: {
  label: string; paramKey: string; current: string; options: string[];
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const all = ['all', ...options];
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-xs text-muted-foreground mr-1">{label}:</span>
      {all.map((o) => {
        const sp = new URLSearchParams(params.toString());
        if (o === 'all') sp.delete(paramKey);
        else sp.set(paramKey, o);
        const active = (current === o) || (current === '' && o === 'all');
        return (
          <Link
            key={o}
            href={`${pathname}?${sp.toString()}`}
            data-testid={`members-filter-${paramKey}-${o}`}
            data-active={active ? 'true' : 'false'}
            className={cn(
              'text-xs px-2 py-0.5 rounded-sm border',
              active ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o}
          </Link>
        );
      })}
    </div>
  );
}

const SORTS: Array<{ value: string; label: string }> = [
  { value: 'tenure_desc', label: 'Tenure (longest first)' },
  { value: 'tenure_asc', label: 'Tenure (newest first)' },
  { value: 'days_to_churn_asc', label: 'Days to churn (urgent first)' },
  { value: 'priority', label: 'Intervention priority' },
  { value: 'level_desc', label: 'Level (high to low)' },
];

export function MembersFilters({ priceTiers, sources }: Props) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const [pending, start] = useTransition();

  const [q, setQ] = useState(params.get('q') || '');
  useEffect(() => setQ(params.get('q') || ''), [params]);

  const currentSort = params.get('sort') || 'tenure_desc';

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const sp = new URLSearchParams(params.toString());
    if (q.trim()) sp.set('q', q.trim()); else sp.delete('q');
    start(() => router.push(`${pathname}?${sp.toString()}`));
  }

  return (
    <div className="space-y-2" data-testid="members-filters">
      <form onSubmit={onSearch} className="flex items-center gap-2">
        <Input
          data-testid="members-search"
          className="max-w-sm"
          placeholder="Search handle or name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          type="submit"
          data-testid="members-search-submit"
          className="text-xs px-3 py-1 rounded border bg-primary text-primary-foreground disabled:opacity-50"
          disabled={pending}
        >
          {pending ? 'Searching…' : 'Search'}
        </button>
      </form>

      <ChipSelector label="Tab" paramKey="tab" current={params.get('tab') || ''} options={['active', 'cancelling', 'churned']} />
      <ChipSelector label="Price" paramKey="priceTier" current={params.get('priceTier') || ''} options={priceTiers} />
      {sources.length > 0 && (
        <ChipSelector label="Source" paramKey="source" current={params.get('source') || ''} options={sources} />
      )}
      <ChipSelector label="Open outreach" paramKey="hasOpenOutreach" current={params.get('hasOpenOutreach') || ''} options={['yes', 'no']} />

      <div className="flex flex-wrap items-center gap-1 pt-1">
        <span className="text-xs text-muted-foreground mr-1">Sort:</span>
        {SORTS.map((s) => {
          const sp = new URLSearchParams(params.toString());
          sp.set('sort', s.value);
          const active = currentSort === s.value;
          return (
            <Link
              key={s.value}
              href={`${pathname}?${sp.toString()}`}
              data-testid={`members-sort-${s.value}`}
              data-active={active ? 'true' : 'false'}
              className={cn(
                'text-xs px-2 py-0.5 rounded-sm border',
                active ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {s.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
