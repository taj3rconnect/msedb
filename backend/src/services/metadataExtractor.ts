import type { IEmailEvent } from '../models/EmailEvent.js';

/**
 * Graph API message object shape (typed based on Graph API research).
 * Only includes fields we request via $select -- never body content.
 */
export interface GraphMessage {
  id: string;
  subject?: string;
  from?: { emailAddress: { name?: string; address?: string } };
  receivedDateTime?: string;
  isRead?: boolean;
  importance?: string;
  hasAttachments?: boolean;
  conversationId?: string;
  categories?: string[];
  parentFolderId?: string;
  internetMessageId?: string;
  internetMessageHeaders?: Array<{ name: string; value: string }>;
  flag?: { flagStatus: string };
  '@removed'?: { reason: string };
}

/**
 * Extract metadata from a Graph message object into a shape compatible
 * with the IEmailEvent interface. NEVER includes body content.
 *
 * @param msg - Graph message object from Graph API response
 * @returns Partial IEmailEvent with extracted metadata fields
 */
export function extractMetadata(msg: GraphMessage): Partial<IEmailEvent> {
  // Extract sender fields
  const senderEmail = msg.from?.emailAddress?.address?.toLowerCase();
  const senderDomain = senderEmail ? senderEmail.split('@')[1] : undefined;
  const senderName = msg.from?.emailAddress?.name;

  // Check internet message headers for newsletter/automated indicators
  const headers = msg.internetMessageHeaders ?? [];

  const hasListUnsubscribe = headers.some(
    (h) => h.name.toLowerCase() === 'list-unsubscribe',
  );

  const isAutomated = headers.some(
    (h) => h.name.toLowerCase() === 'x-auto-response-suppress',
  );

  // Heuristic: emails with List-Unsubscribe header are newsletters
  const isNewsletter = hasListUnsubscribe;

  // Parse importance with safe default
  const rawImportance = msg.importance?.toLowerCase();
  const importance: 'low' | 'normal' | 'high' =
    rawImportance === 'low' || rawImportance === 'high'
      ? rawImportance
      : 'normal';

  return {
    messageId: msg.id,
    internetMessageId: msg.internetMessageId,
    subject: msg.subject,
    sender: {
      name: senderName,
      email: senderEmail,
      domain: senderDomain,
    },
    receivedAt: msg.receivedDateTime
      ? new Date(msg.receivedDateTime)
      : undefined,
    importance,
    hasAttachments: msg.hasAttachments ?? false,
    conversationId: msg.conversationId,
    categories: msg.categories ?? [],
    isRead: msg.isRead ?? false,
    metadata: {
      hasListUnsubscribe,
      isNewsletter,
      isAutomated,
    },
  } as Partial<IEmailEvent>;
}
