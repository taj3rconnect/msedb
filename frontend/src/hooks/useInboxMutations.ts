import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { EventItem } from '@/api/events';
import type { MailboxInfo } from '@/api/auth';
import { createRule, updateRule, fetchRules, runRule, deleteRulesBySender } from '@/api/rules';
import type { RuleAction, RuleConditions } from '@/api/rules';
import { applyActionsToMessages, fetchDeletedCount, fetchDeletedCountAll, emptyDeletedItems } from '@/api/mailboxes';
import { markEventsReadInCache, removeEventsFromCache } from '@/lib/inboxCache';

export interface ConfirmPayload {
  mailboxId: string;
  actions: RuleAction[];
  actionLabel: string;
  senderEmails: string[];
  messageIds: string[];
  ruleName?: string;
  existingRuleId?: string;
  extraConditions?: Partial<RuleConditions>;
  runNow?: boolean;
}

interface UseInboxMutationsParams {
  mailboxId?: string;
  isUnifiedMode: boolean;
  connectedMailboxes: MailboxInfo[];
  visibleEvents: EventItem[];
  selectedIds: Set<string>;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  setDeletedEventIds: Dispatch<SetStateAction<Set<string>>>;
  setPreviewEvent: Dispatch<SetStateAction<EventItem | null>>;
  dialogEvents: EventItem[];
  setDialogEvents: Dispatch<SetStateAction<EventItem[]>>;
  setDialogOpen: Dispatch<SetStateAction<boolean>>;
}

/**
 * All inbox mutations (rule creation, bulk/quick delete, mark-read, undelete,
 * empty-deleted) plus their wrapped handlers. Extracted verbatim from
 * InboxPage.tsx — see docs/large-file-split-plan.md §1 for the cache-write and
 * "always" (all-mailboxes) behaviors this preserves.
 */
export function useInboxMutations({
  mailboxId,
  isUnifiedMode,
  connectedMailboxes,
  visibleEvents,
  selectedIds,
  setSelectedIds,
  setDeletedEventIds,
  setPreviewEvent,
  dialogEvents,
  setDialogEvents,
  setDialogOpen,
}: UseInboxMutationsParams) {
  const queryClient = useQueryClient();
  const queryKeyId = mailboxId || 'unified';

  // Single mutation that creates/updates rules + runs them against the mailbox
  const confirmMutation = useMutation({
    mutationFn: async (payload: ConfirmPayload) => {
      const uniqueSenders = [...new Set(payload.senderEmails)];
      let rulesCreated = 0;
      let rulesFailed = 0;
      let ruleUpdated = false;
      const createdRuleIds: string[] = [];

      if (payload.existingRuleId) {
        // Update existing rule: merge new senders into its conditions
        try {
          const rulesData = await fetchRules({ mailboxId: payload.mailboxId, limit: 100 });
          const existingRule = rulesData.rules.find((r) => r._id === payload.existingRuleId);
          if (existingRule) {
            const currentSenders = existingRule.conditions.senderEmail
              ? Array.isArray(existingRule.conditions.senderEmail)
                ? existingRule.conditions.senderEmail
                : [existingRule.conditions.senderEmail]
              : [];
            const mergedSenders = [...new Set([...currentSenders, ...uniqueSenders])];
            const mergedConditions = { ...existingRule.conditions, ...payload.extraConditions, senderEmail: mergedSenders };
            // Remove keys explicitly set to undefined — user cleared those fields
            (Object.keys(mergedConditions) as (keyof typeof mergedConditions)[]).forEach((k) => {
              if (mergedConditions[k] === undefined) delete mergedConditions[k];
            });
            await updateRule(payload.existingRuleId, {
              name: payload.ruleName || existingRule.name,
              conditions: mergedConditions,
              actions: payload.actions,
            });
            ruleUpdated = true;
            createdRuleIds.push(payload.existingRuleId);
          }
        } catch {
          rulesFailed = 1;
        }
      } else {
        // Create rules for each unique sender
        const ruleResults = await Promise.allSettled(
          uniqueSenders.map((senderEmail) => {
            const name = payload.ruleName
              ? uniqueSenders.length > 1
                ? `${payload.ruleName} — ${senderEmail}`
                : payload.ruleName
              : `Always ${payload.actionLabel} from ${senderEmail}`;
            return createRule({
              mailboxId: payload.mailboxId,
              name,
              conditions: { senderEmail, ...payload.extraConditions },
              actions: payload.actions,
              skipStaging: true,
            });
          }),
        );

        for (const r of ruleResults) {
          if (r.status === 'fulfilled') {
            rulesCreated++;
            createdRuleIds.push(r.value.rule._id);
          } else {
            rulesFailed++;
          }
        }
      }

      // Run rules against entire mailbox (if Run Now checked)
      let totalApplied = 0;
      let totalFailed = 0;
      if (payload.runNow !== false && createdRuleIds.length > 0) {
        const runResults = await Promise.allSettled(
          createdRuleIds.map((id) => runRule(id)),
        );
        for (const r of runResults) {
          if (r.status === 'fulfilled') {
            totalApplied += r.value.applied;
            totalFailed += r.value.failed;
          }
        }
      }

      return { rulesCreated, rulesFailed, ruleUpdated, totalApplied, totalFailed };
    },
    onSuccess: ({ rulesCreated, rulesFailed, ruleUpdated, totalApplied, totalFailed }) => {
      const parts: string[] = [];

      if (ruleUpdated) {
        parts.push('Rule updated');
      }
      if (rulesCreated > 0) {
        parts.push(
          rulesCreated === 1
            ? '1 rule created'
            : `${rulesCreated} rules created`,
        );
      }
      if (rulesFailed > 0) {
        parts.push(`${rulesFailed} rules failed`);
      }
      if (totalApplied > 0) {
        parts.push(
          totalApplied === 1
            ? '1 email processed'
            : `${totalApplied} emails processed`,
        );
      }
      if (totalFailed > 0) {
        parts.push(`${totalFailed} emails failed`);
      }

      const hasFailures = rulesFailed > 0 || totalFailed > 0;
      if (hasFailures) {
        toast.warning(parts.join(', '));
      } else {
        toast.success(parts.join(', '));
      }

      queryClient.invalidateQueries({ queryKey: ['rules'] });
      queryClient.invalidateQueries({ queryKey: ['inbox-events'] });
      setDialogOpen(false);
      setSelectedIds(new Set());
    },
    onError: (err: Error) => {
      toast.error(`Failed: ${err.message}`);
    },
  });

  // Open dialog for bulk selected emails
  const handleBulkAction = useCallback(() => {
    const selected = visibleEvents.filter(
      (e) => selectedIds.has(e._id) && e.sender.email,
    );
    if (selected.length === 0) return;
    setDialogEvents(selected);
    setDialogOpen(true);
  }, [visibleEvents, selectedIds, setDialogEvents, setDialogOpen]);

  // Bulk delete selected emails
  const bulkDeleteMutation = useMutation({
    mutationFn: async () => {
      const selected = visibleEvents.filter((e) => selectedIds.has(e._id));
      // Group by mailboxId for batched API calls
      const byMailbox = new Map<string, string[]>();
      for (const e of selected) {
        const ids = byMailbox.get(e.mailboxId) ?? [];
        ids.push(e.messageId);
        byMailbox.set(e.mailboxId, ids);
      }
      await Promise.all(
        Array.from(byMailbox.entries()).map(([mbId, msgIds]) =>
          applyActionsToMessages(mbId, msgIds, [{ actionType: 'delete' }]),
        ),
      );
      return selected.length;
    },
    onMutate: () => {
      // Optimistically hide selected emails
      for (const id of selectedIds) {
        setDeletedEventIds((prev) => new Set(prev).add(id));
      }
      setPreviewEvent(null);
    },
    onSuccess: (count) => {
      toast.success(`${count} email${count === 1 ? '' : 's'} deleted`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['inbox-events'] });
      queryClient.invalidateQueries({ queryKey: ['deleted-count'] });
    },
    onError: (err: Error) => {
      toast.error(`Bulk delete failed: ${err.message}`);
      setDeletedEventIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['inbox-events'] });
    },
  });

  // Bulk mark selected emails as read
  const bulkMarkReadMutation = useMutation({
    mutationFn: async () => {
      const selected = visibleEvents.filter((e) => selectedIds.has(e._id));
      const byMailbox = new Map<string, string[]>();
      for (const e of selected) {
        const ids = byMailbox.get(e.mailboxId) ?? [];
        ids.push(e.messageId);
        byMailbox.set(e.mailboxId, ids);
      }
      await Promise.all(
        Array.from(byMailbox.entries()).map(([mbId, msgIds]) =>
          applyActionsToMessages(mbId, msgIds, [{ actionType: 'markRead' }]),
        ),
      );
      return selected.length;
    },
    onMutate: () => {
      // Optimistically mark as read in cache
      markEventsReadInCache(queryClient, queryKeyId, (e) => selectedIds.has(e._id));
    },
    onSuccess: (count) => {
      toast.success(`${count} email${count === 1 ? '' : 's'} marked as read`);
      setSelectedIds(new Set());
    },
    onError: (err: Error) => {
      toast.error(`Bulk mark read failed: ${err.message}`);
      queryClient.invalidateQueries({ queryKey: ['inbox-events'] });
    },
  });

  // Create rules + apply immediate actions
  const handleConfirm = useCallback(
    (actions: RuleAction[], actionLabel: string, ruleName?: string, existingRuleId?: string, extraConditions?: Partial<RuleConditions>, runNow?: boolean) => {
      const senderEmails = dialogEvents.map((e) => e.sender.email!);
      const messageIds = dialogEvents.map((e) => e.messageId);

      confirmMutation.mutate({
        mailboxId: dialogEvents[0]?.mailboxId || mailboxId || '',
        actions,
        actionLabel,
        senderEmails,
        messageIds,
        ruleName,
        existingRuleId,
        extraConditions,
        runNow,
      });
    },
    [mailboxId, dialogEvents, confirmMutation],
  );

  const handleGridAction = useCallback((event: EventItem) => {
    if (!event.sender.email) return;
    setDialogEvents([event]);
    setDialogOpen(true);
  }, [setDialogEvents, setDialogOpen]);

  // Quick "Always Delete" — create rule in ALL mailboxes + run to delete ALL emails
  const quickDeletePending = useRef(new Set<string>());

  const quickDeleteMutation = useMutation({
    mutationFn: async (event: EventItem) => {
      const senderEmail = event.sender.email!;

      // Create rule + run it in every connected mailbox
      const results = await Promise.allSettled(
        connectedMailboxes.map(async (mb) => {
          const { rule } = await createRule({
            mailboxId: mb.id,
            name: senderEmail,
            conditions: { senderEmail },
            actions: [{ actionType: 'delete' }],
            skipStaging: true,
          });
          const runResult = await runRule(rule._id);
          return runResult;
        }),
      );

      let totalDeleted = 0;
      let mailboxCount = 0;
      for (const r of results) {
        if (r.status === 'fulfilled') {
          totalDeleted += r.value.applied;
          mailboxCount++;
        }
      }

      return { senderEmail, totalDeleted, mailboxCount };
    },
    onMutate: (event) => {
      // Optimistically remove ALL emails from this sender across ALL cached pages
      const senderEmail = event.sender.email?.toLowerCase();
      removeEventsFromCache(queryClient, queryKeyId, (e) => e.sender.email?.toLowerCase() === senderEmail);
    },
    onSuccess: ({ senderEmail, totalDeleted, mailboxCount }) => {
      const mbLabel = mailboxCount > 1 ? ` across ${mailboxCount} mailboxes` : '';
      toast.success(
        `Rule created for ${senderEmail}${mbLabel} — ${totalDeleted} ${totalDeleted === 1 ? 'email' : 'emails'} deleted`,
      );
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      queryClient.invalidateQueries({ queryKey: ['deleted-count'] });
    },
    onError: (_err: Error) => {
      // Rule was still created (only runRule might have failed).
      toast.success('Rule created — emails will be deleted on next sync');
      queryClient.invalidateQueries({ queryKey: ['rules'] });
    },
  });

  const handleQuickDelete = useCallback((event: EventItem) => {
    if (!event.sender.email) return;
    const key = event.sender.email.toLowerCase();
    if (quickDeletePending.current.has(key)) return;
    quickDeletePending.current.add(key);
    quickDeleteMutation.mutate(event, {
      onSettled: () => quickDeletePending.current.delete(key),
    });
  }, [quickDeleteMutation]);

  // Just delete this email (no rule creation)
  const justDeleteMutation = useMutation({
    mutationFn: async (event: EventItem) => {
      return applyActionsToMessages(
        event.mailboxId,
        [event.messageId],
        [{ actionType: 'delete' }],
      );
    },
    onMutate: (event) => {
      setDeletedEventIds((prev) => new Set(prev).add(event._id));
      // Close preview if this is the previewed message
      setPreviewEvent((prev) => (prev?._id === event._id ? null : prev));
    },
    onSuccess: () => {
      toast.success('Email deleted');
      queryClient.invalidateQueries({ queryKey: ['inbox-events'] });
      queryClient.invalidateQueries({ queryKey: ['deleted-count'] });
    },
    onError: (err: Error, event) => {
      toast.error(`Failed: ${err.message}`);
      setDeletedEventIds((prev) => {
        const next = new Set(prev);
        next.delete(event._id);
        return next;
      });
    },
  });

  const handleJustDelete = useCallback((event: EventItem) => {
    justDeleteMutation.mutate(event);
  }, [justDeleteMutation]);

  // Just mark this email as read (no rule creation)
  const markReadMutation = useMutation({
    mutationFn: async (event: EventItem) => {
      return applyActionsToMessages(
        event.mailboxId,
        [event.messageId],
        [{ actionType: 'markRead' }],
      );
    },
    onMutate: (event) => {
      // Optimistically mark as read in cache
      markEventsReadInCache(queryClient, queryKeyId, (e) => e._id === event._id);
      setPreviewEvent((prev) =>
        prev?._id === event._id ? { ...prev, isRead: true } : prev,
      );
    },
    onSuccess: () => {
      toast.success('Marked as read');
    },
    onError: (err: Error) => {
      toast.error(`Failed: ${err.message}`);
      queryClient.invalidateQueries({ queryKey: ['inbox-events'] });
    },
  });

  const handleMarkRead = useCallback((event: EventItem) => {
    markReadMutation.mutate(event);
  }, [markReadMutation]);

  // Quick "Always Mark Read" — create rule in ALL mailboxes + run them
  const quickMarkReadMutation = useMutation({
    mutationFn: async (event: EventItem) => {
      const senderEmail = event.sender.email!;

      const results = await Promise.allSettled(
        connectedMailboxes.map(async (mb) => {
          const { rule } = await createRule({
            mailboxId: mb.id,
            name: senderEmail,
            conditions: { senderEmail },
            actions: [{ actionType: 'markRead' }],
            skipStaging: true,
          });
          const runResult = await runRule(rule._id);
          return runResult;
        }),
      );

      let totalApplied = 0;
      let mailboxCount = 0;
      for (const r of results) {
        if (r.status === 'fulfilled') {
          totalApplied += r.value.applied;
          mailboxCount++;
        }
      }

      return { senderEmail, totalApplied, mailboxCount };
    },
    onMutate: (event) => {
      // Optimistically mark ALL emails from this sender as read across ALL cached pages
      const senderEmail = event.sender.email?.toLowerCase();
      markEventsReadInCache(queryClient, queryKeyId, (e) => e.sender.email?.toLowerCase() === senderEmail);
    },
    onSuccess: ({ senderEmail, totalApplied, mailboxCount }) => {
      const mbLabel = mailboxCount > 1 ? ` across ${mailboxCount} mailboxes` : '';
      toast.success(
        `Rule created for ${senderEmail}${mbLabel} — ${totalApplied} ${totalApplied === 1 ? 'email' : 'emails'} marked read`,
      );
      queryClient.invalidateQueries({ queryKey: ['rules'] });
    },
    onError: (_err: Error) => {
      toast.success('Rule created — emails will be marked read on next sync');
      queryClient.invalidateQueries({ queryKey: ['rules'] });
    },
  });

  const handleQuickMarkRead = useCallback((event: EventItem) => {
    if (!event.sender.email) return;
    quickMarkReadMutation.mutate(event);
  }, [quickMarkReadMutation]);

  // Clear all rules for a sender across all mailboxes
  const clearRulesMutation = useMutation({
    mutationFn: async (event: EventItem) => {
      const senderEmail = event.sender.email!;
      return deleteRulesBySender(senderEmail);
    },
    onSuccess: ({ deleted }, event) => {
      toast.success(
        `${deleted} rule${deleted !== 1 ? 's' : ''} removed for ${event.sender.email}`,
      );
      queryClient.invalidateQueries({ queryKey: ['rules'] });
    },
    onError: (err: Error) => {
      toast.error(`Failed to clear rules: ${err.message}`);
    },
  });

  const handleClearRules = useCallback((event: EventItem) => {
    if (!event.sender.email) return;
    clearRulesMutation.mutate(event);
  }, [clearRulesMutation]);

  // Undelete: move message back to Inbox + remove rules for sender
  const undeleteMutation = useMutation({
    mutationFn: async (event: EventItem) => {
      const senderEmail = event.sender.email!;
      // Move message back to Inbox and delete rules in parallel
      const [moveResult, rulesResult] = await Promise.all([
        applyActionsToMessages(event.mailboxId, [event.messageId], [{ actionType: 'move', toFolder: 'Inbox' }]),
        deleteRulesBySender(senderEmail),
      ]);
      return { moveResult, rulesResult, senderEmail };
    },
    onMutate: (event) => {
      // Optimistically remove from the deleted view
      setDeletedEventIds((prev) => new Set(prev).add(event._id));
    },
    onSuccess: ({ rulesResult, senderEmail }) => {
      const rulesMsg = rulesResult.deleted > 0
        ? ` — ${rulesResult.deleted} rule${rulesResult.deleted !== 1 ? 's' : ''} removed`
        : '';
      toast.success(`${senderEmail} moved to Inbox${rulesMsg}`);
      queryClient.invalidateQueries({ queryKey: ['inbox-events'] });
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      queryClient.invalidateQueries({ queryKey: ['deleted-count'] });
    },
    onError: (err: Error, event) => {
      toast.error(`Failed to undelete: ${err.message}`);
      setDeletedEventIds((prev) => {
        const next = new Set(prev);
        next.delete(event._id);
        return next;
      });
    },
  });

  const handleUndelete = useCallback((event: EventItem) => {
    if (!event.sender.email) return;
    undeleteMutation.mutate(event);
  }, [undeleteMutation]);

  // Deleted items count
  const { data: deletedData } = useQuery({
    queryKey: ['deleted-count', queryKeyId],
    queryFn: () => isUnifiedMode ? fetchDeletedCountAll() : fetchDeletedCount(mailboxId!),
    refetchInterval: 30000,
  });
  const deletedCount = deletedData?.count ?? 0;

  const emptyDeletedMutation = useMutation({
    mutationFn: async () => {
      if (isUnifiedMode) {
        // Empty deleted items in all connected mailboxes
        const results = await Promise.allSettled(
          connectedMailboxes.map((mb) => emptyDeletedItems(mb.id)),
        );
        let totalDeleted = 0;
        let totalFailed = 0;
        for (const r of results) {
          if (r.status === 'fulfilled') {
            totalDeleted += r.value.deleted;
            totalFailed += r.value.failed;
          }
        }
        return { deleted: totalDeleted, failed: totalFailed };
      }
      return emptyDeletedItems(mailboxId!);
    },
    onSuccess: ({ deleted, failed }) => {
      const msg = failed > 0
        ? `${deleted} deleted, ${failed} failed`
        : `${deleted} ${deleted === 1 ? 'item' : 'items'} permanently deleted`;
      toast.success(msg);
      queryClient.refetchQueries({ queryKey: ['deleted-count'] });
    },
    onError: (err: Error) => {
      toast.error(`Failed to empty deleted items: ${err.message}`);
      queryClient.refetchQueries({ queryKey: ['deleted-count'] });
    },
  });

  return {
    confirmMutation,
    bulkDeleteMutation,
    bulkMarkReadMutation,
    quickDeleteMutation,
    justDeleteMutation,
    markReadMutation,
    quickMarkReadMutation,
    clearRulesMutation,
    undeleteMutation,
    emptyDeletedMutation,
    deletedCount,
    handleBulkAction,
    handleConfirm,
    handleGridAction,
    handleQuickDelete,
    handleJustDelete,
    handleMarkRead,
    handleQuickMarkRead,
    handleClearRules,
    handleUndelete,
  };
}
