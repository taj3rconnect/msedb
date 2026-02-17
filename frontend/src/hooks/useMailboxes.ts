import { useQuery } from '@tanstack/react-query';
import { fetchMailboxes } from '@/api/mailboxes';
import type { MailboxInfo } from '@/api/auth';

/**
 * TanStack Query hook for fetching connected mailboxes.
 */
export function useMailboxes() {
  const query = useQuery({
    queryKey: ['mailboxes'],
    queryFn: fetchMailboxes,
  });

  return {
    mailboxes: (query.data?.mailboxes ?? []) as MailboxInfo[],
    isLoading: query.isLoading,
  };
}
