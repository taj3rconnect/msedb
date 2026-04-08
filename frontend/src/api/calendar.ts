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

export async function fetchCalendarEvents(upcoming = true): Promise<CalendarEventsResponse> {
  return apiFetch<CalendarEventsResponse>(`/calendar/events?upcoming=${upcoming}`);
}

export async function fetchCalendarSyncStatus(): Promise<CalendarSyncStatusResponse> {
  return apiFetch<CalendarSyncStatusResponse>('/calendar/sync-status');
}
