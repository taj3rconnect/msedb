import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchPatterns,
  approvePattern,
  rejectPattern,
  customizePattern,
  triggerAnalysis,
} from '@/api/patterns';
import type { PatternsResponse, PatternSuggestedAction } from '@/api/patterns';

/**
 * TanStack Query hook for fetching patterns with optional filters.
 */
export function usePatterns(mailboxId?: string | null, status?: string) {
  return useQuery<PatternsResponse>({
    queryKey: ['patterns', mailboxId ?? null, status ?? null],
    queryFn: () =>
      fetchPatterns({
        mailboxId: mailboxId ?? undefined,
        status: status ?? undefined,
      }),
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
