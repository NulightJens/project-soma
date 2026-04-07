// cortextOS Dashboard - Event data fetcher
// Reads from SQLite (synced from JSONL event files on disk).

import { db } from '@/lib/db';
import type { Event } from '@/lib/types';

/**
 * Get recent events, newest first. Supports optional filters.
 */
export function getRecentEvents(
  limit: number = 50,
  org?: string,
  agent?: string,
  category?: string
): Event[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (org) {
    conditions.push('org = ?');
    params.push(org);
  }
  if (agent) {
    conditions.push('agent = ?');
    params.push(agent);
  }
  if (category) {
    conditions.push('category = ?');
    params.push(category);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const rows = db
      .prepare(
        `SELECT id, timestamp, agent, org, type, category, severity, data, message, source_file
         FROM events ${where}
         ORDER BY timestamp DESC
         LIMIT ?`
      )
      .all(...params, limit) as Record<string, unknown>[];

    return rows.map(rowToEvent);
  } catch (err) {
    console.error('[data/events] getRecentEvents error:', err);
    return [];
  }
}

/**
 * Get today's events (UTC), optionally filtered by org/agent.
 */
export function getEventsToday(org?: string, agent?: string): Event[] {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayISO = todayStart.toISOString();

  const conditions: string[] = ['timestamp >= ?'];
  const params: (string | number)[] = [todayISO];

  if (org) {
    conditions.push('org = ?');
    params.push(org);
  }
  if (agent) {
    conditions.push('agent = ?');
    params.push(agent);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  try {
    const rows = db
      .prepare(
        `SELECT id, timestamp, agent, org, type, category, severity, data, message, source_file
         FROM events ${where}
         ORDER BY timestamp DESC`
      )
      .all(...params) as Record<string, unknown>[];

    return rows.map(rowToEvent);
  } catch (err) {
    console.error('[data/events] getEventsToday error:', err);
    return [];
  }
}

/**
 * Get events by agent (for agent detail page).
 */
export function getEventsByAgent(agentName: string, limit: number = 50): Event[] {
  return getRecentEvents(limit, undefined, agentName);
}

/**
 * Get events by category (action, error, metric, milestone, etc.).
 */
export function getEventsByCategory(category: string, org?: string): Event[] {
  return getRecentEvents(100, org, undefined, category);
}

/**
 * Get milestone events.
 */
export function getMilestones(org?: string): Event[] {
  return getRecentEvents(100, org, undefined, 'milestone');
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function rowToEvent(row: Record<string, unknown>): Event {
  let parsedData: Record<string, unknown> | undefined;
  if (row.data) {
    try {
      parsedData = JSON.parse(row.data as string);
    } catch {
      parsedData = undefined;
    }
  }

  return {
    id: row.id as string,
    timestamp: row.timestamp as string,
    agent: row.agent as string,
    org: row.org as string,
    type: row.type as Event['type'],
    category: (row.category as string) ?? '',
    severity: row.severity as Event['severity'],
    data: parsedData,
    message: (row.message as string) ?? undefined,
    source_file: (row.source_file as string) ?? undefined,
  };
}
