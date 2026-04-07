// cortextOS Dashboard - Goals data fetcher
// Reads/writes goals.json directly from filesystem (not SQLite).

import fs from 'fs';
import path from 'path';
import os from 'os';
import { getGoalsPath } from '@/lib/config';
import type { GoalsFile, GoalsData } from '@/lib/types';

const DEFAULT_GOALS: GoalsFile = {
  bottleneck: '',
  goals: [],
};

/**
 * Read goals.json for an org. Returns default structure if file missing.
 */
export function getGoals(org: string): GoalsData {
  const filePath = getGoalsPath(org);
  if (!fs.existsSync(filePath)) {
    return { ...DEFAULT_GOALS, goals: [] };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);

    let goals: import('@/lib/types').Goal[] = [];
    if (Array.isArray(data.goals)) {
      goals = data.goals.map((g: unknown, i: number) => {
        if (typeof g === 'string') {
          // Legacy format: goals are plain strings
          return { id: `goal-${i}`, title: g, progress: 0, order: i };
        }
        // Dashboard format: goals are objects with id, title, progress
        const obj = g as Record<string, unknown>;
        return {
          id: (obj.id as string) ?? `goal-${i}`,
          title: (obj.title as string) ?? 'Untitled',
          progress: (obj.progress as number) ?? 0,
          order: (obj.order as number) ?? i,
        };
      });
    }

    return {
      bottleneck: data.bottleneck ?? '',
      goals,
      daily_focus: data.daily_focus ?? undefined,
      daily_focus_set_at: data.daily_focus_set_at ?? undefined,
    };
  } catch {
    return { ...DEFAULT_GOALS, goals: [] };
  }
}

/**
 * Atomic write of goals.json for an org (write to tmp, then rename).
 */
export function writeGoals(org: string, data: GoalsData): void {
  const filePath = getGoalsPath(org);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = path.join(os.tmpdir(), `goals-${org}-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, filePath);
}

/**
 * Read goal history by scanning events for bottleneck/goal changes.
 * Returns recent events related to goal modifications.
 */
export function getGoalHistory(
  org: string
): Array<{ timestamp: string; change: string }> {
  try {
    const { getRecentEvents } = require('./events');
    const events = getRecentEvents(50, org) as Array<{
      type: string;
      message?: string;
      timestamp: string;
    }>;
    return events
      .filter(
        (e) =>
          e.type === 'action' &&
          e.message &&
          (e.message.includes('goal') || e.message.includes('bottleneck'))
      )
      .map((e) => ({
        timestamp: e.timestamp,
        change: e.message ?? '',
      }));
  } catch {
    return [];
  }
}
