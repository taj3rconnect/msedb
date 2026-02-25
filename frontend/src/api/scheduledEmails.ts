import { apiFetch } from './client';

// --- Types ---

export interface ScheduledEmail {
  _id: string;
  userId: string;
  mailboxId: string;
  mailboxEmail: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  contentType: string;
  scheduledAt: string;
  status: 'pending' | 'sent' | 'cancelled' | 'failed';
  sentAt?: string;
  cancelledAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledEmailsResponse {
  scheduledEmails: ScheduledEmail[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// --- API functions ---

/**
 * Fetch paginated scheduled emails with optional status filter.
 */
export async function fetchScheduledEmails(params?: {
  status?: string;
  page?: number;
  limit?: number;
}): Promise<ScheduledEmailsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));
  const qs = searchParams.toString();
  return apiFetch<ScheduledEmailsResponse>(`/scheduled-emails${qs ? `?${qs}` : ''}`);
}

/**
 * Fetch count of pending scheduled emails (for sidebar badge).
 */
export async function fetchScheduledCount(): Promise<{ count: number }> {
  return apiFetch<{ count: number }>('/scheduled-emails/count');
}

/**
 * Create a new scheduled email.
 */
export async function scheduleEmail(
  mailboxId: string,
  params: {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
    scheduledAt: string;
  },
): Promise<{ scheduledEmail: ScheduledEmail }> {
  return apiFetch<{ scheduledEmail: ScheduledEmail }>('/scheduled-emails', {
    method: 'POST',
    body: JSON.stringify({ mailboxId, ...params }),
  });
}

/**
 * Cancel a pending scheduled email.
 */
export async function cancelScheduledEmail(
  id: string,
): Promise<{ scheduledEmail: ScheduledEmail }> {
  return apiFetch<{ scheduledEmail: ScheduledEmail }>(`/scheduled-emails/${id}`, {
    method: 'DELETE',
  });
}
