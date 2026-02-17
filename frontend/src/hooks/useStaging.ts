import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchStagedEmails,
  fetchStagingCount,
  rescueStagedEmail,
  batchRescueStagedEmails,
  executeStagedEmail,
  batchExecuteStagedEmails,
} from '@/api/staging';
import type { StagingResponse } from '@/api/staging';
import { useUiStore } from '@/stores/uiStore';

/**
 * TanStack Query hook for fetching staged emails with optional filters.
 */
export function useStaging(params?: {
  mailboxId?: string;
  status?: string;
  page?: number;
  limit?: number;
}) {
  return useQuery<StagingResponse>({
    queryKey: ['staging', params],
    queryFn: () => fetchStagedEmails(params),
  });
}

/**
 * TanStack Query hook for fetching staging count (for badge).
 * Refreshes every 60 seconds automatically.
 */
export function useStagingCount() {
  const selectedMailboxId = useUiStore((s) => s.selectedMailboxId);
  return useQuery<{ count: number }>({
    queryKey: ['staging-count', selectedMailboxId],
    queryFn: () => fetchStagingCount(selectedMailboxId ?? undefined),
    refetchInterval: 60_000,
  });
}

/**
 * Mutation hook to rescue a single staged email.
 * Invalidates staging and staging-count queries on success.
 */
export function useRescueStagedEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rescueStagedEmail(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staging'] });
      queryClient.invalidateQueries({ queryKey: ['staging-count'] });
    },
  });
}

/**
 * Mutation hook to batch rescue multiple staged emails.
 * Invalidates staging and staging-count queries on success.
 */
export function useBatchRescue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => batchRescueStagedEmails(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staging'] });
      queryClient.invalidateQueries({ queryKey: ['staging-count'] });
    },
  });
}

/**
 * Mutation hook to execute a single staged email immediately.
 * Invalidates staging and staging-count queries on success.
 */
export function useExecuteStagedEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => executeStagedEmail(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staging'] });
      queryClient.invalidateQueries({ queryKey: ['staging-count'] });
    },
  });
}

/**
 * Mutation hook to batch execute multiple staged emails immediately.
 * Invalidates staging and staging-count queries on success.
 */
export function useBatchExecute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => batchExecuteStagedEmails(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staging'] });
      queryClient.invalidateQueries({ queryKey: ['staging-count'] });
    },
  });
}
