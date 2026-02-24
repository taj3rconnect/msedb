import { useQuery } from '@tanstack/react-query';
import { fetchMailboxFolders } from '@/api/mailboxes';

/**
 * Fetch mail folders for a mailbox via React Query.
 */
export function useFolders(mailboxId: string | undefined) {
  const query = useQuery({
    queryKey: ['mailbox-folders', mailboxId],
    queryFn: () => fetchMailboxFolders(mailboxId!),
    enabled: !!mailboxId,
    staleTime: 5 * 60 * 1000,
  });

  return {
    folders: query.data?.folders ?? [],
    isLoading: query.isLoading,
  };
}
