import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useLocation, useSearchParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useKeyboardShortcuts, type Shortcut } from '@/hooks/useKeyboardShortcuts';
import { useInboxMutations } from '@/hooks/useInboxMutations';
import { useFolderSync } from '@/hooks/useFolderSync';
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
  Send,
  SquarePen,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { fetchEvents, summarizeToday, sendSummaryEmail } from '@/api/events';
import type { EventItem } from '@/api/events';
import { applyActionsToMessages } from '@/api/mailboxes';
import { batchLookupTracking, type TrackingMatch } from '@/api/tracking';
import { useSettings } from '@/hooks/useSettings';
import { RuleActionsDialog } from '@/components/inbox/RuleActionsDialog';
import { ComposeEmailDialog } from '@/components/inbox/ComposeEmailDialog';
import { AiSearchPanel } from '@/components/inbox/AiSearchPanel';
import { EmailPreviewPane } from '@/components/inbox/EmailPreviewPane';
import { FolderSyncOverlay } from '@/components/inbox/FolderSyncOverlay';
import { InboxSummaryDialog } from '@/components/inbox/InboxSummaryDialog';
import { InboxFilterToolbar } from '@/components/inbox/InboxFilterToolbar';
import { InboxBulkActionBar } from '@/components/inbox/InboxBulkActionBar';
import { InboxContactsPanel } from '@/components/inbox/InboxContactsPanel';
import { markEventsReadInCache } from '@/lib/inboxCache';
import type { AiSearchResult } from '@/api/aiSearch';
import { InboxDataGrid } from '@/components/inbox/InboxDataGrid';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

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

function InboxEmailList({ mailboxId, isUnifiedMode = false }: { mailboxId?: string; isUnifiedMode?: boolean }) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const mailboxes = useAuthStore((s) => s.mailboxes);
  const connectedMailboxes = mailboxes.filter((m) => m.isConnected);
  const folderFilter: string = useUiStore((s) => s.inboxFolder);
  const setFolderFilter = useUiStore((s) => s.setInboxFolder);
  const queryKeyId = mailboxId || 'unified';

  // Folder sync with progress overlay
  const { syncState, setSyncState, syncMutation } = useFolderSync(mailboxId);

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState(() => searchParams.get('date') || 'today');
  const [unreadOnly, setUnreadOnly] = useState(() => searchParams.get('status') === 'unread');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dialogEvents, setDialogEvents] = useState<EventItem[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [aiSearchOpen, setAiSearchOpen] = useState(false);
  const [contentType, setContentType] = useState<'all' | 'emails' | 'files' | 'contacts'>('all');

  // Contacts panel needs the configured contacts mailbox/folder from settings
  const { data: settingsData } = useSettings();
  const contactsMailboxId = settingsData?.user.preferences.contactsMailboxId;
  const contactsFolderId = settingsData?.user.preferences.contactsFolderId;

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

  const handleSummarize = useCallback(() => {
    setSummaryContent('');
    setSummaryStats(null);
    setShowEmailForm(false);
    setSummaryOpen(true);
    summarizeMutation.mutate();
  }, [summarizeMutation]);

  const handleSummaryOpenChange = useCallback((open: boolean) => {
    setSummaryOpen(open);
    if (!open) setShowEmailForm(false);
  }, []);

  const handleCancelSummarize = useCallback(() => {
    summarizeMutation.reset();
    setSummaryOpen(false);
  }, [summarizeMutation]);

  const handleToggleEmailForm = useCallback(() => {
    setShowEmailForm((v) => !v);
  }, []);

  // Keyboard navigation
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const visibleEventsRef = useRef<EventItem[]>([]);

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
    setFocusedIndex(visibleEventsRef.current.findIndex((e) => e._id === event._id));
  }, []);

  // Auto-mark email as read after 3 seconds of previewing
  useEffect(() => {
    if (!previewEvent || previewEvent.isRead) return;

    const timer = setTimeout(() => {
      applyActionsToMessages(previewEvent.mailboxId, [previewEvent.messageId], [{ actionType: 'markRead' }])
        .then(() => {
          // Update local cache to reflect read status
          markEventsReadInCache(queryClient, queryKeyId, (e) => e._id === previewEvent._id);
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

  // Sync filter state → URL query params for deep-link consistency
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('date', dateFilter);
        next.set('status', unreadOnly ? 'unread' : 'all');
        return next;
      },
      { replace: true },
    );
  }, [dateFilter, unreadOnly, setSearchParams]);

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
  visibleEventsRef.current = visibleEvents;

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

  const {
    bulkDeleteMutation,
    bulkMarkReadMutation,
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
    confirmMutation,
  } = useInboxMutations({
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
  });

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

  const handleResetFilters = useCallback(() => {
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
  }, [setFolderFilter, queryClient, queryKeyId]);

  const handleDateFilterChange = useCallback((filter: string) => {
    setDateFilter(filter);
    setPage(1);
  }, []);

  const handleUnreadOnlyChange = useCallback((unread: boolean) => {
    setUnreadOnly(unread);
    setPage(1);
  }, []);

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
      // d — delete focused or previewed email, advance to next
      {
        key: 'd',
        action: () => {
          // Prioritise previewEvent (what's on screen) over keyboard focus index.
          // If the user navigated j/k after opening a preview, focusedIndex can
          // point to a different row than the one displayed — use preview first.
          const current = previewEvent ?? (focusedIndex >= 0 && focusedIndex < visibleEvents.length ? visibleEvents[focusedIndex] : null);
          if (!current) return;
          const idx = visibleEvents.findIndex((e) => e._id === current._id);
          const nextEvent = visibleEvents[idx + 1] ?? visibleEvents[idx - 1] ?? null;
          // Advance preview before deleting so onMutate's null-check sees nextEvent, not current
          setPreviewEvent(nextEvent);
          setFocusedIndex(idx < visibleEvents.length - 1 ? idx : Math.max(0, idx - 1));
          handleJustDelete(current);
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
        <InboxContactsPanel contactsMailboxId={contactsMailboxId} contactsFolderId={contactsFolderId} />
      ) : !showEmailContent ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          Coming soon
        </div>
      ) : (<>
      {/* Date filter tabs */}
      <InboxFilterToolbar
        onReset={handleResetFilters}
        onSync={() => syncMutation.mutate()}
        syncPending={syncMutation.isPending}
        onSummarize={handleSummarize}
        summarizePending={summarizeMutation.isPending}
        onAiSearch={() => setAiSearchOpen(true)}
        dateFilter={dateFilter}
        onDateFilterChange={handleDateFilterChange}
        unreadOnly={unreadOnly}
        onUnreadOnlyChange={handleUnreadOnlyChange}
        totalCount={data?.pagination.total}
        previewPosition={previewPosition}
        onPreviewPositionChange={handlePreviewPositionChange}
      />

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
      <InboxBulkActionBar
        selectedCount={selectedCount}
        onDelete={() => bulkDeleteMutation.mutate()}
        deletePending={bulkDeleteMutation.isPending}
        onMarkRead={() => bulkMarkReadMutation.mutate()}
        markReadPending={bulkMarkReadMutation.isPending}
        onCreateRules={handleBulkAction}
        onClear={() => setSelectedIds(new Set())}
      />

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
      <InboxSummaryDialog
        open={summaryOpen}
        onOpenChange={handleSummaryOpenChange}
        summaryStats={summaryStats}
        summaryContent={summaryContent}
        isPending={summarizeMutation.isPending}
        onCancel={handleCancelSummarize}
        mailboxId={mailboxId}
        emailTo={emailTo}
        onEmailToChange={setEmailTo}
        showEmailForm={showEmailForm}
        onToggleEmailForm={handleToggleEmailForm}
        onSendEmail={() => sendEmailMutation.mutate()}
        isSending={sendEmailMutation.isPending}
      />

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
