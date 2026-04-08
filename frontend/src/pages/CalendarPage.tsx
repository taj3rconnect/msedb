import { useState, useMemo, useCallback } from 'react';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addWeeks, addMonths, startOfYear, endOfYear } from 'date-fns';
import {
  Calendar, AlertCircle, CheckCircle2, RefreshCw, Search, X, Trash2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/shared/EmptyState';
import { useCalendarEvents, useCalendarSyncStatus, useCancelCalendarEvent } from '@/hooks/useCalendar';
import type { CalendarEventItem, CalendarEventsParams } from '@/api/calendar';

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatDt(dt: string, isAllDay: boolean): string {
  const d = new Date(dt);
  return isAllDay ? format(d, 'MMM d, yyyy') : format(d, 'MMM d, yyyy h:mm a');
}

function formatLastSync(dt: string | null): string {
  if (!dt) return 'Never';
  return format(new Date(dt), 'MMM d, h:mm a');
}

function mailboxLabel(mb: { email: string; displayName?: string } | null): string {
  if (!mb) return '—';
  return mb.displayName ? `${mb.displayName} (${mb.email})` : mb.email;
}

// ─── Period types ──────────────────────────────────────────────────────────────

type PeriodPreset = 'this-week' | 'this-month' | 'next-week' | 'next-month' | 'this-year' | 'custom';

interface DateRange {
  startFrom: string;
  startTo: string;
}

function getPresetRange(preset: PeriodPreset, customRange?: { fromMonth: string; toMonth: string }): DateRange | undefined {
  const now = new Date();
  switch (preset) {
    case 'this-week': {
      const s = startOfWeek(now, { weekStartsOn: 1 });
      const e = endOfWeek(now, { weekStartsOn: 1 });
      return { startFrom: s.toISOString(), startTo: e.toISOString() };
    }
    case 'this-month': {
      const s = startOfMonth(now);
      const e = endOfMonth(now);
      return { startFrom: s.toISOString(), startTo: e.toISOString() };
    }
    case 'next-week': {
      const next = addWeeks(now, 1);
      const s = startOfWeek(next, { weekStartsOn: 1 });
      const e = endOfWeek(next, { weekStartsOn: 1 });
      return { startFrom: s.toISOString(), startTo: e.toISOString() };
    }
    case 'next-month': {
      const next = addMonths(now, 1);
      const s = startOfMonth(next);
      const e = endOfMonth(next);
      return { startFrom: s.toISOString(), startTo: e.toISOString() };
    }
    case 'this-year': {
      const s = startOfYear(now);
      const e = endOfYear(now);
      return { startFrom: s.toISOString(), startTo: e.toISOString() };
    }
    case 'custom': {
      if (!customRange?.fromMonth || !customRange?.toMonth) return undefined;
      const [fromY, fromM] = customRange.fromMonth.split('-').map(Number);
      const [toY, toM] = customRange.toMonth.split('-').map(Number);
      const s = startOfMonth(new Date(fromY, fromM - 1));
      const e = endOfMonth(new Date(toY, toM - 1));
      return { startFrom: s.toISOString(), startTo: e.toISOString() };
    }
  }
}

// ─── Dot for mailbox origin ────────────────────────────────────────────────────

const ORIGIN_COLORS: Record<string, string> = {
  'aptask.com': 'bg-blue-500',
  'jobtalk.ai': 'bg-emerald-500',
  'yenom.ai': 'bg-amber-500',
};

function OriginDot({ email }: { email: string }) {
  const domain = email.split('@')[1] ?? '';
  const color = ORIGIN_COLORS[domain] ?? 'bg-gray-400';
  return <span className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${color}`} title={email} />;
}

// ─── Sync status cards ─────────────────────────────────────────────────────────

function SyncStatusSection() {
  const { data, isLoading } = useCalendarSyncStatus();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[100px] rounded-xl" />)}
      </div>
    );
  }

  if (!data?.mailboxes.length) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {data.mailboxes.map((mb) => (
        <Card key={mb.mailboxId}>
          <CardContent className="py-4 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
              <p className="text-sm font-medium truncate">{mb.email}</p>
            </div>
            <p className="text-2xl font-bold">{mb.totalSynced}</p>
            <p className="text-xs text-muted-foreground">synced events</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <RefreshCw className="h-3 w-3" />
              Last sync: {formatLastSync(mb.lastSyncedAt)}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Event row ─────────────────────────────────────────────────────────────────

interface EventRowProps {
  event: CalendarEventItem;
  selected: boolean;
  onToggle: (id: string) => void;
}

function EventRow({ event, selected, onToggle }: EventRowProps) {
  const mirrorEmails = event.mirrors.map((m) => m.mailbox?.email ?? '?');

  return (
    <TableRow className={selected ? 'bg-red-50 dark:bg-red-950/20' : undefined}>
      <TableCell className="w-10">
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggle(event.id)}
          aria-label="Select event"
        />
      </TableCell>
      <TableCell className="font-medium max-w-[240px] truncate">{event.subject || '(No subject)'}</TableCell>
      <TableCell className="whitespace-nowrap">{formatDt(event.startDateTime, event.isAllDay)}</TableCell>
      <TableCell className="text-sm text-muted-foreground max-w-[160px]">
        <span className="flex items-center gap-1.5">
          {event.sourceMailbox && <OriginDot email={event.sourceMailbox.email} />}
          <span className="truncate">{mailboxLabel(event.sourceMailbox)}</span>
        </span>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {mirrorEmails.map((email) => (
            <Badge key={email} variant="secondary" className="text-xs">
              {email}
            </Badge>
          ))}
          {mirrorEmails.length === 0 && (
            <span className="text-xs text-muted-foreground">None yet</span>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

const PERIOD_LABELS: { value: PeriodPreset; label: string }[] = [
  { value: 'this-week', label: 'This Week' },
  { value: 'this-month', label: 'This Month' },
  { value: 'next-week', label: 'Next Week' },
  { value: 'next-month', label: 'Next Month' },
  { value: 'this-year', label: 'This Year' },
  { value: 'custom', label: 'Custom' },
];

/** Build a search token set from a calendar event for fast matching. */
function buildSearchText(ev: CalendarEventItem): string {
  const parts: string[] = [ev.subject ?? ''];
  if (ev.sourceMailbox) {
    parts.push(ev.sourceMailbox.email, ev.sourceMailbox.displayName ?? '');
  }
  for (const m of ev.mirrors) {
    if (m.mailbox) {
      parts.push(m.mailbox.email, m.mailbox.displayName ?? '');
    }
  }
  return parts.join(' ').toLowerCase();
}

export function CalendarPage() {
  const [search, setSearch] = useState('');
  const [activePeriod, setActivePeriod] = useState<PeriodPreset | null>(null);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cancelling, setCancelling] = useState(false);

  const { mutateAsync: cancelEvent } = useCancelCalendarEvent();

  // Build API params from period selection
  const apiParams = useMemo((): CalendarEventsParams | undefined => {
    if (!activePeriod) return undefined;
    const range = getPresetRange(activePeriod, { fromMonth: customFrom, toMonth: customTo });
    return range ?? undefined;
  }, [activePeriod, customFrom, customTo]);

  const { data, isLoading, isError } = useCalendarEvents(apiParams);

  // Client-side search filter
  const filteredEvents = useMemo(() => {
    if (!data?.events) return [];
    if (!search.trim()) return data.events;
    const q = search.toLowerCase();
    return data.events.filter((ev) => buildSearchText(ev).includes(q));
  }, [data, search]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selected.size === filteredEvents.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredEvents.map((e) => e.id)));
    }
  }, [selected.size, filteredEvents]);

  const handleCancelSelected = useCallback(async () => {
    if (selected.size === 0) return;
    const confirmed = window.confirm(
      `Cancel ${selected.size} event${selected.size > 1 ? 's' : ''}? This will remove them from all synced mailboxes.`
    );
    if (!confirmed) return;
    setCancelling(true);
    try {
      await Promise.all([...selected].map((id) => cancelEvent(id)));
      setSelected(new Set());
    } finally {
      setCancelling(false);
    }
  }, [selected, cancelEvent]);

  const handlePeriodClick = (preset: PeriodPreset) => {
    if (activePeriod === preset) {
      setActivePeriod(null);
    } else {
      setActivePeriod(preset);
    }
    setSelected(new Set());
  };

  const clearFilters = () => {
    setActivePeriod(null);
    setSearch('');
    setCustomFrom('');
    setCustomTo('');
    setSelected(new Set());
  };

  const allSelectedOnPage = filteredEvents.length > 0 && selected.size === filteredEvents.length;
  const someSelected = selected.size > 0 && !allSelectedOnPage;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Calendar Sync</h1>
      </div>

      <p className="text-sm text-muted-foreground">
        Events created, updated, or deleted in any connected account are automatically mirrored to all other accounts.
      </p>

      <SyncStatusSection />

      {/* ── Search + Period filters ── */}
      <div className="space-y-3">
        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search subject, mailbox, domain…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-9"
          />
          {search && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setSearch('')}
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Period presets */}
        <div className="flex flex-wrap gap-2 items-center">
          {PERIOD_LABELS.map(({ value, label }) => (
            <Button
              key={value}
              variant={activePeriod === value ? 'default' : 'outline'}
              size="sm"
              onClick={() => handlePeriodClick(value)}
            >
              {label}
            </Button>
          ))}
          {(activePeriod || search) && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
              <X className="h-3.5 w-3.5 mr-1" /> Clear
            </Button>
          )}
        </div>

        {/* Custom month pickers */}
        {activePeriod === 'custom' && (
          <div className="flex items-center gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">From month</label>
              <input
                type="month"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="border rounded px-3 py-1.5 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">To month</label>
              <input
                type="month"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="border rounded px-3 py-1.5 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Events table ── */}
      {isLoading ? (
        <Skeleton className="h-[300px] rounded-xl" />
      ) : isError ? (
        <EmptyState
          icon={AlertCircle}
          title="Failed to load events"
          description="There was an error loading synced calendar events."
        />
      ) : !filteredEvents.length ? (
        <EmptyState
          icon={Calendar}
          title={search || activePeriod ? 'No events match' : 'No synced events yet'}
          description={
            search || activePeriod
              ? 'Try adjusting your search or period filter.'
              : 'Create a calendar event in any connected account and it will appear here once synced.'
          }
        />
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between py-3">
            <CardTitle className="text-lg">
              {activePeriod
                ? PERIOD_LABELS.find((p) => p.value === activePeriod)?.label
                : 'Upcoming Synced Events'}
              {search && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  — {filteredEvents.length} result{filteredEvents.length !== 1 ? 's' : ''}
                </span>
              )}
            </CardTitle>
            {selected.size > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleCancelSelected}
                disabled={cancelling}
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                {cancelling ? 'Cancelling…' : `Cancel ${selected.size} event${selected.size > 1 ? 's' : ''}`}
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelectedOnPage ? true : someSelected ? 'indeterminate' : false}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>Created in</TableHead>
                  <TableHead>Mirrored to</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEvents.map((ev) => (
                  <EventRow
                    key={ev.id}
                    event={ev}
                    selected={selected.has(ev.id)}
                    onToggle={toggleSelect}
                  />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
