import { useQuery } from '@tanstack/react-query';
import {
  fetchCalendarEvents,
  fetchCalendarSyncStatus,
  type CalendarEventsResponse,
  type CalendarSyncStatusResponse,
} from '@/api/calendar';

export function useCalendarEvents(upcoming = true) {
  return useQuery<CalendarEventsResponse>({
    queryKey: ['calendar', 'events', upcoming],
    queryFn: () => fetchCalendarEvents(upcoming),
  });
}

export function useCalendarSyncStatus() {
  return useQuery<CalendarSyncStatusResponse>({
    queryKey: ['calendar', 'sync-status'],
    queryFn: fetchCalendarSyncStatus,
    refetchInterval: 30_000,
  });
}
