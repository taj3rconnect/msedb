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
  totalItemCount: number;
  unreadItemCount: number;
  childFolderCount: number;
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
 * Fetch child folders for a specific folder.
 */
export async function fetchChildFolders(
  mailboxId: string,
  folderId: string,
): Promise<{ folders: MailFolder[] }> {
  return apiFetch<{ folders: MailFolder[] }>(`/mailboxes/${mailboxId}/folders/${folderId}/children`);
}

export interface SyncProgress {
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  pageMessages: number;
}

export interface SyncResult {
  synced: boolean;
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
}

/**
 * Trigger delta sync for a specific folder with SSE progress streaming.
 * Returns an abort function to cancel the sync.
 */
export function syncFolderStream(
  mailboxId: string,
  folderId: string,
  onProgress: (progress: SyncProgress) => void,
  onDone: (result: SyncResult) => void,
  onError: (error: string) => void,
): () => void {
  const ac = new AbortController();
  const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api';

  fetch(`${baseUrl}/mailboxes/${mailboxId}/folders/${folderId}/sync`, {
    method: 'POST',
    credentials: 'include',
    signal: ac.signal,
  })
    .then(async (res) => {
      if (!res.body) {
        onError('No response body');
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7);
          } else if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));
            if (eventType === 'progress') onProgress(data);
            else if (eventType === 'done') onDone(data);
            else if (eventType === 'error') onError(data.message);
          }
        }
      }
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        onError(err.message);
      }
    });

  return () => ac.abort();
}

/**
 * Trigger delta sync for a specific folder (simple, non-streaming).
 */
export async function syncFolder(
  mailboxId: string,
  folderId: string,
): Promise<SyncResult> {
  return new Promise((resolve, reject) => {
    let lastResult: SyncResult | null = null;
    syncFolderStream(
      mailboxId,
      folderId,
      () => {},
      (result) => { lastResult = result; resolve(result); },
      (err) => reject(new Error(err)),
    );
    // Fallback timeout
    setTimeout(() => {
      if (lastResult) resolve(lastResult);
    }, 120000);
  });
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
 * Get aggregated count of messages in Deleted Items across all connected mailboxes.
 */
export async function fetchDeletedCountAll(): Promise<{ count: number }> {
  return apiFetch<{ count: number }>('/mailboxes/deleted-count-all');
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
 * Reply-all to a message via Graph API.
 */
export async function replyAllToMessage(
  mailboxId: string,
  messageId: string,
  body: string,
): Promise<void> {
  await apiFetch(`/mailboxes/${mailboxId}/reply-all`, {
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
