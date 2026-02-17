import { useState, useCallback } from 'react';
import type { SortingState } from '@tanstack/react-table';
import { AlertCircle } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { useEvents, useSenderBreakdown, useEventTimeline } from '@/hooks/useEvents';
import { EventFilters } from '@/components/events/EventFilters';
import { EventsTable } from '@/components/events/EventsTable';
import { EventTimeline } from '@/components/events/EventTimeline';
import { SenderBreakdown } from '@/components/events/SenderBreakdown';
import { EmptyState } from '@/components/shared/EmptyState';

/**
 * Email Activity page composing data table, filters, timeline chart, and sender breakdown.
 *
 * Manages filter/pagination state locally and reads the global mailbox selection
 * from uiStore for per-mailbox filtering.
 */
export function EmailActivityPage() {
  const selectedMailboxId = useUiStore((s) => s.selectedMailboxId);

  // Filter state
  const [eventType, setEventType] = useState('all');
  const [senderDomain, setSenderDomain] = useState('');
  const [timelineRange, setTimelineRange] = useState<'24h' | '30d'>('24h');

  // Pagination & sort state
  const [page, setPage] = useState(1);
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'timestamp', desc: true },
  ]);

  // Derive sort params from TanStack sorting state
  const sortBy = sorting[0]?.id ?? 'timestamp';
  const sortOrder = sorting[0]?.desc === false ? 'asc' : 'desc';

  // Build query params
  const eventsParams = {
    mailboxId: selectedMailboxId ?? undefined,
    eventType: eventType !== 'all' ? eventType : undefined,
    senderDomain: senderDomain || undefined,
    page,
    limit: 50,
    sortBy,
    sortOrder,
  };

  // Data hooks
  const events = useEvents(eventsParams);
  const senderBreakdown = useSenderBreakdown(selectedMailboxId);
  const timeline = useEventTimeline(selectedMailboxId, timelineRange);

  // Reset page when filters change
  const handleEventTypeChange = useCallback((value: string) => {
    setEventType(value);
    setPage(1);
  }, []);

  const handleSenderDomainChange = useCallback((value: string) => {
    setSenderDomain(value);
    setPage(1);
  }, []);

  const handleSortingChange = useCallback((next: SortingState) => {
    setSorting(next);
    setPage(1);
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Email Activity</h1>

      {/* Charts Row */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <EventTimeline data={timeline.data} isLoading={timeline.isLoading} />
        </div>
        <div className="lg:col-span-2">
          <SenderBreakdown data={senderBreakdown.data} isLoading={senderBreakdown.isLoading} />
        </div>
      </div>

      {/* Filters */}
      <EventFilters
        eventType={eventType}
        senderDomain={senderDomain}
        timelineRange={timelineRange}
        onEventTypeChange={handleEventTypeChange}
        onSenderDomainChange={handleSenderDomainChange}
        onTimelineRangeChange={setTimelineRange}
      />

      {/* Events Table */}
      {events.isError ? (
        <EmptyState
          icon={AlertCircle}
          title="Failed to load events"
          description="There was an error loading email events. Please try again."
        />
      ) : (
        <EventsTable
          data={events.data?.events ?? []}
          isLoading={events.isLoading}
          page={page}
          totalPages={events.data?.pagination.totalPages ?? 0}
          total={events.data?.pagination.total ?? 0}
          sorting={sorting}
          onSortingChange={handleSortingChange}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
