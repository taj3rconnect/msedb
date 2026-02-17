import { useState, useCallback } from 'react';
import { AlertCircle, Shield } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/EmptyState';
import { RuleList } from '@/components/rules/RuleList';
import {
  useRules,
  useToggleRule,
  useDeleteRule,
  useReorderRules,
} from '@/hooks/useRules';
import { useUiStore } from '@/stores/uiStore';

/**
 * Rules page with drag-and-drop reordering, per-rule stats,
 * enable/disable toggles, and per-mailbox filtering.
 *
 * Replaces the ComingSoonPage placeholder at /rules.
 */
export function RulesPage() {
  const selectedMailboxId = useUiStore((s) => s.selectedMailboxId);
  const [page, setPage] = useState(1);

  // Data hook -- filter by selected mailbox
  const { data, isLoading, isError } = useRules({
    mailboxId: selectedMailboxId ?? undefined,
    page,
  });

  // Mutation hooks
  const toggleMutation = useToggleRule();
  const deleteMutation = useDeleteRule();
  const reorderMutation = useReorderRules();

  // Pagination
  const totalPages = data?.pagination.totalPages ?? 0;
  const rules = data?.rules ?? [];

  // Handlers
  const handleToggle = useCallback(
    (id: string) => {
      toggleMutation.mutate(id);
    },
    [toggleMutation],
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteMutation.mutate(id);
    },
    [deleteMutation],
  );

  const handleReorder = useCallback(
    (mailboxId: string, ruleIds: string[]) => {
      reorderMutation.mutate({ mailboxId, ruleIds });
    },
    [reorderMutation],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Rules</h1>
      </div>

      {/* Mailbox hint */}
      {!selectedMailboxId && (
        <p className="text-sm text-muted-foreground">
          Select a mailbox from the sidebar to view rules.
        </p>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          icon={AlertCircle}
          title="Failed to load rules"
          description="There was an error loading your rules. Please try again."
        />
      ) : rules.length === 0 ? (
        <EmptyState
          icon={Shield}
          title="No rules yet"
          description="Approve a pattern to create your first rule, or rules will be created automatically when you approve pattern suggestions."
        />
      ) : (
        <>
          {/* Rule list with drag-and-drop */}
          <RuleList
            rules={rules}
            onToggle={handleToggle}
            onDelete={handleDelete}
            onReorder={handleReorder}
          />

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
