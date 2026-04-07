// cortextOS Dashboard - Organization metadata reader
// Reads context.json and brand-voice.md from the framework root org directory.

import fs from 'fs';
import { getOrgContextPath, getOrgBrandVoicePath } from '@/lib/config';

export interface OrgContext {
  name: string;
  description: string;
  industry: string;
  icp: string;
  value_prop: string;
}

const DEFAULT_CONTEXT: OrgContext = {
  name: '',
  description: '',
  industry: '',
  icp: '',
  value_prop: '',
};

/**
 * Read context.json for an org. Returns defaults if file missing.
 */
export function getOrganizationContext(org: string): OrgContext {
  const filePath = getOrgContextPath(org);
  if (!fs.existsSync(filePath)) {
    return { ...DEFAULT_CONTEXT };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    return {
      name: data.name ?? '',
      description: data.description ?? '',
      industry: data.industry ?? '',
      icp: data.icp ?? '',
      value_prop: data.value_prop ?? '',
    };
  } catch {
    return { ...DEFAULT_CONTEXT };
  }
}

/**
 * Read brand-voice.md for an org. Returns empty string if missing.
 */
export function getBrandVoice(org: string): string {
  const filePath = getOrgBrandVoicePath(org);
  if (!fs.existsSync(filePath)) {
    return '';
  }
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}
