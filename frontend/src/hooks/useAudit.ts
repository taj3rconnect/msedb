import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchAuditLogs, undoAuditAction } from '@/api/audit';
import type { AuditResponse } from '@/api/audit';

/**
 * TanStack Query hook for fetching audit logs with optional filters.
 */
export function useAudit(params?: {
  mailboxId?: string;
  ruleId?: string;
  action?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}) {
  return useQuery<AuditResponse>({
    queryKey: ['audit', params],
    queryFn: () => fetchAuditLogs(params),
  });
}

/**
 * Mutation hook to undo an audit action.
 * Invalidates audit queries on success.
 */
export function useUndoAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => undoAuditAction(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}
