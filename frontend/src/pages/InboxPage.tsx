import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useLocation } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useKeyboardShortcuts, type Shortcut } from '@/hooks/useKeyboardShortcuts';
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
  ReplyAll,
  Forward,
  Send,
  MailCheck,
  Sparkles,
  FileSpreadsheet,
  FileText,
  SquarePen,
  Brain,
  Eye,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { fetchEvents, summarizeToday, downloadSummaryCsv, sendSummaryEmail } from '@/api/events';
import type { EventItem } from '@/api/events';
import { createRule, updateRule, fetchRules, runRule, deleteRulesBySender } from '@/api/rules';
import type { RuleAction, RuleConditions } from '@/api/rules';
import { applyActionsToMessages, fetchDeletedCount, fetchDeletedCountAll, emptyDeletedItems, triggerSync, syncFolderStream, type SyncProgress, fetchMessageBody, replyToMessage, replyAllToMessage, forwardMessage, searchContacts, type Contact } from '@/api/mailboxes';
import { batchLookupTracking, type TrackingMatch } from '@/api/tracking';
import { useSettings } from '@/hooks/useSettings';
import { RuleActionsDialog } from '@/components/inbox/RuleActionsDialog';
import { ComposeEmailDialog } from '@/components/inbox/ComposeEmailDialog';
import { EmailAutocomplete } from '@/components/inbox/EmailAutocomplete';
import { AiSearchPanel } from '@/components/inbox/AiSearchPanel';
import type { AiSearchResult } from '@/api/aiSearch';
import { InboxDataGrid } from '@/components/inbox/InboxDataGrid';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

export function InboxPage() {
  const { mailboxId: urlMailboxId } = useParams<{ mailboxId: string }>();
  const mailboxes = useAuthStore((s) => s.mailboxes);
  const connected = mailboxes.filter((m) => m.isConnected);

  // No URL mailboxId = unified mode (show all mailboxes)
  const isUnifiedMode = !urlMailboxId;
  const activeMailboxId = urlMailboxId;

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

  // Single mailbox mode requires a valid mailboxId
  if (!isUnifiedMode && !activeMailboxId) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <InboxEmailList mailboxId={activeMailboxId} isUnifiedMode={isUnifiedMode} />;
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

function InboxEmailList({ mailboxId, isUnifiedMode = false }: { mailboxId?: string; isUnifiedMode?: boolean }) {
  const queryClient = useQueryClient();
  const mailboxes = useAuthStore((s) => s.mailboxes);
  const folderFilter: string = useUiStore((s) => s.inboxFolder);
  const activeFolderId = useUiStore((s) => s.activeFolderId);
  const selectedFolderMailboxId = useUiStore((s) => s.selectedFolderMailboxId);
  const folderSyncRequested = useUiStore((s) => s.folderSyncRequested);
  const setFolderFilter = useUiStore((s) => s.setInboxFolder);
  const queryKeyId = mailboxId || 'unified';

  // Folder sync with progress overlay
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

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('today');
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dialogEvents, setDialogEvents] = useState<EventItem[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [aiSearchOpen, setAiSearchOpen] = useState(false);
  const [contentType, setContentType] = useState<'all' | 'emails' | 'files' | 'contacts'>('all');

  // Contacts search state
  const { data: settingsData } = useSettings();
  const contactsMailboxId = settingsData?.user.preferences.contactsMailboxId;
  const contactsFolderId = settingsData?.user.preferences.contactsFolderId;
  const [contactQuery, setContactQuery] = useState('');
  const [contactResults, setContactResults] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const contactDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced contact search
  useEffect(() => {
    if (contentType !== 'contacts') return;
    if (!contactsMailboxId || !contactsFolderId) return;

    if (contactDebounceRef.current) clearTimeout(contactDebounceRef.current);
    contactDebounceRef.current = setTimeout(async () => {
      setContactsLoading(true);
      try {
        const { contacts } = await searchContacts(
          contactsMailboxId,
          contactsFolderId,
          contactQuery || undefined,
        );
        setContactResults(contacts);
      } catch {
        setContactResults([]);
      } finally {
        setContactsLoading(false);
      }
    }, contactQuery ? 300 : 0);

    return () => {
      if (contactDebounceRef.current) clearTimeout(contactDebounceRef.current);
    };
  }, [contactQuery, contentType, contactsMailboxId, contactsFolderId]);

  // Summarize Today state
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryContent, setSummaryContent] = useState('');
  const [summaryStats, setSummaryStats] = useState<{ total: number; read: number; unread: number; deleted: number } | null>(null);
  const [emailTo, setEmailTo] = useState('taj@jobtalk.ai');
  const [showEmailForm, setShowEmailForm] = useState(false);

  const summarizeMutation = useMutation({
    mutationFn: () => summarizeToday(mailboxId || undefined),
    onSuccess: (data) => {
      setSummaryContent(data.summary);
      setSummaryStats(data.stats);
    },
    onError: (err: Error) => {
      toast.error(`Summary failed: ${err.message}`);
      setSummaryOpen(false);
    },
  });

  const sendEmailMutation = useMutation({
    mutationFn: () => sendSummaryEmail(emailTo, summaryContent),
    onSuccess: () => {
      toast.success(`Summary sent to ${emailTo}`);
      setShowEmailForm(false);
    },
    onError: (err: Error) => {
      toast.error(`Failed to send: ${err.message}`);
    },
  });

  // Keyboard navigation
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Reset focused index when data changes
  useEffect(() => {
    setFocusedIndex(-1);
  }, [page, search, dateFilter, folderFilter]);

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
      applyActionsToMessages(previewEvent.mailboxId, [previewEvent.messageId], [{ actionType: 'markRead' }])
        .then(() => {
          // Update local cache to reflect read status
          queryClient.setQueriesData<typeof data>(
            { queryKey: ['inbox-events', queryKeyId] },
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
  }, [previewEvent?._id, previewEvent?.isRead, previewEvent?.mailboxId, queryKeyId, queryClient]);

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
    queryKey: ['inbox-events', queryKeyId, page, search, dateFilter, unreadOnly, folderFilter],
    queryFn: () =>
      fetchEvents({
        mailboxId: mailboxId || undefined,
        eventType: 'arrived',
        sortBy: 'timestamp',
        sortOrder: 'desc',
        search: search || undefined,
        page,
        limit: 50,
        excludeDeleted: folderFilter === 'inbox',
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

  // Tracking data for sent folder
  const [trackingMap, setTrackingMap] = useState<Record<string, TrackingMatch>>({});

  useEffect(() => {
    if (folderFilter !== 'sent' || visibleEvents.length === 0) {
      setTrackingMap({});
      return;
    }
    const items = visibleEvents.map((e) => ({
      mailboxId: e.mailboxId,
      subject: e.subject,
      sentAt: e.timestamp,
    }));
    batchLookupTracking(items).then(setTrackingMap).catch(() => setTrackingMap({}));
  }, [folderFilter, events]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [visibleEvents, selectedIds]);

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
      queryClient.setQueriesData<typeof data>(
        { queryKey: ['inbox-events', queryKeyId] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            events: old.events.map((e) =>
              selectedIds.has(e._id) ? { ...e, isRead: true } : e,
            ),
          };
        },
      );
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
    [mailboxId, dialogEvents, confirmMutation, queryKeyId],
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
        { queryKey: ['inbox-events', queryKeyId] },
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
    quickDeleteMutation.mutate(event);
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
      queryClient.setQueriesData<typeof data>(
        { queryKey: ['inbox-events', queryKeyId] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            events: old.events.map((e) =>
              e._id === event._id ? { ...e, isRead: true } : e,
            ),
          };
        },
      );
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
      queryClient.setQueriesData<typeof data>(
        { queryKey: ['inbox-events', queryKeyId] },
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

  const selectedCount = selectedIds.size;
  const totalPages = data?.pagination.totalPages ?? 0;

  const showEmailContent = contentType === 'all' || contentType === 'emails';

  // Keyboard shortcuts for inbox
  const location = useLocation();
  const isInboxActive = location.pathname.startsWith('/inbox');

  const inboxShortcuts = useMemo<Shortcut[]>(() => {
    if (!isInboxActive || !showEmailContent) return [];
    return [
      // J — next email
      {
        key: 'j',
        action: () => {
          setFocusedIndex((prev) => {
            const max = visibleEvents.length - 1;
            return prev < max ? prev + 1 : max;
          });
        },
      },
      // K — previous email
      {
        key: 'k',
        action: () => {
          setFocusedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        },
      },
      // Enter / O — open preview for focused email
      {
        key: 'Enter',
        action: () => {
          if (focusedIndex >= 0 && focusedIndex < visibleEvents.length) {
            setPreviewEvent(visibleEvents[focusedIndex]);
          }
        },
      },
      {
        key: 'o',
        action: () => {
          if (focusedIndex >= 0 && focusedIndex < visibleEvents.length) {
            setPreviewEvent(visibleEvents[focusedIndex]);
          }
        },
      },
      // X — toggle selection
      {
        key: 'x',
        action: () => {
          if (focusedIndex >= 0 && focusedIndex < visibleEvents.length) {
            toggleSelect(visibleEvents[focusedIndex]._id);
          }
        },
      },
      // E — archive/mark read
      {
        key: 'e',
        action: () => {
          const target = focusedIndex >= 0 && focusedIndex < visibleEvents.length
            ? visibleEvents[focusedIndex]
            : null;
          if (target?.sender.email) {
            handleQuickMarkRead(target);
          }
        },
      },
      // # — delete focused/selected email(s)
      {
        key: '#',
        action: () => {
          if (selectedIds.size > 0) {
            // Delete all selected
            for (const id of selectedIds) {
              const ev = visibleEvents.find((e) => e._id === id);
              if (ev) handleJustDelete(ev);
            }
          } else if (focusedIndex >= 0 && focusedIndex < visibleEvents.length) {
            handleJustDelete(visibleEvents[focusedIndex]);
          }
        },
      },
      // Shift+D — always delete (create rule)
      {
        key: 'D',
        action: () => {
          const target = focusedIndex >= 0 && focusedIndex < visibleEvents.length
            ? visibleEvents[focusedIndex]
            : null;
          if (target?.sender.email) {
            handleQuickDelete(target);
          }
        },
      },
      // Shift+I — mark as read
      {
        key: 'I',
        action: () => {
          const target = focusedIndex >= 0 && focusedIndex < visibleEvents.length
            ? visibleEvents[focusedIndex]
            : null;
          if (target?.sender.email) {
            handleQuickMarkRead(target);
          }
        },
      },
      // R — reply (opens preview)
      {
        key: 'r',
        action: () => {
          if (focusedIndex >= 0 && focusedIndex < visibleEvents.length) {
            setPreviewEvent(visibleEvents[focusedIndex]);
          }
        },
      },
      // F — forward (opens preview)
      {
        key: 'f',
        action: () => {
          if (focusedIndex >= 0 && focusedIndex < visibleEvents.length) {
            setPreviewEvent(visibleEvents[focusedIndex]);
          }
        },
      },
      // / — focus search
      {
        key: '/',
        action: () => {
          searchInputRef.current?.focus();
        },
      },
      // Escape — close preview / deselect
      {
        key: 'Escape',
        action: () => {
          if (previewEvent) {
            setPreviewEvent(null);
          } else if (selectedIds.size > 0) {
            setSelectedIds(new Set());
          } else {
            setFocusedIndex(-1);
          }
        },
      },
    ];
  }, [
    isInboxActive,
    showEmailContent,
    visibleEvents,
    focusedIndex,
    previewEvent,
    selectedIds,
    toggleSelect,
    handleQuickMarkRead,
    handleJustDelete,
    handleQuickDelete,
  ]);

  useKeyboardShortcuts(inboxShortcuts);

  return (
    <div className="flex flex-col h-[calc(100vh-7.5rem)] overflow-hidden">
      {/* Content type tags */}
      <div className="shrink-0 flex items-center gap-1 mb-3">
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
        <Button
          size="sm"
          className="h-7 text-xs gap-1 bg-green-700 hover:bg-green-800 text-white"
          onClick={() => setComposeOpen(true)}
        >
          <SquarePen className="h-3.5 w-3.5" />
          New Email
        </Button>
      </div>

      {contentType === 'contacts' ? (
        <div className="flex-1 overflow-auto">
          {!contactsMailboxId || !contactsFolderId ? (
            <div className="flex items-center justify-center py-24 text-muted-foreground">
              Configure a contact folder in Settings &rarr; Contacts first.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search contacts..."
                  value={contactQuery}
                  onChange={(e) => setContactQuery(e.target.value)}
                  className="pl-9"
                />
                {contactQuery && (
                  <button
                    onClick={() => setContactQuery('')}
                    className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {contactsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : contactResults.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                  {contactQuery ? 'No contacts found' : 'Type to search contacts'}
                </div>
              ) : (
                <div className="divide-y">
                  {contactResults.map((contact) => (
                    <div key={contact.id} className="py-2.5 px-1">
                      <div className="font-medium text-sm">{contact.displayName}</div>
                      {contact.emailAddresses.length > 0 && (
                        <div className="text-xs text-muted-foreground">
                          {contact.emailAddresses.map((e) => e.address).filter(Boolean).join(', ')}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {[contact.jobTitle, contact.companyName, contact.department]
                          .filter(Boolean)
                          .join(' \u00B7 ')}
                      </div>
                      {(contact.mobilePhone || contact.businessPhones.length > 0) && (
                        <div className="text-xs text-muted-foreground">
                          {[contact.mobilePhone, ...contact.businessPhones].filter(Boolean).join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : !showEmailContent ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          Coming soon
        </div>
      ) : (<>
      {/* Date filter tabs */}
      <div className="shrink-0 flex flex-wrap items-center gap-1 mb-3">
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
            queryClient.refetchQueries({ queryKey: ['inbox-events', queryKeyId] });
            queryClient.refetchQueries({ queryKey: ['deleted-count', queryKeyId] });
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
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => {
            setSummaryContent('');
            setSummaryStats(null);
            setShowEmailForm(false);
            setSummaryOpen(true);
            summarizeMutation.mutate();
          }}
          disabled={summarizeMutation.isPending}
          title="AI summary of today's emails"
        >
          {summarizeMutation.isPending ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="mr-1 h-3.5 w-3.5" />
          )}
          Summarize
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setAiSearchOpen(true)}
          title="AI-powered semantic email search"
        >
          <Brain className="mr-1 h-3.5 w-3.5 text-purple-500" />
          AI Search
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
      <div className="shrink-0 relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchInputRef}
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
        <div className="shrink-0 flex items-center gap-3 rounded-md border bg-muted/50 px-4 py-2 mb-3">
          <span className="text-sm font-medium">
            {selectedCount} selected
          </span>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => bulkDeleteMutation.mutate()}
            disabled={bulkDeleteMutation.isPending}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            {bulkDeleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => bulkMarkReadMutation.mutate()}
            disabled={bulkMarkReadMutation.isPending}
          >
            <MailCheck className="mr-1.5 h-3.5 w-3.5" />
            {bulkMarkReadMutation.isPending ? 'Marking...' : 'Mark Read'}
          </Button>
          <Button size="sm" variant="outline" onClick={handleBulkAction}>
            <ListFilter className="mr-1.5 h-3.5 w-3.5" />
            Create Rules
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectedIds(new Set())}
          >
            <X className="mr-1.5 h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      )}

      {syncState.active ? (
        <FolderSyncOverlay
          progress={syncState.progress}
          onCancel={() => {
            syncState.cancel?.();
            setSyncState({ active: false, progress: null, cancel: null });
          }}
        />
      ) : isError ? (
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
          className="flex-1 min-h-0"
        >
          <Panel defaultSize={previewEvent ? 60 : 100} minSize={30}>
            <div className="flex flex-col gap-2 h-full min-h-0 overflow-hidden">
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
                onMarkRead={handleMarkRead}
                onQuickMarkRead={handleQuickMarkRead}
                onUndelete={handleUndelete}
                onRowClick={handleRowClick}
                activeEventId={previewEvent?._id}
                focusedEventId={focusedIndex >= 0 && focusedIndex < visibleEvents.length ? visibleEvents[focusedIndex]._id : undefined}
                folderFilter={folderFilter}
                searchQuery={search}
                isUnifiedMode={isUnifiedMode}
                mailboxEmailMap={isUnifiedMode ? new Map(connectedMailboxes.map((mb) => [mb.id, mb.email])) : undefined}
                trackingMap={folderFilter === 'sent' ? trackingMap : undefined}
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
                    {/* Sent folder toggle */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant={folderFilter === 'sent' ? 'default' : 'outline'}
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => {
                            if (folderFilter === 'sent') {
                              setFolderFilter('inbox');
                            } else {
                              setFolderFilter('sent');
                            }
                            setPage(1);
                          }}
                        >
                          <Send className="mr-1.5 h-3.5 w-3.5" />
                          Sent
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>View Sent Items with tracking</TooltipContent>
                    </Tooltip>
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
                <div key={previewEvent._id} className="h-full">
                  <EmailPreviewPane
                    event={previewEvent}
                    mailboxId={previewEvent.mailboxId}
                    position={previewPosition}
                    onClose={() => setPreviewEvent(null)}
                    onJustDelete={handleJustDelete}
                    onMarkRead={handleMarkRead}
                    onQuickDelete={handleQuickDelete}
                    onQuickMarkRead={handleQuickMarkRead}
                    onAction={handleGridAction}
                    searchQuery={search}
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
        mailboxId={dialogEvents[0]?.mailboxId || mailboxId || ''}
        senderEmails={dialogSenderEmails}
        subjects={dialogSubjects}
        isPending={confirmMutation.isPending}
        onConfirm={handleConfirm}
      />

      {/* Summarize Today Dialog */}
      <Dialog open={summaryOpen} onOpenChange={(open) => {
        setSummaryOpen(open);
        if (!open) setShowEmailForm(false);
      }}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Today's Email Summary
            </DialogTitle>
          </DialogHeader>
          {/* Stats bar */}
          {summaryStats && !summarizeMutation.isPending && (
            <div className="text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
              <span className="font-semibold text-foreground">{summaryStats.total}</span> emails today
              {' — '}
              <span className="text-green-600 dark:text-green-400">{summaryStats.read} read</span>
              {', '}
              <span className="text-blue-600 dark:text-blue-400">{summaryStats.unread} unread</span>
              {summaryStats.deleted > 0 && (
                <>
                  {', '}
                  <span className="text-red-500 dark:text-red-400">{summaryStats.deleted} deleted</span>
                </>
              )}
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-auto" id="summary-content">
            {summarizeMutation.isPending ? (
              <SummarizeLoadingState onCancel={() => {
                summarizeMutation.reset();
                setSummaryOpen(false);
              }} />
            ) : (
              <div
                className="prose prose-sm dark:prose-invert max-w-none [&_h3]:text-base [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:font-semibold [&_div]:py-0.5"
                dangerouslySetInnerHTML={{ __html: summaryContent }}
              />
            )}
          </div>
          {/* Email form */}
          {showEmailForm && (
            <div className="flex items-center gap-2 border rounded-md p-2 bg-muted/30">
              <Input
                placeholder="Recipient email"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                className="flex-1 h-8 text-sm"
              />
              <Button
                size="sm"
                className="h-8 text-xs"
                onClick={() => sendEmailMutation.mutate()}
                disabled={sendEmailMutation.isPending || !emailTo.trim() || !summaryContent}
              >
                {sendEmailMutation.isPending ? (
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                ) : (
                  <Send className="mr-1.5 h-3 w-3" />
                )}
                Send
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs"
                onClick={() => setShowEmailForm(false)}
              >
                Cancel
              </Button>
            </div>
          )}
          <DialogFooter>
            {!summarizeMutation.isPending && summaryContent && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadSummaryCsv(mailboxId || undefined)}
                >
                  <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
                  CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const statsHtml = summaryStats
                      ? `<div style="margin-bottom:16px;padding:8px 12px;background:#f5f5f5;border-radius:6px;font-size:14px;color:#555"><strong style="color:#000">${summaryStats.total}</strong> emails today — <span style="color:#16a34a">${summaryStats.read} read</span>, <span style="color:#2563eb">${summaryStats.unread} unread</span></div>`
                      : '';
                    const printContent = `<!DOCTYPE html><html><head><title>Email Summary</title><style>body{font-family:system-ui,-apple-system,sans-serif;padding:24px;max-width:700px;margin:0 auto}h3{margin-top:16px;margin-bottom:8px}div{padding:2px 0}</style></head><body><h1>Today's Email Summary</h1>${statsHtml}${summaryContent}</body></html>`;
                    const iframe = document.createElement('iframe');
                    iframe.style.display = 'none';
                    document.body.appendChild(iframe);
                    iframe.contentDocument?.open();
                    iframe.contentDocument?.write(printContent);
                    iframe.contentDocument?.close();
                    setTimeout(() => {
                      iframe.contentWindow?.print();
                      setTimeout(() => document.body.removeChild(iframe), 1000);
                    }, 250);
                  }}
                >
                  <FileText className="mr-1.5 h-3.5 w-3.5" />
                  PDF
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowEmailForm(!showEmailForm)}
                >
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                  Email
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" onClick={() => setSummaryOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ComposeEmailDialog open={composeOpen} onOpenChange={setComposeOpen} />

      <AiSearchPanel
        open={aiSearchOpen}
        onOpenChange={setAiSearchOpen}
        mailboxId={mailboxId}
        onSelectResult={(result: AiSearchResult) => {
          // Find matching event in current data, or construct a preview-compatible stub
          const matchingEvent = events.find((e) => e.messageId === result.messageId);
          if (matchingEvent) {
            setPreviewEvent(matchingEvent);
          } else {
            // Construct a minimal EventItem from the search result to open preview
            setPreviewEvent({
              _id: result.id,
              messageId: result.messageId,
              mailboxId: result.mailboxId,
              eventType: 'arrived',
              sender: { email: result.senderEmail, name: result.senderName },
              subject: result.subject,
              timestamp: result.receivedAt,
              receivedAt: result.receivedAt,
              importance: result.importance,
              hasAttachments: result.hasAttachments,
              categories: result.categories,
              isRead: result.isRead,
            } as EventItem);
          }
        }}
      />
    </div>
  );
}

// --- Highlight utility ---

function highlightText(text: string, query: string): string {
  if (!query || !text) return text;
  const words = query.split(/\s+/).filter((w) => w.length >= 2);
  if (!words.length) return text;
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  return text.replace(pattern, '<mark class="bg-yellow-200 dark:bg-yellow-500/30 rounded-sm px-0.5">$1</mark>');
}

// --- Summarize Loading State ---

const SUMMARY_MESSAGES = [
  "🔍 Digging through your inbox...",
  "📬 So many emails, so little time...",
  "🤖 AI is reading faster than you ever could...",
  "☕ Grab a coffee, this inbox is THICC...",
  "🧠 Teaching AI what 'urgent' really means...",
  "📊 Crunching numbers, dodging spam...",
  "🕵️ Hunting for emails that actually matter...",
  "💌 Sorting love letters from newsletters...",
  "🗑️ Resisting the urge to delete everything...",
  "🎯 Finding needles in your email haystack...",
  "📝 Writing your summary with extra sass...",
  "🚀 Almost there... probably...",
  "🤯 Wow, you get a LOT of email...",
  "🧹 Sweeping through the chaos...",
  "🎭 Judging your subscription choices...",
  "⏳ Still faster than reading them yourself...",
  "🔮 Predicting which ones you'll ignore...",
  "🏋️ Heavy lifting in progress...",
  "📖 Reading between the lines (literally)...",
  "🎪 Organizing this circus of an inbox...",
];

function SummarizeLoadingState({ onCancel }: { onCancel: () => void }) {
  const [messageIndex, setMessageIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const msgTimer = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % SUMMARY_MESSAGES.length);
    }, 3000);
    return () => clearInterval(msgTimer);
  }, []);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs.toString().padStart(2, '0')}s` : `${secs}s`;

  return (
    <div className="flex flex-col items-center justify-center py-12 gap-4">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p
        key={messageIndex}
        className="text-sm text-muted-foreground animate-in fade-in slide-in-from-bottom-2 duration-300"
      >
        {SUMMARY_MESSAGES[messageIndex]}
      </p>
      <p className="text-xs text-muted-foreground/60 tabular-nums">{timeStr}</p>
      <Button
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={onCancel}
      >
        <X className="mr-1.5 h-3.5 w-3.5" />
        Cancel
      </Button>
    </div>
  );
}

// --- Folder Sync Overlay ---

const SYNC_MESSAGES = [
  "📡 Beaming down your emails from the cloud...",
  "📮 Your mailbox is spilling its secrets...",
  "🏃 Chasing emails at the speed of light...",
  "🧲 Magnetically attracting your messages...",
  "🎣 Fishing for emails in the Microsoft ocean...",
  "🚚 Mail truck incoming, honk honk!",
  "🌊 Surfing the email wave...",
  "🐝 Busy bees fetching your honey... er, mail...",
  "🏗️ Building your email empire, one message at a time...",
  "🎰 Every message is a winner!",
  "📦 Unpacking your digital mail bag...",
  "🛸 Downloading emails from the mothership...",
  "⚡ Electrons carrying your precious messages...",
  "🎁 Unwrapping emails like birthday presents...",
  "🧙 Conjuring messages from the Graph API void...",
  "🐌 Just kidding, we're actually pretty fast...",
  "🎪 Step right up! Watch the emails appear!",
  "🍿 Sit back, relax, enjoy the sync show...",
  "🦅 Emails soaring in from Microsoft HQ...",
  "🔬 Carefully examining each message...",
];

function FolderSyncOverlay({
  progress,
  onCancel,
}: {
  progress: SyncProgress | null;
  onCancel: () => void;
}) {
  const [messageIndex, setMessageIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const msgTimer = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % SYNC_MESSAGES.length);
    }, 3000);
    return () => clearInterval(msgTimer);
  }, []);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs.toString().padStart(2, '0')}s` : `${secs}s`;

  const total = progress
    ? progress.created + progress.updated + progress.deleted + progress.skipped
    : 0;

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-5">
      {/* Animated mail icon */}
      <div className="relative">
        <Mail className="h-12 w-12 text-primary animate-bounce" />
        {total > 0 && (
          <span className="absolute -top-2 -right-3 bg-primary text-primary-foreground text-xs font-bold rounded-full h-6 min-w-6 flex items-center justify-center px-1.5 animate-in zoom-in duration-200">
            {total}
          </span>
        )}
      </div>

      {/* Funny rotating message */}
      <p
        key={messageIndex}
        className="text-base text-muted-foreground animate-in fade-in slide-in-from-bottom-2 duration-300 text-center max-w-md"
      >
        {SYNC_MESSAGES[messageIndex]}
      </p>

      {/* Progress stats */}
      {progress && (
        <div className="flex items-center gap-4 text-sm tabular-nums">
          {progress.created > 0 && (
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
              <Inbox className="h-3.5 w-3.5" />
              {progress.created} new
            </span>
          )}
          {progress.updated > 0 && (
            <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
              <RefreshCw className="h-3.5 w-3.5" />
              {progress.updated} updated
            </span>
          )}
          {progress.deleted > 0 && (
            <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
              <Trash2 className="h-3.5 w-3.5" />
              {progress.deleted} removed
            </span>
          )}
          {progress.pageMessages > 0 && (
            <span className="text-muted-foreground">
              ({progress.pageMessages} in last batch)
            </span>
          )}
        </div>
      )}

      {/* Elapsed time */}
      <p className="text-xs text-muted-foreground/60 tabular-nums">{timeStr}</p>

      {/* Cancel button */}
      <Button
        variant="outline"
        size="sm"
        className="mt-1"
        onClick={onCancel}
      >
        <X className="mr-1.5 h-3.5 w-3.5" />
        Stop Sync
      </Button>
    </div>
  );
}

// --- Email Preview Pane ---

interface EmailPreviewPaneProps {
  event: EventItem;
  mailboxId: string;
  position: 'right' | 'bottom';
  onClose: () => void;
  onJustDelete: (event: EventItem) => void;
  onMarkRead: (event: EventItem) => void;
  onQuickDelete: (event: EventItem) => void;
  onQuickMarkRead: (event: EventItem) => void;
  onAction: (event: EventItem) => void;
  searchQuery?: string;
}

function EmailPreviewPane({
  event,
  mailboxId,
  onClose,
  onJustDelete,
  onMarkRead,
  onQuickDelete,
  onQuickMarkRead,
  onAction,
  searchQuery = '',
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

  // Compose mode: reply, replyAll, forward, or null
  const [composeMode, setComposeMode] = useState<'reply' | 'replyAll' | 'forward' | null>(null);
  const [composeBody, setComposeBody] = useState('');
  const [forwardTo, setForwardTo] = useState<string[]>([]);
  const [replyCC, setReplyCC] = useState<string[]>([]);
  const [replyBCC, setReplyBCC] = useState<string[]>([]);
  const [showCC, setShowCC] = useState(false);
  const [showBCC, setShowBCC] = useState(false);
  const [trackReply, setTrackReply] = useState(true);

  // Reset compose mode when switching emails
  useEffect(() => {
    setComposeMode(null);
    setComposeBody('');
    setForwardTo([]);
    setReplyCC([]);
    setReplyBCC([]);
    setShowCC(false);
    setShowBCC(false);
    setTrackReply(true);
  }, [event._id]);

  // Reply mutation
  const replyMutation = useMutation({
    mutationFn: () => replyToMessage(mailboxId, event.messageId, composeBody, replyCC, replyBCC, trackReply),
    onSuccess: () => {
      toast.success('Reply sent');
      setComposeMode(null);
      setComposeBody('');
      setReplyCC([]);
      setReplyBCC([]);
      setShowCC(false);
      setShowBCC(false);
    },
    onError: (err: Error) => {
      toast.error(`Reply failed: ${err.message}`);
    },
  });

  // Reply All mutation
  const replyAllMutation = useMutation({
    mutationFn: () => replyAllToMessage(mailboxId, event.messageId, composeBody, replyCC, replyBCC, trackReply),
    onSuccess: () => {
      toast.success('Reply-all sent');
      setComposeMode(null);
      setComposeBody('');
      setReplyCC([]);
      setReplyBCC([]);
      setShowCC(false);
      setShowBCC(false);
    },
    onError: (err: Error) => {
      toast.error(`Reply-all failed: ${err.message}`);
    },
  });

  // Forward mutation
  const forwardMutation = useMutation({
    mutationFn: () => {
      const recipients = forwardTo.map((email) => ({ email }));
      return forwardMessage(mailboxId, event.messageId, recipients, composeBody);
    },
    onSuccess: () => {
      toast.success('Message forwarded');
      setComposeMode(null);
      setComposeBody('');
      setForwardTo([]);
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

  const isSending = replyMutation.isPending || replyAllMutation.isPending || forwardMutation.isPending;

  return (
    <Card className="h-full border-0 shadow-none rounded-none flex flex-col">
      <CardHeader className="pb-3 shrink-0">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-snug break-words" dangerouslySetInnerHTML={{
            __html: highlightText(event.subject || '(no subject)', searchQuery),
          }} />
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
      <CardContent className="flex-1 min-h-0 flex flex-col space-y-4 overflow-auto">
        {/* Sender */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              {event.sender.name && (
                <div className="font-medium text-sm truncate" dangerouslySetInnerHTML={{
                  __html: highlightText(event.sender.name, searchQuery),
                }} />
              )}
              <div className="text-xs text-muted-foreground truncate" dangerouslySetInnerHTML={{
                __html: highlightText(event.sender.email || 'Unknown sender', searchQuery),
              }} />
            </div>
          </div>
        </div>

        {/* To recipients */}
        {bodyData?.message?.toRecipients && bodyData.message.toRecipients.length > 0 && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">To:</span>{' '}
            {bodyData.message.toRecipients.map((r, i) => (
              <span key={i}>
                {i > 0 && ', '}
                {r.emailAddress?.name ? `${r.emailAddress.name} <${r.emailAddress.address}>` : r.emailAddress?.address}
              </span>
            ))}
          </div>
        )}

        {/* CC recipients */}
        {bodyData?.message?.ccRecipients && bodyData.message.ccRecipients.length > 0 && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">CC:</span>{' '}
            {bodyData.message.ccRecipients.map((r, i) => (
              <span key={i}>
                {i > 0 && ', '}
                {r.emailAddress?.name ? `${r.emailAddress.name} <${r.emailAddress.address}>` : r.emailAddress?.address}
              </span>
            ))}
          </div>
        )}

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
        <div className="flex flex-wrap items-center gap-1 pt-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant={composeMode === 'reply' ? 'default' : 'outline'}
                className="h-7 w-7"
                onClick={() => {
                  setComposeMode(composeMode === 'reply' ? null : 'reply');
                  setComposeBody('');
                  setForwardTo([]);
                }}
              >
                <Reply className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reply</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant={composeMode === 'replyAll' ? 'default' : 'outline'}
                className="h-7 w-7"
                onClick={() => {
                  setComposeMode(composeMode === 'replyAll' ? null : 'replyAll');
                  setComposeBody('');
                  setForwardTo([]);
                }}
              >
                <ReplyAll className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reply All</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant={composeMode === 'forward' ? 'default' : 'outline'}
                className="h-7 w-7"
                onClick={() => {
                  setComposeMode(composeMode === 'forward' ? null : 'forward');
                  setComposeBody('');
                  setForwardTo([]);
                }}
              >
                <Forward className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Forward</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7 text-destructive hover:text-destructive"
                onClick={() => onJustDelete(event)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                onClick={() => onMarkRead(event)}
                disabled={event.isRead}
              >
                <MailCheck className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{event.isRead ? 'Already read' : 'Mark as read'}</TooltipContent>
          </Tooltip>
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

        {/* Compose area (Reply / Reply All / Forward) */}
        {composeMode && (
          <div className="border rounded-md p-3 space-y-3 bg-muted/30">
            <div className="text-sm font-medium">
              {composeMode === 'reply' ? 'Reply' : composeMode === 'replyAll' ? 'Reply All' : 'Forward'}
            </div>

            {(composeMode === 'reply' || composeMode === 'replyAll') && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground shrink-0">
                    To: {composeMode === 'replyAll' ? 'All recipients' : (event.sender.email || 'Unknown')}
                  </span>
                  <div className="flex items-center gap-1 ml-auto">
                    {!showCC && (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                        onClick={() => setShowCC(true)}
                      >
                        CC
                      </button>
                    )}
                    {!showBCC && (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                        onClick={() => setShowBCC(true)}
                      >
                        BCC
                      </button>
                    )}
                  </div>
                </div>
                {showCC && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-8 shrink-0">CC:</span>
                    <EmailAutocomplete
                      autoFocus
                      value={replyCC}
                      onChange={setReplyCC}
                      placeholder="Add CC recipients..."
                      className="text-sm flex-1"
                    />
                  </div>
                )}
                {showBCC && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-8 shrink-0">BCC:</span>
                    <EmailAutocomplete
                      autoFocus={!showCC}
                      value={replyBCC}
                      onChange={setReplyBCC}
                      placeholder="Add BCC recipients..."
                      className="text-sm flex-1"
                    />
                  </div>
                )}
              </div>
            )}

            {composeMode === 'forward' && (
              <EmailAutocomplete
                autoFocus
                value={forwardTo}
                onChange={setForwardTo}
                placeholder="email@example.com"
                className="text-sm"
              />
            )}

            <Textarea
              autoFocus={composeMode !== 'forward'}
              placeholder={composeMode === 'forward' ? 'Add a message (optional)...' : 'Write your reply...'}
              value={composeBody}
              onChange={(e) => setComposeBody(e.target.value)}
              rows={4}
              className="text-sm resize-none"
            />

            {(composeMode === 'reply' || composeMode === 'replyAll') && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="track-reply"
                  checked={trackReply}
                  onCheckedChange={(v) => setTrackReply(!!v)}
                />
                <label
                  htmlFor="track-reply"
                  className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none"
                >
                  <Eye className="h-3 w-3" />
                  Track email opens
                </label>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={
                  isSending ||
                  !composeBody.trim() ||
                  (composeMode === 'forward' && forwardTo.length === 0)
                }
                onClick={() => {
                  if (composeMode === 'reply') {
                    replyMutation.mutate();
                  } else if (composeMode === 'replyAll') {
                    replyAllMutation.mutate();
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
                  setForwardTo([]);
                  setReplyCC([]);
                  setReplyBCC([]);
                  setShowCC(false);
                  setShowBCC(false);
                }}
                disabled={isSending}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Email body */}
        <div className="border-t pt-3 flex-1 min-h-0 flex flex-col">
          {bodyLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : messageBody ? (
            messageBody.contentType === 'html' ? (
              <iframe
                srcDoc={messageBody.content}
                className="w-full border-0 flex-1 min-h-0"
                sandbox="allow-same-origin"
                title="Email content"
              />
            ) : (
              <pre className="text-sm whitespace-pre-wrap break-words text-foreground flex-1">
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
