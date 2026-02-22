import { apiFetch } from './client';

// --- Types ---

export interface EventItem {
  _id: string;
  eventType: string;
  sender: {
    name?: string;
    email?: string;
    domain?: string;
  };
  subject?: string;
  timestamp: string;
  mailboxId: string;
  messageId: string;
  fromFolder?: string;
  toFolder?: string;
  importance: string;
  hasAttachments: boolean;
  categories: string[];
  isRead: boolean;
}

export interface EventsResponse {
  events: EventItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface SenderBreakdownItem {
  _id: string;
  count: number;
  latestEvent: string;
}

export interface SenderBreakdownResponse {
  breakdown: SenderBreakdownItem[];
}

export interface TimelineBucket {
  _id: string;
  count: number;
}

export interface TimelineResponse {
  timeline: TimelineBucket[];
  range: string;
}

// --- Params ---

export interface FetchEventsParams {
  mailboxId?: string;
  eventType?: string;
  senderDomain?: string;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
  excludeDeleted?: boolean;
  inboxOnly?: boolean;
  unreadOnly?: boolean;
  folder?: string;
  dateFrom?: string;
  dateTo?: string;
}

// --- API functions ---

/**
 * Fetch paginated, filterable email events.
 */
export async function fetchEvents(params: FetchEventsParams): Promise<EventsResponse> {
  const searchParams = new URLSearchParams();
  if (params.mailboxId) searchParams.set('mailboxId', params.mailboxId);
  if (params.eventType) searchParams.set('eventType', params.eventType);
  if (params.senderDomain) searchParams.set('senderDomain', params.senderDomain);
  if (params.search) searchParams.set('search', params.search);
  if (params.page) searchParams.set('page', String(params.page));
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);
  if (params.excludeDeleted) searchParams.set('excludeDeleted', 'true');
  if (params.inboxOnly) searchParams.set('inboxOnly', 'true');
  if (params.unreadOnly) searchParams.set('unreadOnly', 'true');
  if (params.folder) searchParams.set('folder', params.folder);
  if (params.dateFrom) searchParams.set('dateFrom', params.dateFrom);
  if (params.dateTo) searchParams.set('dateTo', params.dateTo);
  const qs = searchParams.toString();
  return apiFetch<EventsResponse>(`/events${qs ? `?${qs}` : ''}`);
}

/**
 * Fetch sender domain breakdown (top 20).
 */
export async function fetchSenderBreakdown(mailboxId?: string): Promise<SenderBreakdownResponse> {
  const params = mailboxId ? `?mailboxId=${encodeURIComponent(mailboxId)}` : '';
  return apiFetch<SenderBreakdownResponse>(`/events/sender-breakdown${params}`);
}

/**
 * Fetch event timeline (hourly or daily buckets).
 */
export async function fetchEventTimeline(
  mailboxId?: string,
  range?: '24h' | '30d',
): Promise<TimelineResponse> {
  const searchParams = new URLSearchParams();
  if (mailboxId) searchParams.set('mailboxId', mailboxId);
  if (range) searchParams.set('range', range);
  const qs = searchParams.toString();
  return apiFetch<TimelineResponse>(`/events/timeline${qs ? `?${qs}` : ''}`);
}
