import { apiFetch } from './client';
import type { MailboxInfo } from './auth';

interface MailboxesResponse {
  mailboxes: MailboxInfo[];
}

/**
 * Fetch the list of connected mailboxes for the authenticated user.
 */
export async function fetchMailboxes(): Promise<MailboxesResponse> {
  return apiFetch<MailboxesResponse>('/mailboxes');
}

/**
 * Initiate an OAuth flow to connect an additional mailbox.
 * Returns an authUrl that the browser should redirect to.
 */
export async function connectMailbox(loginHint?: string): Promise<{ authUrl: string }> {
  return apiFetch<{ authUrl: string }>('/mailboxes/connect', {
    method: 'POST',
    body: JSON.stringify({ loginHint }),
  });
}

/**
 * Disconnect a mailbox and clear its tokens.
 */
export async function disconnectMailbox(mailboxId: string): Promise<void> {
  return apiFetch(`/mailboxes/${mailboxId}/disconnect`, {
    method: 'DELETE',
  });
}
