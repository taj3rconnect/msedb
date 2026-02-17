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
