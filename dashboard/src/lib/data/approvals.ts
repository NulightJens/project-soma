// cortextOS Dashboard - Approval data fetcher
// Reads from SQLite (synced from JSON approval files on disk).

import { db } from '@/lib/db';
import type { Approval } from '@/lib/types';

/**
 * Get pending approvals, newest first.
 */
export function getPendingApprovals(org?: string): Approval[] {
  return getApprovalsByStatus('pending', org);
}

/**
 * Get resolved approvals with optional filters.
 */
export function getResolvedApprovals(
  org?: string,
  filters?: { agent?: string; category?: string; dateRange?: [Date, Date] }
): Approval[] {
  const conditions: string[] = ["status != 'pending'"];
  const params: (string | number)[] = [];

  if (org) {
    conditions.push('org = ?');
    params.push(org);
  }
  if (filters?.agent) {
    conditions.push('agent = ?');
    params.push(filters.agent);
  }
  if (filters?.category) {
    conditions.push('category = ?');
    params.push(filters.category);
  }
  if (filters?.dateRange) {
    conditions.push('resolved_at >= ? AND resolved_at <= ?');
    params.push(
      filters.dateRange[0].toISOString(),
      filters.dateRange[1].toISOString()
    );
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  try {
    const rows = db
      .prepare(
        `SELECT id, title, category, description, status, agent, org,
                created_at, resolved_at, resolved_by, resolution_note, source_file
         FROM approvals ${where}
         ORDER BY resolved_at DESC`
      )
      .all(...params) as Record<string, unknown>[];

    return rows.map(rowToApproval);
  } catch (err) {
    console.error('[data/approvals] getResolvedApprovals error:', err);
    return [];
  }
}

/**
 * Get count of pending approvals (for sidebar badge).
 */
export function getPendingCount(org?: string): number {
  const conditions: string[] = ["status = 'pending'"];
  const params: (string | number)[] = [];

  if (org) {
    conditions.push('org = ?');
    params.push(org);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  try {
    const row = db
      .prepare(`SELECT COUNT(*) as count FROM approvals ${where}`)
      .get(...params) as { count: number } | undefined;

    return row?.count ?? 0;
  } catch (err) {
    console.error('[data/approvals] getPendingCount error:', err);
    return 0;
  }
}

/**
 * Get a single approval by ID.
 */
export function getApprovalById(id: string): Approval | null {
  try {
    const row = db
      .prepare(
        `SELECT id, title, category, description, status, agent, org,
                created_at, resolved_at, resolved_by, resolution_note, source_file
         FROM approvals WHERE id = ?`
      )
      .get(id) as Record<string, unknown> | undefined;

    return row ? rowToApproval(row) : null;
  } catch (err) {
    console.error('[data/approvals] getApprovalById error:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getApprovalsByStatus(status: string, org?: string): Approval[] {
  const conditions: string[] = ['status = ?'];
  const params: (string | number)[] = [status];

  if (org) {
    conditions.push('org = ?');
    params.push(org);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  try {
    const rows = db
      .prepare(
        `SELECT id, title, category, description, status, agent, org,
                created_at, resolved_at, resolved_by, resolution_note, source_file
         FROM approvals ${where}
         ORDER BY created_at DESC`
      )
      .all(...params) as Record<string, unknown>[];

    return rows.map(rowToApproval);
  } catch (err) {
    console.error('[data/approvals] getApprovalsByStatus error:', err);
    return [];
  }
}

function rowToApproval(row: Record<string, unknown>): Approval {
  return {
    id: row.id as string,
    title: row.title as string,
    category: row.category as Approval['category'],
    description: (row.description as string) ?? undefined,
    status: row.status as Approval['status'],
    agent: row.agent as string,
    org: row.org as string,
    created_at: row.created_at as string,
    resolved_at: (row.resolved_at as string) ?? undefined,
    resolved_by: (row.resolved_by as string) ?? undefined,
    resolution_note: (row.resolution_note as string) ?? undefined,
    source_file: (row.source_file as string) ?? undefined,
  };
}
