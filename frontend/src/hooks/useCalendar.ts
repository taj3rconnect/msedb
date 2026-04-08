import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchCalendarEvents,
  fetchCalendarSyncStatus,
  cancelCalendarEvent,
  type CalendarEventsResponse,
  type CalendarSyncStatusResponse,
  type CalendarEventsParams,
} from '@/api/calendar';

export function useCalendarEvents(params?: CalendarEventsParams) {
  return useQuery<CalendarEventsResponse>({
    queryKey: ['calendar', 'events', params],
    queryFn: () => fetchCalendarEvents(params),
  });
}

export function useCalendarSyncStatus() {
  return useQuery<CalendarSyncStatusResponse>({
    queryKey: ['calendar', 'sync-status'],
    queryFn: fetchCalendarSyncStatus,
    refetchInterval: 30_000,
  });
}

export function useCancelCalendarEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelCalendarEvent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar', 'events'] });
      queryClient.invalidateQueries({ queryKey: ['calendar', 'sync-status'] });
    },
  });
}
