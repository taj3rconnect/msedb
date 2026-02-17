import { apiFetch } from './client';

// --- Types ---

export interface StagedEmail {
  id: string;
  messageId: string;
  originalFolder: string;
  stagedAt: string;
  expiresAt: string;
  status: 'staged' | 'rescued' | 'executed' | 'expired';
  actions: Array<{
    actionType: string;
    toFolder?: string;
    category?: string;
  }>;
  ruleId: string;
  mailboxId: string;
  createdAt: string;
}

export interface StagingResponse {
  stagedEmails: StagedEmail[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// --- API functions ---

/**
 * Fetch paginated staged emails with optional filters.
 */
export async function fetchStagedEmails(params?: {
  mailboxId?: string;
  status?: string;
  page?: number;
  limit?: number;
}): Promise<StagingResponse> {
  const searchParams = new URLSearchParams();
  if (params?.mailboxId) searchParams.set('mailboxId', params.mailboxId);
  if (params?.status) searchParams.set('status', params.status);
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));
  const qs = searchParams.toString();
  return apiFetch<StagingResponse>(`/staging${qs ? `?${qs}` : ''}`);
}

/**
 * Fetch count of currently staged emails.
 */
export async function fetchStagingCount(
  mailboxId?: string,
): Promise<{ count: number }> {
  const qs = mailboxId ? `?mailboxId=${mailboxId}` : '';
  return apiFetch<{ count: number }>(`/staging/count${qs}`);
}

/**
 * Rescue a single staged email (remove from staging, keep in inbox).
 */
export async function rescueStagedEmail(
  id: string,
): Promise<{ stagedEmail: StagedEmail }> {
  return apiFetch<{ stagedEmail: StagedEmail }>(`/staging/${id}/rescue`, {
    method: 'POST',
  });
}

/**
 * Batch rescue multiple staged emails.
 */
export async function batchRescueStagedEmails(
  ids: string[],
): Promise<{ rescued: number }> {
  return apiFetch<{ rescued: number }>('/staging/batch-rescue', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

/**
 * Execute a single staged email immediately (skip grace period).
 */
export async function executeStagedEmail(
  id: string,
): Promise<{ stagedEmail: StagedEmail }> {
  return apiFetch<{ stagedEmail: StagedEmail }>(`/staging/${id}/execute`, {
    method: 'POST',
  });
}

/**
 * Batch execute multiple staged emails immediately.
 */
export async function batchExecuteStagedEmails(
  ids: string[],
): Promise<{ executed: number }> {
  return apiFetch<{ executed: number }>('/staging/batch-execute', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}
