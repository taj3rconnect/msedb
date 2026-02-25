import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchScheduledEmails,
  fetchScheduledCount,
  cancelScheduledEmail,
} from '@/api/scheduledEmails';
import type { ScheduledEmailsResponse } from '@/api/scheduledEmails';

/**
 * TanStack Query hook for fetching scheduled emails with optional filters.
 */
export function useScheduledEmails(params?: {
  status?: string;
  page?: number;
  limit?: number;
}) {
  return useQuery<ScheduledEmailsResponse>({
    queryKey: ['scheduled-emails', params],
    queryFn: () => fetchScheduledEmails(params),
  });
}

/**
 * TanStack Query hook for fetching pending scheduled email count (for badge).
 * Refreshes every 60 seconds.
 */
export function useScheduledCount() {
  return useQuery<{ count: number }>({
    queryKey: ['scheduled-count'],
    queryFn: () => fetchScheduledCount(),
    refetchInterval: 60_000,
  });
}

/**
 * Mutation hook to cancel a scheduled email.
 * Invalidates scheduled-emails and scheduled-count queries on success.
 */
export function useCancelScheduledEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelScheduledEmail(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-emails'] });
      queryClient.invalidateQueries({ queryKey: ['scheduled-count'] });
    },
  });
}
