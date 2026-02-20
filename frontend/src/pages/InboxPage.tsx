import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/authStore';
import { fetchEvents } from '@/api/events';
import type { EventItem } from '@/api/events';
import { createRule, updateRule, fetchRules, runRule } from '@/api/rules';
import type { RuleAction, RuleConditions } from '@/api/rules';
import { applyActionsToMessages, fetchDeletedCount, emptyDeletedItems } from '@/api/mailboxes';
import { RuleActionsDialog } from '@/components/inbox/RuleActionsDialog';
import { InboxDataGrid } from '@/components/inbox/InboxDataGrid';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export function InboxPage() {
  const { mailboxId } = useParams<{ mailboxId: string }>();

  if (mailboxId) {
    return <InboxEmailList mailboxId={mailboxId} />;
  }
  return <MailboxSelector />;
}

function MailboxSelector() {
  const navigate = useNavigate();
  const mailboxes = useAuthStore((s) => s.mailboxes);

  const connected = mailboxes.filter((m) => m.isConnected);

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Inbox</h1>
        <p className="text-sm text-muted-foreground mt-1">Select a mailbox to view emails</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {connected.map((mailbox) => (
          <Card
            key={mailbox.id}
            className="cursor-pointer transition-all hover:bg-muted/50 hover:shadow-sm"
            onClick={() => navigate(`/inbox/${mailbox.id}`)}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Inbox className="h-4 w-4 text-muted-foreground" />
                {mailbox.email}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{mailbox.email}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mailboxes = useAuthStore((s) => s.mailboxes);
  const mailbox = mailboxes.find((m) => m.id === mailboxId);

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dialogEvents, setDialogEvents] = useState<EventItem[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Debounce search input by 400ms
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [searchInput]);

  // Clear selection when page, search, or date filter changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, search, dateFilter]);

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
      case 'mtd': {
        const d = new Date(now.getFullYear(), now.getMonth(), 1);
        return { dateFrom: d.toISOString(), dateTo: endOfDay(now).toISOString() };
      }
      case 'last-week': {
        const d = new Date(today); d.setDate(d.getDate() - d.getDay() - 7);
        const e = new Date(d); e.setDate(e.getDate() + 6);
        return { dateFrom: d.toISOString(), dateTo: endOfDay(e).toISOString() };
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
    queryKey: ['inbox-events', mailboxId, page, search, dateFilter, unreadOnly],
    queryFn: () =>
      fetchEvents({
        mailboxId,
        eventType: 'arrived',
        sortBy: 'timestamp',
        sortOrder: 'desc',
        search: search || undefined,
        page,
        limit: 50,
        excludeDeleted: true,
        inboxOnly: true,
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
      // Optimistically hide ALL emails from this sender (not just the clicked one)
      const senderEmail = event.sender.email?.toLowerCase();
      const matchingIds = events
        .filter((e) => e.sender.email?.toLowerCase() === senderEmail)
        .map((e) => e._id);
      setDeletedEventIds((prev) => {
        const next = new Set(prev);
        for (const id of matchingIds) next.add(id);
        return next;
      });
    },
    onSuccess: ({ senderEmail, totalDeleted, mailboxCount }) => {
      const mbLabel = mailboxCount > 1 ? ` across ${mailboxCount} mailboxes` : '';
      toast.success(
        `Rule created for ${senderEmail}${mbLabel} — ${totalDeleted} ${totalDeleted === 1 ? 'email' : 'emails'} deleted`,
      );
      // Keep deleted IDs hidden — don't clear them or refetch immediately.
      // Lazy invalidate so next navigation/focus picks up fresh data.
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      queryClient.invalidateQueries({ queryKey: ['inbox-events', mailboxId] });
      queryClient.invalidateQueries({ queryKey: ['deleted-count', mailboxId] });
    },
    onError: (_err: Error) => {
      // Rule was still created (only runRule might have failed).
      // Keep emails hidden — the rule will catch future ones.
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
    onSuccess: ({ senderEmail, totalApplied, mailboxCount }) => {
      const mbLabel = mailboxCount > 1 ? ` across ${mailboxCount} mailboxes` : '';
      toast.success(
        `Rule created for ${senderEmail}${mbLabel} — ${totalApplied} ${totalApplied === 1 ? 'email' : 'emails'} marked read`,
      );
      // Optimistically update isRead in cache for matching sender emails
      queryClient.setQueriesData<typeof data>(
        { queryKey: ['inbox-events', mailboxId] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            events: old.events.map((e) =>
              e.sender.email?.toLowerCase() === senderEmail.toLowerCase()
                ? { ...e, isRead: true }
                : e,
            ),
          };
        },
      );
      queryClient.invalidateQueries({ queryKey: ['rules'] });
    },
    onError: (err: Error) => {
      toast.error(`Failed: ${err.message}`);
    },
  });

  const handleQuickMarkRead = useCallback((event: EventItem) => {
    if (!event.sender.email) return;
    quickMarkReadMutation.mutate(event);
  }, [quickMarkReadMutation]);

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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/inbox')}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Inbox</h1>
          {mailbox && (
            <p className="text-sm text-muted-foreground">{mailbox.email}</p>
          )}
        </div>
      </div>

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
        <span className="mx-0.5 h-5 w-px bg-border" />
        {([
          ['all', 'All'],
          ['today', 'Today'],
          ['yesterday', 'Yesterday'],
          ['this-week', 'This Week'],
          ['mtd', 'This MTD'],
          ['last-week', 'Last Week'],
          ['last-month', 'Last Month'],
          ['ytd', 'This YTD'],
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
          onClick={() => { setUnreadOnly((v) => !v); setPage(1); }}
        >
          Unread
        </Button>
        {data && (
          <span className="text-sm text-muted-foreground tabular-nums ml-2">
            {data.pagination.total.toLocaleString()} {data.pagination.total === 1 ? 'email' : 'emails'}
          </span>
        )}
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

      {/* Deleted items bar */}
      {deletedCount > 0 && (
        <div className="flex items-center gap-3 rounded-md border border-destructive/20 bg-destructive/5 px-4 py-2">
          <Trash2 className="h-4 w-4 text-destructive" />
          <span className="text-sm">
            {deletedCount} {deletedCount === 1 ? 'item' : 'items'} in Deleted Items
          </span>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => emptyDeletedMutation.mutate()}
            disabled={emptyDeletedMutation.isPending}
          >
            {emptyDeletedMutation.isPending ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Emptying...
              </>
            ) : (
              <>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Empty
              </>
            )}
          </Button>
        </div>
      )}

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
        <>
          {/* Top pagination */}
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

          {/* Data Grid */}
          <InboxDataGrid
            data={visibleEvents}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            allSelected={allSelected}
            someSelected={someSelected}
            onAction={handleGridAction}
            onQuickDelete={handleQuickDelete}
            onJustDelete={handleJustDelete}
            onQuickMarkRead={handleQuickMarkRead}
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
        </>
      )}

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
