import { useState, useCallback, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useUiStore } from '@/stores/uiStore';
import { syncFolderStream, triggerSync, type SyncProgress } from '@/api/mailboxes';

/**
 * Folder-sync progress overlay state + the "sync recent emails" mutation.
 * Extracted verbatim from InboxPage.tsx — the sidebar-click effect's narrow
 * `[folderSyncRequested]` dependency array and eslint-disable are load-bearing;
 * widening the deps would re-trigger sync on every folder navigation, not just
 * an explicit sidebar click.
 */
export function useFolderSync(mailboxId?: string) {
  const queryClient = useQueryClient();
  const activeFolderId = useUiStore((s) => s.activeFolderId);
  const selectedFolderMailboxId = useUiStore((s) => s.selectedFolderMailboxId);
  const folderSyncRequested = useUiStore((s) => s.folderSyncRequested);
  const queryKeyId = mailboxId || 'unified';

  const [syncState, setSyncState] = useState<{
    active: boolean;
    progress: SyncProgress | null;
    cancel: (() => void) | null;
  }>({ active: false, progress: null, cancel: null });

  const startFolderSync = useCallback((mbId: string, fId: string) => {
    const startTime = Date.now();
    const finishSync = (hadNewMessages: boolean) => {
      const elapsed = Date.now() - startTime;
      const minDisplay = 800; // don't flash overlay for instant syncs
      const delay = hadNewMessages || elapsed >= minDisplay ? 0 : 0;
      // If completed too fast with no new data, skip overlay entirely
      if (elapsed < 500 && !hadNewMessages) {
        setSyncState({ active: false, progress: null, cancel: null });
        queryClient.invalidateQueries({ queryKey: ['inbox-events'] });
        return;
      }
      setTimeout(() => {
        setSyncState({ active: false, progress: null, cancel: null });
        queryClient.invalidateQueries({ queryKey: ['inbox-events'] });
      }, delay);
    };

    const cancel = syncFolderStream(
      mbId,
      fId,
      (progress) => setSyncState((s) => ({ ...s, progress })),
      (result) => finishSync(result.created > 0 || result.updated > 0 || result.deleted > 0),
      () => finishSync(false),
    );
    setSyncState({ active: true, progress: { created: 0, updated: 0, deleted: 0, skipped: 0, pageMessages: 0 }, cancel });
  }, [queryClient]);

  // React to sidebar folder click
  useEffect(() => {
    if (folderSyncRequested === 0) return;
    const mbId = mailboxId || selectedFolderMailboxId;
    if (mbId && activeFolderId) {
      startFolderSync(mbId, activeFolderId);
    }
  }, [folderSyncRequested]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync mutation — triggers delta sync to pull recent emails from Graph
  // If viewing a specific folder, syncs that folder with progress overlay
  const syncMutation = useMutation({
    mutationFn: async () => {
      const mbId = mailboxId || selectedFolderMailboxId;
      if (activeFolderId && mbId) {
        startFolderSync(mbId, activeFolderId);
      }
      return triggerSync();
    },
    onSuccess: () => {
      toast.success('Sync started — new emails will appear shortly');
      queryClient.invalidateQueries({ queryKey: ['inbox-events', queryKeyId] });
    },
    onError: (err: Error) => {
      toast.error(`Sync failed: ${err.message}`);
    },
  });

  return { syncState, setSyncState, syncMutation };
}
