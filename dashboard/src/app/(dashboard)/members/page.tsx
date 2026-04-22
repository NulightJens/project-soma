import {
  getMembersDirectory,
  getMembersDirectoryFilterOptions,
  type DirectoryFilters,
} from '@/lib/data/skool';
import { MembersFilters } from '@/components/members/members-filters';
import { MembersTable } from '@/components/members/members-table';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function asStr(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;

  const filters: DirectoryFilters = {
    tab: (asStr(sp.tab) as DirectoryFilters['tab']) || undefined,
    priceTier: asStr(sp.priceTier),
    source: asStr(sp.source),
    hasOpenOutreach: (asStr(sp.hasOpenOutreach) as DirectoryFilters['hasOpenOutreach']) || undefined,
    sort: (asStr(sp.sort) as DirectoryFilters['sort']) || 'tenure_desc',
    search: asStr(sp.q),
    limit: 800,
  };

  const [members, opts] = await Promise.all([
    getMembersDirectory(filters),
    getMembersDirectoryFilterOptions(),
  ]);

  return (
    <div className="space-y-5 p-6 max-w-[1400px] mx-auto" data-testid="members-page">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Full Agent Architects directory. Filter by tab, price tier, acquisition source, or outreach status. Sort by tenure, urgency, or intervention priority.
        </p>
      </div>

      <MembersFilters priceTiers={opts.priceTiers} sources={opts.sources} />

      <p className="text-xs text-muted-foreground" data-testid="members-count">
        {members.length} {members.length === 1 ? 'member' : 'members'}
      </p>

      <MembersTable members={members} />
    </div>
  );
}
