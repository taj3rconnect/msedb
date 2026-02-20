import { useState, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { RuleCard } from './RuleCard';
import type { Rule } from '@/api/rules';

interface RuleListProps {
  rules: Rule[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onRun: (id: string) => void;
  onEdit: (rule: Rule) => void;
  runningRuleId?: string | null;
  onReorder: (mailboxId: string, ruleIds: string[]) => void;
}

/**
 * Sortable rule list with drag-and-drop reordering via @dnd-kit.
 *
 * Maintains local state for optimistic reorder updates and
 * calls onReorder with the new order of rule IDs on drag end.
 */
export function RuleList({ rules, onToggle, onDelete, onRename, onRun, onEdit, runningRuleId, onReorder }: RuleListProps) {
  // Local state for optimistic reorder
  const [localRules, setLocalRules] = useState(rules);

  // Sync local state when external rules change (e.g., after refetch)
  useEffect(() => {
    setLocalRules(rules);
  }, [rules]);

  // Configure drag sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 5px movement before drag starts (prevents accidental drags)
      },
    }),
    useSensor(KeyboardSensor),
  );

  const ruleIds = localRules.map((r) => r._id);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    const oldIndex = localRules.findIndex((r) => r._id === active.id);
    const newIndex = localRules.findIndex((r) => r._id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(localRules, oldIndex, newIndex);
    setLocalRules(reordered);

    // Get mailboxId from the first rule (all rules in the list share the same mailbox)
    const mailboxId = localRules[0]?.mailboxId;
    if (mailboxId) {
      onReorder(mailboxId, reordered.map((r) => r._id));
    }
  }

  if (localRules.length === 0) {
    return null;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ruleIds} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {localRules.map((rule) => (
            <RuleCard
              key={rule._id}
              rule={rule}
              onToggle={onToggle}
              onDelete={onDelete}
              onRename={onRename}
              onRun={onRun}
              onEdit={onEdit}
              isRunning={runningRuleId === rule._id}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
