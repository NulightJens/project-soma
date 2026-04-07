'use client';

import { createContext, useContext } from 'react';
import type { OrgFilter } from '@/lib/types';

interface OrgContextValue {
  currentOrg: OrgFilter;
  setCurrentOrg: (org: OrgFilter) => void;
  orgs: string[];
}

export const OrgContext = createContext<OrgContextValue>({
  currentOrg: 'all',
  setCurrentOrg: () => {},
  orgs: [],
});

export function useOrg() {
  return useContext(OrgContext);
}
