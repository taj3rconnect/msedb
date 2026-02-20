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

export interface MailFolder {
  id: string;
  displayName: string;
}

/**
 * Fetch mail folders for a mailbox.
 */
export async function fetchMailboxFolders(
  mailboxId: string,
): Promise<{ folders: MailFolder[] }> {
  return apiFetch<{ folders: MailFolder[] }>(`/mailboxes/${mailboxId}/folders`);
}

/**
 * Create a new mail folder in a mailbox.
 */
export async function createMailboxFolder(
  mailboxId: string,
  displayName: string,
): Promise<{ folder: MailFolder }> {
  return apiFetch<{ folder: MailFolder }>(`/mailboxes/${mailboxId}/folders`, {
    method: 'POST',
    body: JSON.stringify({ displayName }),
  });
}

/**
 * Apply actions to specific messages in a mailbox immediately via Graph API.
 */
/**
 * Get count of messages in the Deleted Items folder.
 */
export async function fetchDeletedCount(
  mailboxId: string,
): Promise<{ count: number }> {
  return apiFetch<{ count: number }>(`/mailboxes/${mailboxId}/deleted-count`);
}

/**
 * Permanently delete all messages in the Deleted Items folder.
 */
export async function emptyDeletedItems(
  mailboxId: string,
): Promise<{ deleted: number; failed: number }> {
  return apiFetch<{ deleted: number; failed: number }>(
    `/mailboxes/${mailboxId}/empty-deleted`,
    { method: 'POST' },
  );
}

export async function applyActionsToMessages(
  mailboxId: string,
  messageIds: string[],
  actions: { actionType: string; toFolder?: string }[],
): Promise<{ applied: number; failed: number; total: number }> {
  return apiFetch<{ applied: number; failed: number; total: number }>(
    `/mailboxes/${mailboxId}/apply-actions`,
    {
      method: 'POST',
      body: JSON.stringify({ messageIds, actions }),
    },
  );
}
