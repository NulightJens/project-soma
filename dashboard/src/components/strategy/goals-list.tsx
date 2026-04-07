'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { IconPlus, IconTarget } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GoalItem } from './goal-item';
import {
  updateGoals,
  addGoal,
  deleteGoal,
  reorderGoals,
} from '@/lib/actions/goals';
import type { Goal } from '@/lib/types';

interface GoalsListProps {
  goals: Goal[];
  org: string;
  onRefresh: () => void;
}

export function GoalsList({ goals: initialGoals, org, onRefresh }: GoalsListProps) {
  const [goals, setGoals] = useState<Goal[]>(
    [...initialGoals].sort((a, b) => a.order - b.order),
  );
  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Sync when props change
  useEffect(() => {
    setGoals([...initialGoals].sort((a, b) => a.order - b.order));
  }, [initialGoals]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = goals.findIndex((g) => g.id === active.id);
      const newIndex = goals.findIndex((g) => g.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(goals, oldIndex, newIndex);
      setGoals(reordered);

      await reorderGoals(org, reordered.map((g) => g.id));
      onRefresh();
    },
    [goals, org, onRefresh],
  );

  const handleUpdate = useCallback(
    async (id: string, title: string, progress: number) => {
      setIsSaving(true);
      const updated = goals.map((g) =>
        g.id === id ? { ...g, title, progress } : g,
      );
      setGoals(updated);
      await updateGoals(org, updated);
      setIsSaving(false);
      onRefresh();
    },
    [goals, org, onRefresh],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setGoals((prev) => prev.filter((g) => g.id !== id));
      await deleteGoal(org, id);
      onRefresh();
    },
    [org, onRefresh],
  );

  const handleAdd = useCallback(async () => {
    const trimmed = newTitle.trim();
    if (trimmed.length === 0) return;

    setIsSaving(true);
    const result = await addGoal(org, trimmed);
    if (result.success) {
      setNewTitle('');
      setIsAdding(false);
      onRefresh();
    }
    setIsSaving(false);
  }, [newTitle, org, onRefresh]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Goals</h2>
        {isSaving && (
          <span className="text-xs text-muted-foreground animate-pulse">
            Saving...
          </span>
        )}
      </div>

      {goals.length === 0 && !isAdding ? (
        <div className="rounded-xl border border-dashed border-foreground/10 p-8 text-center">
          <IconTarget className="mx-auto h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground mb-3">No goals yet</p>
          <Button
            onClick={() => setIsAdding(true)}
            variant="outline"
            className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
          >
            <IconPlus className="h-4 w-4 mr-1.5" />
            Add your first goal
          </Button>
        </div>
      ) : (
        <>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={goals.map((g) => g.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {goals.map((goal) => (
                  <GoalItem
                    key={goal.id}
                    goal={goal}
                    onUpdate={handleUpdate}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {/* Add goal inline form */}
          {isAdding ? (
            <div className="rounded-lg border border-amber-500/30 bg-card p-4 space-y-3">
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="New goal title"
                className="text-sm"
                maxLength={200}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAdd();
                  if (e.key === 'Escape') {
                    setIsAdding(false);
                    setNewTitle('');
                  }
                }}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleAdd}
                  disabled={isSaving || newTitle.trim().length === 0}
                >
                  Add Goal
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setIsAdding(false);
                    setNewTitle('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              onClick={() => setIsAdding(true)}
              variant="outline"
              size="sm"
              className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
            >
              <IconPlus className="h-3.5 w-3.5 mr-1.5" />
              Add Goal
            </Button>
          )}
        </>
      )}
    </div>
  );
}
