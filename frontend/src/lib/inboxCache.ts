import type { QueryClient } from '@tanstack/react-query';
import type { EventItem, EventsResponse } from '@/api/events';

/**
 * Shared optimistic-update helpers for the `['inbox-events', queryKeyId]` query
 * family. Intentionally matches every cached page for `queryKeyId` (broad prefix
 * match, not the exact page/search/date key) so quick-delete/quick-mark-read
 * actions are reflected across all currently-cached pages at once.
 */

export function markEventsReadInCache(
  queryClient: QueryClient,
  queryKeyId: string,
  predicate: (event: EventItem) => boolean,
): void {
  queryClient.setQueriesData<EventsResponse>(
    { queryKey: ['inbox-events', queryKeyId] },
    (old) => {
      if (!old) return old;
      return {
        ...old,
        events: old.events.map((e) => (predicate(e) ? { ...e, isRead: true } : e)),
      };
    },
  );
}

export function removeEventsFromCache(
  queryClient: QueryClient,
  queryKeyId: string,
  predicate: (event: EventItem) => boolean,
): void {
  queryClient.setQueriesData<EventsResponse>(
    { queryKey: ['inbox-events', queryKeyId] },
    (old) => {
      if (!old) return old;
      const filtered = old.events.filter((e) => !predicate(e));
      return {
        ...old,
        events: filtered,
        pagination: { ...old.pagination, total: old.pagination.total - (old.events.length - filtered.length) },
      };
    },
  );
}
