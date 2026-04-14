import { useState, useCallback, useEffect } from 'react';
import { AlertCircle, Brain, Sparkles } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/EmptyState';
import { PatternCard } from '@/components/patterns/PatternCard';
import { PatternFilters } from '@/components/patterns/PatternFilters';
import { PatternCustomizeDialog } from '@/components/patterns/PatternCustomizeDialog';
import { PatternPreviewDialog } from '@/components/patterns/PatternPreviewDialog';
import {
  usePatterns,
  useApprovePattern,
  useRejectPattern,
  useCustomizePattern,
  useTriggerAnalysis,
} from '@/hooks/usePatterns';
import { useUiStore } from '@/stores/uiStore';
import type { Pattern, PatternSuggestedAction } from '@/api/patterns';

/**
 * Patterns page showing card-based pattern suggestions with confidence
 * visualization, evidence, and approve/reject/customize actions.
 *
 * Manages filter and pagination state locally and reads the global mailbox
 * selection from uiStore for per-mailbox filtering.
 */
export function PatternsPage() {
  const selectedMailboxId = useUiStore((s) => s.selectedMailboxId);

  // Filter state
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [ruleFilter, setRuleFilter] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [page, setPage] = useState(1);

  // Debounce search input by 400ms
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Customize dialog state
  const [customizeTarget, setCustomizeTarget] = useState<Pattern | null>(null);

  // Preview dialog state
  const [previewTarget, setPreviewTarget] = useState<Pattern | null>(null);

  // Build query params — status, hasRule, search are server-side; patternType is client-side
  const statusParam = statusFilter !== 'all' ? statusFilter : undefined;
  const hasRuleParam = ruleFilter === 'has-rule' ? true : ruleFilter === 'no-rule' ? false : undefined;

  // Data hook
  const { data, isLoading, isError } = usePatterns(selectedMailboxId, statusParam, hasRuleParam, searchDebounced || undefined, page);

  // Mutation hooks
  const approveMutation = useApprovePattern();
  const rejectMutation = useRejectPattern();
  const customizeMutation = useCustomizePattern();
  const triggerMutation = useTriggerAnalysis();

  // Filter by pattern type client-side (API doesn't support patternType filter)
  const filteredPatterns = data?.patterns.filter(
    (p) => typeFilter === 'all' || p.patternType === typeFilter,
  ) ?? [];

  // Pagination
  const totalPages = data?.pagination.totalPages ?? 0;

  // Handlers
  const handleStatusChange = useCallback((value: string) => {
    setStatusFilter(value);
    setPage(1);
  }, []);

  const handleTypeChange = useCallback((value: string) => {
    setTypeFilter(value);
    setPage(1);
  }, []);

  const handleRuleFilterChange = useCallback((value: string) => {
    setRuleFilter(value);
    setPage(1);
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    setPage(1);
  }, []);

  const handleApprove = useCallback(
    (id: string) => {
      approveMutation.mutate(id);
    },
    [approveMutation],
  );

  const handleReject = useCallback(
    (id: string) => {
      rejectMutation.mutate(id);
    },
    [rejectMutation],
  );

  const handleOpenCustomize = useCallback(
    (id: string) => {
      const pattern = filteredPatterns.find((p) => p._id === id);
      if (pattern) setCustomizeTarget(pattern);
    },
    [filteredPatterns],
  );

  const handleCustomizeConfirm = useCallback(
    (patternId: string, action: PatternSuggestedAction) => {
      customizeMutation.mutate(
        { patternId, action },
        { onSuccess: () => setCustomizeTarget(null) },
      );
    },
    [customizeMutation],
  );

  const handlePreview = useCallback(
    (id: string) => {
      const pattern = filteredPatterns.find((p) => p._id === id);
      if (pattern) setPreviewTarget(pattern);
    },
    [filteredPatterns],
  );

  const handleAnalyze = useCallback(() => {
    triggerMutation.mutate(selectedMailboxId ?? undefined);
  }, [triggerMutation, selectedMailboxId]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Patterns</h1>
        <Button
          onClick={handleAnalyze}
          disabled={triggerMutation.isPending}
        >
          <Sparkles className="h-4 w-4 mr-2" />
          {triggerMutation.isPending ? 'Analyzing...' : 'Analyze Now'}
        </Button>
      </div>

      {/* Filters + count */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PatternFilters
          status={statusFilter}
          patternType={typeFilter}
          ruleFilter={ruleFilter}
          search={searchInput}
          onStatusChange={handleStatusChange}
          onPatternTypeChange={handleTypeChange}
          onRuleFilterChange={handleRuleFilterChange}
          onSearchChange={handleSearchChange}
        />
        {data && (
          <span className="text-sm text-muted-foreground shrink-0">
            {data.pagination.total.toLocaleString()} pattern{data.pagination.total !== 1 ? 's' : ''}
            {(statusFilter !== 'all' || typeFilter !== 'all' || ruleFilter !== 'all' || searchDebounced) && ' matching filters'}
          </span>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[280px] rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          icon={AlertCircle}
          title="Failed to load patterns"
          description="There was an error loading pattern suggestions. Please try again."
        />
      ) : filteredPatterns.length === 0 ? (
        <EmptyState
          icon={Brain}
          title="No patterns found"
          description={
            statusFilter !== 'all' || typeFilter !== 'all' || ruleFilter !== 'all' || searchDebounced
              ? 'Try adjusting your filters or search to see more patterns.'
              : 'The system needs more observation time to detect email patterns. Try running an analysis.'
          }
        />
      ) : (
        <>
          {/* Pattern cards grid */}
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {filteredPatterns.map((pattern) => (
              <PatternCard
                key={pattern._id}
                pattern={pattern}
                onApprove={handleApprove}
                onReject={handleReject}
                onCustomize={handleOpenCustomize}
                onPreview={handlePreview}
                isApproving={approveMutation.isPending}
                isRejecting={rejectMutation.isPending}
              />
            ))}
          </div>

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

      {/* Customize dialog */}
      <PatternCustomizeDialog
        pattern={customizeTarget}
        open={customizeTarget !== null}
        onOpenChange={(open) => { if (!open) setCustomizeTarget(null); }}
        onConfirm={handleCustomizeConfirm}
        isSubmitting={customizeMutation.isPending}
      />

      {/* Preview dialog */}
      <PatternPreviewDialog
        patternId={previewTarget?._id ?? null}
        senderLabel={previewTarget?.condition.senderEmail ?? previewTarget?.condition.senderDomain ?? 'sender'}
        open={previewTarget !== null}
        onOpenChange={(open) => { if (!open) setPreviewTarget(null); }}
      />
    </div>
  );
}
