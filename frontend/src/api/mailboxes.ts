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

/**
 * Trigger an immediate delta sync to pull recent emails from Microsoft Graph.
 */
export async function triggerSync(): Promise<{ queued: boolean; jobId: string }> {
  return apiFetch<{ queued: boolean; jobId: string }>('/admin/sync-now', {
    method: 'POST',
  });
}

export interface MessageBody {
  id: string;
  subject?: string;
  body?: { contentType: string; content: string };
  bodyPreview?: string;
  from?: { emailAddress: { name?: string; address?: string } };
  toRecipients?: { emailAddress: { name?: string; address?: string } }[];
  ccRecipients?: { emailAddress: { name?: string; address?: string } }[];
  receivedDateTime?: string;
  isRead?: boolean;
  importance?: string;
  hasAttachments?: boolean;
  categories?: string[];
}

/**
 * Fetch a single message including its body from Graph API.
 */
export async function fetchMessageBody(
  mailboxId: string,
  messageId: string,
): Promise<{ message: MessageBody }> {
  return apiFetch<{ message: MessageBody }>(
    `/mailboxes/${mailboxId}/messages/${messageId}`,
  );
}

/**
 * Reply to a message via Graph API.
 */
export async function replyToMessage(
  mailboxId: string,
  messageId: string,
  body: string,
): Promise<void> {
  await apiFetch(`/mailboxes/${mailboxId}/reply`, {
    method: 'POST',
    body: JSON.stringify({ messageId, body }),
  });
}

/**
 * Forward a message via Graph API.
 */
export async function forwardMessage(
  mailboxId: string,
  messageId: string,
  toRecipients: Array<{ email: string; name?: string }>,
  body: string,
): Promise<void> {
  await apiFetch(`/mailboxes/${mailboxId}/forward`, {
    method: 'POST',
    body: JSON.stringify({ messageId, toRecipients, body }),
  });
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
