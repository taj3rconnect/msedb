import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchPatterns,
  fetchAllPatterns,
  suggestSenders,
  bulkApprovePatterns,
  approvePattern,
  rejectPattern,
  customizePattern,
  triggerAnalysis,
} from '@/api/patterns';
import type {
  PatternsResponse,
  PatternSuggestedAction,
  BulkRuleAction,
  SenderSuggestion,
} from '@/api/patterns';

/**
 * TanStack Query hook for fetching patterns with optional filters.
 */
export function usePatterns(mailboxId?: string | null, status?: string, hasRule?: boolean, search?: string, page?: number) {
  return useQuery<PatternsResponse>({
    queryKey: ['patterns', mailboxId ?? null, status ?? null, hasRule ?? null, search ?? null, page ?? 1],
    queryFn: () =>
      fetchPatterns({
        mailboxId: mailboxId ?? undefined,
        status: status ?? undefined,
        hasRule,
        search: search || undefined,
        page: page ?? 1,
      }),
  });
}

/**
 * Fetch every pattern matching the current page filters, across all pages.
 * Only runs while `enabled` (i.e. the bulk-rule drawer is open).
 */
export function useAllPatterns(
  params: { mailboxId?: string | null; status?: string; hasRule?: boolean; search?: string },
  enabled: boolean,
) {
  const { mailboxId, status, hasRule, search } = params;
  return useQuery({
    queryKey: ['patterns', 'all', mailboxId ?? null, status ?? null, hasRule ?? null, search ?? null],
    enabled,
    queryFn: () =>
      fetchAllPatterns({
        mailboxId: mailboxId ?? undefined,
        status: status ?? undefined,
        hasRule,
        search: search || undefined,
      }),
  });
}

/**
 * Typeahead suggestions for sender email / domain. Disabled below 2 characters.
 */
export function useSenderSuggestions(q: string, mailboxId?: string | null) {
  const query = q.trim();
  return useQuery<SenderSuggestion[]>({
    queryKey: ['patterns', 'suggest', query, mailboxId ?? null],
    enabled: query.length >= 2,
    staleTime: 30_000,
    queryFn: () => suggestSenders(query, mailboxId ?? undefined),
  });
}

/**
 * Mutation hook to create rules for many patterns at once.
 * Invalidates patterns, rules, and dashboard stats on success.
 */
export function useBulkApprovePatterns() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ patternIds, actionType }: { patternIds: string[]; actionType: BulkRuleAction }) =>
      bulkApprovePatterns(patternIds, actionType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patterns'] });
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'stats'] });
    },
  });
}

/**
 * Mutation hook to approve a pattern.
 * Invalidates patterns and dashboard stats on success.
 */
export function useApprovePattern() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patternId: string) => approvePattern(patternId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patterns'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'stats'] });
    },
  });
}

/**
 * Mutation hook to reject a pattern.
 * Invalidates patterns and dashboard stats on success.
 */
export function useRejectPattern() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patternId: string) => rejectPattern(patternId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patterns'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'stats'] });
    },
  });
}

/**
 * Mutation hook to customize a pattern's action and approve it.
 * Invalidates patterns and dashboard stats on success.
 */
export function useCustomizePattern() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      patternId,
      action,
    }: {
      patternId: string;
      action: PatternSuggestedAction;
    }) => customizePattern(patternId, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patterns'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'stats'] });
    },
  });
}

/**
 * Mutation hook to trigger on-demand pattern analysis.
 * Invalidates patterns on success.
 */
export function useTriggerAnalysis() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mailboxId?: string) => triggerAnalysis(mailboxId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patterns'] });
    },
  });
}
