'use server';

import { spawnSync } from 'child_process';
import path from 'path';
import { revalidatePath } from 'next/cache';
import { getFrameworkRoot, getOrgs } from '@/lib/config';
import { getGoals, writeGoals, getGoalHistory } from '@/lib/data/goals';
import type { ActionResult, Goal, GoalsData } from '@/lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateOrg(org: string): string | null {
  const orgs = getOrgs();
  if (!orgs.includes(org)) {
    return `Invalid org: ${org}`;
  }
  return null;
}

function logEvent(category: string, data: Record<string, unknown>): void {
  try {
    const frameworkRoot = getFrameworkRoot();
    spawnSync(
      'bash',
      [path.join(frameworkRoot, 'bus', 'log-event.sh'), 'action', category, 'info', JSON.stringify(data)],
      { timeout: 5000, stdio: 'pipe' },
    );
  } catch {
    // Event logging is best-effort - never fail the action
  }
}

function revalidate(): void {
  revalidatePath('/');
  revalidatePath('/strategy');
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

export async function updateBottleneck(
  org: string,
  bottleneck: string,
): Promise<ActionResult> {
  try {
    const orgErr = validateOrg(org);
    if (orgErr) return { success: false, error: orgErr };

    const trimmed = bottleneck.trim().slice(0, 500);

    const data = getGoals(org);
    const oldBottleneck = data.bottleneck;
    data.bottleneck = trimmed;
    writeGoals(org, data);

    logEvent('bottleneck_changed', { old: oldBottleneck, new: trimmed });
    revalidate();

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function updateGoals(
  org: string,
  goals: Goal[],
): Promise<ActionResult> {
  try {
    const orgErr = validateOrg(org);
    if (orgErr) return { success: false, error: orgErr };

    // Validate each goal
    for (const g of goals) {
      if (!g.title || g.title.trim().length === 0) {
        return { success: false, error: 'Goal title cannot be empty' };
      }
      if (g.title.length > 200) {
        return { success: false, error: 'Goal title exceeds 200 characters' };
      }
    }

    const sanitized: Goal[] = goals.map((g, i) => ({
      id: g.id,
      title: g.title.trim().slice(0, 200),
      progress: Math.max(0, Math.min(100, Math.round(g.progress))),
      order: g.order ?? i,
    }));

    const data = getGoals(org);
    data.goals = sanitized;
    writeGoals(org, data);

    logEvent('goals_updated', { count: sanitized.length });
    revalidate();

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function addGoal(
  org: string,
  title: string,
): Promise<ActionResult> {
  try {
    const orgErr = validateOrg(org);
    if (orgErr) return { success: false, error: orgErr };

    const trimmed = title.trim();
    if (trimmed.length === 0) {
      return { success: false, error: 'Goal title cannot be empty' };
    }
    if (trimmed.length > 200) {
      return { success: false, error: 'Goal title exceeds 200 characters' };
    }

    const data = getGoals(org);
    const maxOrder = data.goals.reduce(
      (max, g) => Math.max(max, g.order ?? 0),
      -1,
    );
    const id = `goal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    data.goals.push({
      id,
      title: trimmed,
      progress: 0,
      order: maxOrder + 1,
    });

    writeGoals(org, data);

    logEvent('goal_added', { id, title: trimmed });
    revalidate();

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function deleteGoal(
  org: string,
  goalId: string,
): Promise<ActionResult> {
  try {
    const orgErr = validateOrg(org);
    if (orgErr) return { success: false, error: orgErr };

    const data = getGoals(org);
    const before = data.goals.length;
    data.goals = data.goals.filter((g) => g.id !== goalId);

    if (data.goals.length === before) {
      return { success: false, error: `Goal not found: ${goalId}` };
    }

    writeGoals(org, data);

    logEvent('goal_deleted', { id: goalId });
    revalidate();

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function reorderGoals(
  org: string,
  goalIds: string[],
): Promise<ActionResult> {
  try {
    const orgErr = validateOrg(org);
    if (orgErr) return { success: false, error: orgErr };

    const data = getGoals(org);

    // Build a map of id -> goal for fast lookup
    const goalMap = new Map<string, Goal>();
    for (const g of data.goals) {
      goalMap.set(g.id, g);
    }

    // Reorder: place goals in the order specified by goalIds
    const reordered: Goal[] = [];
    for (let i = 0; i < goalIds.length; i++) {
      const goal = goalMap.get(goalIds[i]);
      if (goal) {
        reordered.push({ ...goal, order: i });
        goalMap.delete(goalIds[i]);
      }
    }

    // Append any goals not in the provided list (preserve them)
    for (const remaining of goalMap.values()) {
      reordered.push({ ...remaining, order: reordered.length });
    }

    data.goals = reordered;
    writeGoals(org, data);

    revalidate();

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Read-only Server Actions (for client components that need server data)
// ---------------------------------------------------------------------------

export async function fetchGoals(org: string): Promise<GoalsData> {
  try {
    const orgErr = validateOrg(org);
    if (orgErr) return { bottleneck: '', goals: [] };
    return getGoals(org);
  } catch {
    return { bottleneck: '', goals: [] };
  }
}

export async function fetchGoalHistory(
  org: string,
): Promise<Array<{ timestamp: string; change: string }>> {
  try {
    const orgErr = validateOrg(org);
    if (orgErr) return [];
    return getGoalHistory(org);
  } catch {
    return [];
  }
}
