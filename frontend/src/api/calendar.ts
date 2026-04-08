import { apiFetch } from './client';

export interface CalendarMirrorInfo {
  mailbox: { email: string; displayName?: string } | null;
  eventId: string;
}

export interface CalendarEventItem {
  id: string;
  subject: string;
  startDateTime: string;
  endDateTime: string;
  isAllDay: boolean;
  sourceMailbox: { email: string; displayName?: string } | null;
  mirrors: CalendarMirrorInfo[];
  lastSyncedAt: string;
}

export interface CalendarEventsResponse {
  events: CalendarEventItem[];
}

export interface MailboxSyncStatus {
  mailboxId: string;
  email: string;
  displayName?: string;
  eventsAsSource: number;
  eventsAsMirror: number;
  totalSynced: number;
  lastSyncedAt: string | null;
}

export interface CalendarSyncStatusResponse {
  mailboxes: MailboxSyncStatus[];
}

export interface CalendarEventsParams {
  startFrom?: string;
  startTo?: string;
}

export async function fetchCalendarEvents(params?: CalendarEventsParams): Promise<CalendarEventsResponse> {
  const qs = new URLSearchParams();
  if (params?.startFrom) qs.set('startFrom', params.startFrom);
  if (params?.startTo) qs.set('startTo', params.startTo);
  const query = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<CalendarEventsResponse>(`/calendar/events${query}`);
}

export async function fetchCalendarSyncStatus(): Promise<CalendarSyncStatusResponse> {
  return apiFetch<CalendarSyncStatusResponse>('/calendar/sync-status');
}

export async function cancelCalendarEvent(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/calendar/events/${id}`, { method: 'DELETE' });
}
