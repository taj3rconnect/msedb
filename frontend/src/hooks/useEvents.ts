import { useQuery } from '@tanstack/react-query';
import {
  fetchEvents,
  fetchSenderBreakdown,
  fetchEventTimeline,
} from '@/api/events';
import type {
  FetchEventsParams,
  EventsResponse,
  SenderBreakdownResponse,
  TimelineResponse,
} from '@/api/events';

/**
 * TanStack Query hook for paginated, filterable email events.
 * Socket.IO invalidates ['events'] queries, so this auto-refreshes on new events.
 */
export function useEvents(params: FetchEventsParams) {
  return useQuery<EventsResponse>({
    queryKey: ['events', 'list', params],
    queryFn: () => fetchEvents(params),
  });
}

/**
 * TanStack Query hook for sender domain breakdown.
 */
export function useSenderBreakdown(mailboxId?: string | null) {
  return useQuery<SenderBreakdownResponse>({
    queryKey: ['events', 'sender-breakdown', mailboxId ?? null],
    queryFn: () => fetchSenderBreakdown(mailboxId ?? undefined),
  });
}

/**
 * TanStack Query hook for event timeline.
 */
export function useEventTimeline(mailboxId?: string | null, range?: '24h' | '30d') {
  return useQuery<TimelineResponse>({
    queryKey: ['events', 'timeline', mailboxId ?? null, range ?? '24h'],
    queryFn: () => fetchEventTimeline(mailboxId ?? undefined, range),
  });
}
