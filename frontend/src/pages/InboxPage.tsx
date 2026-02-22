import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle, useDefaultLayout } from 'react-resizable-panels';
import {
  Inbox,
  AlertCircle,
  Loader2,
  Search,
  Trash2,
  X,
  ChevronLeft,
  ChevronRight,
  ListFilter,
  RefreshCw,
  PanelRight,
  PanelBottom,
  Paperclip,
  Mail,
  MailOpen,
  Star,
  Tag,
  Reply,
  Forward,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { fetchEvents } from '@/api/events';
import type { EventItem } from '@/api/events';
import { createRule, updateRule, fetchRules, runRule, deleteRulesBySender } from '@/api/rules';
import type { RuleAction, RuleConditions } from '@/api/rules';
import { applyActionsToMessages, fetchDeletedCount, emptyDeletedItems, triggerSync, fetchMessageBody, replyToMessage, forwardMessage } from '@/api/mailboxes';
import { RuleActionsDialog } from '@/components/inbox/RuleActionsDialog';
import { InboxDataGrid } from '@/components/inbox/InboxDataGrid';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

export function InboxPage() {
  const { mailboxId: urlMailboxId } = useParams<{ mailboxId: string }>();
  const mailboxes = useAuthStore((s) => s.mailboxes);
  const connected = mailboxes.filter((m) => m.isConnected);

  // Use URL param if provided, otherwise default to first connected mailbox
  const activeMailboxId = urlMailboxId || (connected.length > 0 ? connected[0].id : undefined);

  if (connected.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Inbox</h1>
        <EmptyState
          icon={Inbox}
          title="No mailboxes connected"
          description="Connect a mailbox in Settings to view your inbox."
        />
      </div>
    );
  }

  if (!activeMailboxId) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <InboxEmailList mailboxId={activeMailboxId} />;
}

interface ConfirmPayload {
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

function InboxEmailList({ mailboxId }: { mailboxId: string }) {
  const queryClient = useQueryClient();
  const mailboxes = useAuthStore((s) => s.mailboxes);
  const folderFilter = useUiStore((s) => s.inboxFolder);
  const setFolderFilter = useUiStore((s) => s.setInboxFolder);

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('today');
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dialogEvents, setDialogEvents] = useState<EventItem[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [contentType, setContentType] = useState<'all' | 'emails' | 'files' | 'contacts'>('all');

  // Resizable panel layout persistence
  const panelLayoutRight = useDefaultLayout({
    id: 'inbox-preview-right',
    storage: localStorage,
  });
  const panelLayoutBottom = useDefaultLayout({
    id: 'inbox-preview-bottom',
    storage: localStorage,
  });

  // Preview pane state
  const [previewEvent, setPreviewEvent] = useState<EventItem | null>(null);
  const [previewPosition, setPreviewPosition] = useState<'right' | 'bottom'>(() => {
    return (localStorage.getItem('inbox-preview-position') as 'right' | 'bottom') || 'right';
  });

  const handlePreviewPositionChange = useCallback((pos: 'right' | 'bottom') => {
    setPreviewPosition(pos);
    localStorage.setItem('inbox-preview-position', pos);
  }, []);

  const handleRowClick = useCallback((event: EventItem) => {
    setPreviewEvent((prev) => prev?._id === event._id ? null : event);
  }, []);

  // Auto-mark email as read after 3 seconds of previewing
  useEffect(() => {
    if (!previewEvent || previewEvent.isRead) return;

    const timer = setTimeout(() => {
      applyActionsToMessages(mailboxId, [previewEvent.messageId], [{ actionType: 'markRead' }])
        .then(() => {
          // Update local cache to reflect read status
          queryClient.setQueriesData<typeof data>(
            { queryKey: ['inbox-events', mailboxId] },
            (old) => {
              if (!old) return old;
              return {
                ...old,
                events: old.events.map((e) =>
                  e._id === previewEvent._id ? { ...e, isRead: true } : e,
                ),
              };
            },
          );
          setPreviewEvent((prev) =>
            prev?._id === previewEvent._id ? { ...prev, isRead: true } : prev,
          );
        })
        .catch(() => {
          // Silent fail — not critical
        });
    }, 3000);

    return () => clearTimeout(timer);
  }, [previewEvent?._id, previewEvent?.isRead, mailboxId, queryClient]);

  // Debounce search input by 400ms
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [searchInput]);

  // Clear selection and reset page when page, search, date filter, or folder changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, search, dateFilter, folderFilter]);

  // Reset page when folder changes
  useEffect(() => {
    setPage(1);
  }, [folderFilter]);

  // Compute date range from filter selection
  const dateRange = useMemo(() => {
    const now = new Date();
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    const today = startOfDay(now);

    switch (dateFilter) {
      case 'today':
        return { dateFrom: today.toISOString(), dateTo: endOfDay(now).toISOString() };
      case 'yesterday': {
        const y = new Date(today); y.setDate(y.getDate() - 1);
        return { dateFrom: y.toISOString(), dateTo: endOfDay(y).toISOString() };
      }
      case 'this-week': {
        const d = new Date(today); d.setDate(d.getDate() - d.getDay());
        return { dateFrom: d.toISOString(), dateTo: endOfDay(now).toISOString() };
      }
      case 'last-week': {
        const d = new Date(today); d.setDate(d.getDate() - d.getDay() - 7);
        const e = new Date(d); e.setDate(e.getDate() + 6);
        return { dateFrom: d.toISOString(), dateTo: endOfDay(e).toISOString() };
      }
      case 'this-month': {
        const d = new Date(now.getFullYear(), now.getMonth(), 1);
        return { dateFrom: d.toISOString(), dateTo: endOfDay(now).toISOString() };
      }
      case 'last-month': {
        const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const e = new Date(now.getFullYear(), now.getMonth(), 0);
        return { dateFrom: d.toISOString(), dateTo: endOfDay(e).toISOString() };
      }
      case 'ytd': {
        const d = new Date(now.getFullYear(), 0, 1);
        return { dateFrom: d.toISOString(), dateTo: endOfDay(now).toISOString() };
      }
      case 'last-year': {
        const d = new Date(now.getFullYear() - 1, 0, 1);
        const e = new Date(now.getFullYear() - 1, 11, 31);
        return { dateFrom: d.toISOString(), dateTo: endOfDay(e).toISOString() };
      }
      default:
        return {};
    }
  }, [dateFilter]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['inbox-events', mailboxId, page, search, dateFilter, unreadOnly, folderFilter],
    queryFn: () =>
      fetchEvents({
        mailboxId,
        eventType: 'arrived',
        sortBy: 'timestamp',
        sortOrder: 'desc',
        search: search || undefined,
        page,
        limit: 50,
        excludeDeleted: folderFilter !== 'deleted',
        folder: folderFilter,
        unreadOnly: unreadOnly || undefined,
        ...dateRange,
      }),
  });

  const events = data?.events ?? [];

  // Quick delete state — rows vanish instantly on delete click
  const [deletedEventIds, setDeletedEventIds] = useState<Set<string>>(new Set());

  // Clear deleted IDs when page/search changes (fresh data)
  useEffect(() => {
    setDeletedEventIds(new Set());
  }, [page, search]);

  // Filter out deleted rows for display
  const visibleEvents = events.filter((e) => !deletedEventIds.has(e._id));

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
            await updateRule(payload.existingRuleId, {
              name: payload.ruleName || existingRule.name,
              conditions: { ...existingRule.conditions, ...payload.extraConditions, senderEmail: mergedSenders },
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
  }, [visibleEvents, selectedIds]);

  // Create rules + apply immediate actions
  const handleConfirm = useCallback(
    (actions: RuleAction[], actionLabel: string, ruleName?: string, existingRuleId?: string, extraConditions?: Partial<RuleConditions>, runNow?: boolean) => {
      const senderEmails = dialogEvents.map((e) => e.sender.email!);
      const messageIds = dialogEvents.map((e) => e.messageId);

      confirmMutation.mutate({
        mailboxId,
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

  // Derive sender emails and subjects for the dialog
  const dialogSenderEmails = dialogEvents
    .map((e) => e.sender.email!)
    .filter(Boolean);

  const dialogSubjects = dialogEvents
    .map((e) => e.subject)
    .filter((s): s is string => !!s);

  // Select all / deselect all
  const allSelected =
    visibleEvents.length > 0 && visibleEvents.every((e) => selectedIds.has(e._id));
  const someSelected = visibleEvents.some((e) => selectedIds.has(e._id));

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleEvents.map((e) => e._id)));
    }
  }, [allSelected, visibleEvents]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleGridAction = useCallback((event: EventItem) => {
    if (!event.sender.email) return;
    setDialogEvents([event]);
    setDialogOpen(true);
  }, []);

  // Quick "Always Delete" — create rule in ALL mailboxes + run to delete ALL emails
  const connectedMailboxes = mailboxes.filter((m) => m.isConnected);

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
      queryClient.setQueriesData<typeof data>(
        { queryKey: ['inbox-events', mailboxId] },
        (old) => {
          if (!old) return old;
          const filtered = old.events.filter(
            (e) => e.sender.email?.toLowerCase() !== senderEmail,
          );
          return {
            ...old,
            events: filtered,
            pagination: { ...old.pagination, total: old.pagination.total - (old.events.length - filtered.length) },
          };
        },
      );
    },
    onSuccess: ({ senderEmail, totalDeleted, mailboxCount }) => {
      const mbLabel = mailboxCount > 1 ? ` across ${mailboxCount} mailboxes` : '';
      toast.success(
        `Rule created for ${senderEmail}${mbLabel} — ${totalDeleted} ${totalDeleted === 1 ? 'email' : 'emails'} deleted`,
      );
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      queryClient.invalidateQueries({ queryKey: ['deleted-count', mailboxId] });
    },
    onError: (_err: Error) => {
      // Rule was still created (only runRule might have failed).
      toast.success('Rule created — emails will be deleted on next sync');
      queryClient.invalidateQueries({ queryKey: ['rules'] });
    },
  });

  const handleQuickDelete = useCallback((event: EventItem) => {
    if (!event.sender.email) return;
    quickDeleteMutation.mutate(event);
  }, [quickDeleteMutation]);

  // Just delete this email (no rule creation)
  const justDeleteMutation = useMutation({
    mutationFn: async (event: EventItem) => {
      return applyActionsToMessages(
        mailboxId,
        [event.messageId],
        [{ actionType: 'delete' }],
      );
    },
    onMutate: (event) => {
      setDeletedEventIds((prev) => new Set(prev).add(event._id));
    },
    onSuccess: () => {
      toast.success('Email deleted');
      queryClient.invalidateQueries({ queryKey: ['inbox-events'] });
      queryClient.invalidateQueries({ queryKey: ['deleted-count', mailboxId] });
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
      queryClient.setQueriesData<typeof data>(
        { queryKey: ['inbox-events', mailboxId] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            events: old.events.map((e) =>
              e.sender.email?.toLowerCase() === senderEmail
                ? { ...e, isRead: true }
                : e,
            ),
          };
        },
      );
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
        applyActionsToMessages(mailboxId, [event.messageId], [{ actionType: 'move', toFolder: 'Inbox' }]),
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
      queryClient.invalidateQueries({ queryKey: ['deleted-count', mailboxId] });
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

  // Sync mutation — triggers delta sync to pull recent emails from Graph
  const syncMutation = useMutation({
    mutationFn: () => triggerSync(),
    onSuccess: () => {
      toast.success('Sync started — new emails will appear shortly');
      // Refetch inbox after a short delay to show new emails
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['inbox-events', mailboxId] });
      }, 3000);
    },
    onError: (err: Error) => {
      toast.error(`Sync failed: ${err.message}`);
    },
  });

  // Deleted items count
  const { data: deletedData } = useQuery({
    queryKey: ['deleted-count', mailboxId],
    queryFn: () => fetchDeletedCount(mailboxId),
    refetchInterval: 30000,
  });
  const deletedCount = deletedData?.count ?? 0;

  const emptyDeletedMutation = useMutation({
    mutationFn: () => emptyDeletedItems(mailboxId),
    onSuccess: ({ deleted, failed }) => {
      const msg = failed > 0
        ? `${deleted} deleted, ${failed} failed`
        : `${deleted} ${deleted === 1 ? 'item' : 'items'} permanently deleted`;
      toast.success(msg);
      queryClient.refetchQueries({ queryKey: ['deleted-count', mailboxId] });
    },
    onError: (err: Error) => {
      toast.error(`Failed to empty deleted items: ${err.message}`);
      queryClient.refetchQueries({ queryKey: ['deleted-count', mailboxId] });
    },
  });

  const selectedCount = selectedIds.size;
  const totalPages = data?.pagination.totalPages ?? 0;

  const showEmailContent = contentType === 'all' || contentType === 'emails';

  return (
    <div className="space-y-4">
      {/* Content type tags */}
      <div className="flex items-center gap-1">
        {(['all', 'emails', 'files', 'contacts'] as const).map((type) => (
          <Button
            key={type}
            variant={contentType === type ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs capitalize"
            onClick={() => setContentType(type)}
          >
            {type}
          </Button>
        ))}
      </div>

      {!showEmailContent ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          Coming soon
        </div>
      ) : (<>
      {/* Date filter tabs */}
      <div className="flex flex-wrap items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => {
            setSearchInput('');
            setSearch('');
            setDateFilter('all');
            setUnreadOnly(false);
            setFolderFilter('inbox');
            setPage(1);
            setDeletedEventIds(new Set());
            setSelectedIds(new Set());
            queryClient.refetchQueries({ queryKey: ['inbox-events', mailboxId] });
            queryClient.refetchQueries({ queryKey: ['deleted-count', mailboxId] });
          }}
          title="Reset filters & refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          title="Sync recent emails from Microsoft 365"
        >
          {syncMutation.isPending ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
          )}
          Sync
        </Button>
        <span className="mx-0.5 h-5 w-px bg-border" />
        {([
          ['all', 'All'],
          ['today', 'Today'],
          ['yesterday', 'Yesterday'],
          ['this-week', 'This Week'],
          ['last-week', 'Last Week'],
          ['this-month', 'This Month'],
          ['last-month', 'Last Month'],
          ['ytd', 'YTD'],
          ['last-year', 'Last Year'],
        ] as const).map(([key, label]) => (
          <Button
            key={key}
            variant={dateFilter === key ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => { setDateFilter(key); setPage(1); }}
          >
            {label}
          </Button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" />
        <Button
          variant={unreadOnly ? 'default' : 'outline'}
          size="sm"
          className="h-7 text-xs"
          onClick={() => { setUnreadOnly(true); setPage(1); }}
        >
          Unread
        </Button>
        <Button
          variant={!unreadOnly ? 'default' : 'outline'}
          size="sm"
          className="h-7 text-xs"
          onClick={() => { setUnreadOnly(false); setPage(1); }}
        >
          All
        </Button>
        {data && (
          <span className="text-sm text-muted-foreground tabular-nums ml-2">
            {data.pagination.total.toLocaleString()} {data.pagination.total === 1 ? 'email' : 'emails'}
          </span>
        )}
        <span className="mx-1 h-5 w-px bg-border" />
        <Button
          variant={previewPosition === 'right' ? 'default' : 'outline'}
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => handlePreviewPositionChange('right')}
          title="Preview on right"
        >
          <PanelRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant={previewPosition === 'bottom' ? 'default' : 'outline'}
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => handlePreviewPositionChange('bottom')}
          title="Preview on bottom"
        >
          <PanelBottom className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by sender, name, or subject..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="pl-9 pr-9"
        />
        {searchInput && (
          <button
            onClick={() => setSearchInput('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Bulk action bar */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-3 rounded-md border bg-muted/50 px-4 py-2">
          <span className="text-sm font-medium">
            {selectedCount} selected
          </span>
          <Button size="sm" onClick={handleBulkAction}>
            <ListFilter className="mr-1.5 h-3.5 w-3.5" />
            Create Rules
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear
          </Button>
        </div>
      )}

      {isError ? (
        <EmptyState
          icon={AlertCircle}
          title="Failed to load emails"
          description="There was an error loading inbox emails. Please try again."
        />
      ) : isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !visibleEvents.length ? (
        <EmptyState
          icon={Inbox}
          title="No emails found"
          description="No arrived emails have been recorded for this mailbox yet."
        />
      ) : (
        <PanelGroup
          orientation={previewEvent && previewPosition === 'bottom' ? 'vertical' : 'horizontal'}
          defaultLayout={previewPosition === 'bottom' ? panelLayoutBottom.defaultLayout : panelLayoutRight.defaultLayout}
          onLayoutChanged={previewPosition === 'bottom' ? panelLayoutBottom.onLayoutChanged : panelLayoutRight.onLayoutChanged}
          className="min-h-[400px]"
        >
          <Panel defaultSize={previewEvent ? 60 : 100} minSize={30}>
            <div className="space-y-2 h-full overflow-auto">
              {/* Data Grid (pagination is inside toolbar slot) */}
              <InboxDataGrid
                data={visibleEvents}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onToggleSelectAll={toggleSelectAll}
                allSelected={allSelected}
                someSelected={someSelected}
                onAction={handleGridAction}
                onClearRules={handleClearRules}
                onQuickDelete={handleQuickDelete}
                onJustDelete={handleJustDelete}
                onQuickMarkRead={handleQuickMarkRead}
                onUndelete={handleUndelete}
                onRowClick={handleRowClick}
                activeEventId={previewEvent?._id}
                folderFilter={folderFilter}
                toolbarSlot={
                  <>
                    {/* Deleted items inline */}
                    {deletedCount > 0 && (
                      <>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        <span className="text-xs text-destructive whitespace-nowrap">
                          {deletedCount} deleted
                        </span>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7 text-xs"
                          onClick={() => emptyDeletedMutation.mutate()}
                          disabled={emptyDeletedMutation.isPending}
                        >
                          {emptyDeletedMutation.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            'Empty'
                          )}
                        </Button>
                        <span className="mx-0.5 h-5 w-px bg-border" />
                      </>
                    )}
                    {/* Pagination inline */}
                    {totalPages > 1 && (
                      <>
                        <p className="text-sm text-muted-foreground tabular-nums whitespace-nowrap">
                          Page {page}/{totalPages}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8"
                          disabled={page <= 1}
                          onClick={() => setPage((p) => p - 1)}
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8"
                          disabled={page >= totalPages}
                          onClick={() => setPage((p) => p + 1)}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                        <span className="mx-0.5 h-5 w-px bg-border" />
                      </>
                    )}
                  </>
                }
              />

              {/* Bottom pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Page {page} of {totalPages} ({data?.pagination.total} emails)
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      <ChevronLeft className="mr-1 h-4 w-4" />
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                      <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Panel>

          {/* Resizable preview pane */}
          {previewEvent && (
            <>
              <PanelResizeHandle className={`${
                previewPosition === 'bottom'
                  ? 'h-2 cursor-row-resize'
                  : 'w-2 cursor-col-resize'
              } flex items-center justify-center rounded hover:bg-primary/10 active:bg-primary/20 transition-colors`}>
                <div className={`${
                  previewPosition === 'bottom'
                    ? 'h-0.5 w-8'
                    : 'w-0.5 h-8'
                } rounded-full bg-border`} />
              </PanelResizeHandle>
              <Panel defaultSize={40} minSize={20}>
                <div className="h-full overflow-auto">
                  <EmailPreviewPane
                    event={previewEvent}
                    mailboxId={mailboxId}
                    position={previewPosition}
                    onClose={() => setPreviewEvent(null)}
                    onQuickDelete={handleQuickDelete}
                    onQuickMarkRead={handleQuickMarkRead}
                    onAction={handleGridAction}
                  />
                </div>
              </Panel>
            </>
          )}
        </PanelGroup>
      )}

      </>)}

      <RuleActionsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mailboxId={mailboxId}
        senderEmails={dialogSenderEmails}
        subjects={dialogSubjects}
        isPending={confirmMutation.isPending}
        onConfirm={handleConfirm}
      />
    </div>
  );
}

// --- Email Preview Pane ---

interface EmailPreviewPaneProps {
  event: EventItem;
  mailboxId: string;
  position: 'right' | 'bottom';
  onClose: () => void;
  onQuickDelete: (event: EventItem) => void;
  onQuickMarkRead: (event: EventItem) => void;
  onAction: (event: EventItem) => void;
}

function EmailPreviewPane({
  event,
  mailboxId,
  position,
  onClose,
  onQuickDelete,
  onQuickMarkRead,
  onAction,
}: EmailPreviewPaneProps) {
  const d = new Date(event.timestamp);
  const timeStr = d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });

  // Compose mode: reply, forward, or null
  const [composeMode, setComposeMode] = useState<'reply' | 'forward' | null>(null);
  const [composeBody, setComposeBody] = useState('');
  const [forwardTo, setForwardTo] = useState('');

  // Reset compose mode when switching emails
  useEffect(() => {
    setComposeMode(null);
    setComposeBody('');
    setForwardTo('');
  }, [event._id]);

  // Reply mutation
  const replyMutation = useMutation({
    mutationFn: () => replyToMessage(mailboxId, event.messageId, composeBody),
    onSuccess: () => {
      toast.success('Reply sent');
      setComposeMode(null);
      setComposeBody('');
    },
    onError: (err: Error) => {
      toast.error(`Reply failed: ${err.message}`);
    },
  });

  // Forward mutation
  const forwardMutation = useMutation({
    mutationFn: () => {
      const recipients = forwardTo
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean)
        .map((email) => ({ email }));
      return forwardMessage(mailboxId, event.messageId, recipients, composeBody);
    },
    onSuccess: () => {
      toast.success('Message forwarded');
      setComposeMode(null);
      setComposeBody('');
      setForwardTo('');
    },
    onError: (err: Error) => {
      toast.error(`Forward failed: ${err.message}`);
    },
  });

  // Fetch the full email body from Graph API
  const { data: bodyData, isLoading: bodyLoading } = useQuery({
    queryKey: ['message-body', mailboxId, event.messageId],
    queryFn: () => fetchMessageBody(mailboxId, event.messageId),
    staleTime: 5 * 60 * 1000, // cache for 5 minutes
  });

  const messageBody = bodyData?.message?.body;

  // Check if any rules match this sender
  const { data: rulesData } = useQuery({
    queryKey: ['rules', mailboxId],
    queryFn: () => fetchRules({ mailboxId, limit: 200 }),
    staleTime: 30 * 1000,
  });

  const senderEmail = event.sender.email?.toLowerCase();
  const matchingRules = useMemo(() => {
    if (!rulesData?.rules || !senderEmail) return [];
    return rulesData.rules.filter((rule) => {
      const cond = rule.conditions.senderEmail;
      if (!cond) return false;
      const emails = Array.isArray(cond) ? cond : [cond];
      return emails.some((e) => e.toLowerCase() === senderEmail);
    });
  }, [rulesData, senderEmail]);

  const hasDeleteRule = matchingRules.some((r) =>
    r.actions.some((a) => a.actionType === 'delete'),
  );
  const hasMarkReadRule = matchingRules.some((r) =>
    r.actions.some((a) => a.actionType === 'markRead'),
  );

  const isSending = replyMutation.isPending || forwardMutation.isPending;

  const containerClass = 'h-full border-0 shadow-none rounded-none';

  return (
    <Card className={containerClass}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-snug break-words">
            {event.subject || '(no subject)'}
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Sender */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              {event.sender.name && (
                <div className="font-medium text-sm truncate">{event.sender.name}</div>
              )}
              <div className="text-xs text-muted-foreground truncate">
                {event.sender.email || 'Unknown sender'}
              </div>
            </div>
          </div>
        </div>

        {/* Metadata */}
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="text-muted-foreground">{timeStr}</span>
          <span className="mx-0.5 h-4 w-px bg-border" />
          {event.isRead ? (
            <span className="text-muted-foreground flex items-center gap-1">
              <MailOpen className="h-3 w-3" /> Read
            </span>
          ) : (
            <span className="text-blue-600 dark:text-blue-400 flex items-center gap-1 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-600 dark:bg-blue-400" />
              Unread
            </span>
          )}
          {event.importance === 'high' && (
            <>
              <span className="mx-0.5 h-4 w-px bg-border" />
              <span className="text-red-600 dark:text-red-400 flex items-center gap-1 font-medium">
                <Star className="h-3 w-3" /> High Priority
              </span>
            </>
          )}
          {event.hasAttachments && (
            <>
              <span className="mx-0.5 h-4 w-px bg-border" />
              <span className="text-muted-foreground flex items-center gap-1">
                <Paperclip className="h-3 w-3" /> Attachments
              </span>
            </>
          )}
          {event.categories.length > 0 && (
            <>
              <span className="mx-0.5 h-4 w-px bg-border" />
              <span className="text-muted-foreground flex items-center gap-1">
                <Tag className="h-3 w-3" /> {event.categories.join(', ')}
              </span>
            </>
          )}
        </div>

        {/* Folder info */}
        {(event.fromFolder || event.toFolder) && (
          <div className="text-xs text-muted-foreground">
            Folder: {event.toFolder || event.fromFolder}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            variant={composeMode === 'reply' ? 'default' : 'outline'}
            className="h-7 text-xs"
            onClick={() => {
              setComposeMode(composeMode === 'reply' ? null : 'reply');
              setComposeBody('');
              setForwardTo('');
            }}
          >
            <Reply className="mr-1.5 h-3 w-3" />
            Reply
          </Button>
          <Button
            size="sm"
            variant={composeMode === 'forward' ? 'default' : 'outline'}
            className="h-7 text-xs"
            onClick={() => {
              setComposeMode(composeMode === 'forward' ? null : 'forward');
              setComposeBody('');
              setForwardTo('');
            }}
          >
            <Forward className="mr-1.5 h-3 w-3" />
            Forward
          </Button>
          <span className="mx-0.5 h-5 w-px bg-border" />
          <Button
            size="sm"
            variant="outline"
            className={`h-7 text-xs ${hasDeleteRule ? 'bg-yellow-100 border-yellow-300 dark:bg-yellow-900/30 dark:border-yellow-700' : ''}`}
            onClick={() => onQuickDelete(event)}
            disabled={!event.sender.email}
          >
            <Trash2 className="mr-1.5 h-3 w-3" />
            {hasDeleteRule ? 'Delete Rule Active' : 'Always Delete'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={`h-7 text-xs ${hasMarkReadRule ? 'bg-yellow-100 border-yellow-300 dark:bg-yellow-900/30 dark:border-yellow-700' : ''}`}
            onClick={() => onQuickMarkRead(event)}
            disabled={!event.sender.email}
          >
            <MailOpen className="mr-1.5 h-3 w-3" />
            {hasMarkReadRule ? 'Mark Read Rule Active' : 'Always Mark Read'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={`h-7 text-xs ${matchingRules.length > 0 ? 'bg-yellow-100 border-yellow-300 dark:bg-yellow-900/30 dark:border-yellow-700' : ''}`}
            onClick={() => onAction(event)}
          >
            <ListFilter className="mr-1.5 h-3 w-3" />
            {matchingRules.length > 0 ? `${matchingRules.length} Rule${matchingRules.length > 1 ? 's' : ''} Active` : 'Create Rule'}
          </Button>
        </div>

        {/* Compose area (Reply / Forward) */}
        {composeMode && (
          <div className="border rounded-md p-3 space-y-3 bg-muted/30">
            <div className="text-sm font-medium">
              {composeMode === 'reply' ? 'Reply' : 'Forward'}
            </div>

            {composeMode === 'reply' && (
              <div className="text-xs text-muted-foreground">
                To: {event.sender.email || 'Unknown'}
              </div>
            )}

            {composeMode === 'forward' && (
              <Input
                placeholder="To: email@example.com (comma-separated for multiple)"
                value={forwardTo}
                onChange={(e) => setForwardTo(e.target.value)}
                className="text-sm"
              />
            )}

            <Textarea
              placeholder={composeMode === 'reply' ? 'Write your reply...' : 'Add a message (optional)...'}
              value={composeBody}
              onChange={(e) => setComposeBody(e.target.value)}
              rows={4}
              className="text-sm resize-none"
            />

            <div className="flex gap-2">
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={
                  isSending ||
                  !composeBody.trim() ||
                  (composeMode === 'forward' && !forwardTo.trim())
                }
                onClick={() => {
                  if (composeMode === 'reply') {
                    replyMutation.mutate();
                  } else {
                    forwardMutation.mutate();
                  }
                }}
              >
                {isSending ? (
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                ) : (
                  <Send className="mr-1.5 h-3 w-3" />
                )}
                {isSending ? 'Sending...' : 'Send'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => {
                  setComposeMode(null);
                  setComposeBody('');
                  setForwardTo('');
                }}
                disabled={isSending}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Email body */}
        <div className="border-t pt-3">
          {bodyLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : messageBody ? (
            messageBody.contentType === 'html' ? (
              <iframe
                srcDoc={messageBody.content}
                className="w-full border-0 min-h-[200px]"
                sandbox="allow-same-origin"
                style={{ height: position === 'right' ? '400px' : '250px' }}
                title="Email content"
              />
            ) : (
              <pre className="text-sm whitespace-pre-wrap break-words text-foreground">
                {messageBody.content}
              </pre>
            )
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Could not load email body
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
