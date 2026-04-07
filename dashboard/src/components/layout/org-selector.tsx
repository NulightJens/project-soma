'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface OrgSelectorProps {
  orgs: string[];
  currentOrg: string;
  onOrgChange: (org: string) => void;
}

export function OrgSelector({ orgs, currentOrg, onOrgChange }: OrgSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(value: string) {
    if (!value) return;
    onOrgChange(value);

    // Update URL so server-rendered pages re-fetch with the org filter
    const params = new URLSearchParams(searchParams.toString());
    if (value === 'all') {
      params.delete('org');
    } else {
      params.set('org', value);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <Select value={currentOrg} onValueChange={(v) => { if (v) handleChange(v); }}>
      <SelectTrigger className="w-48">
        <SelectValue placeholder="Select org" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Orgs</SelectItem>
        {orgs.map((org) => (
          <SelectItem key={org} value={org}>
            {org}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
