import { EmailEvent, type IEmailEvent } from '../../models/EmailEvent.js';
import logger from '../../config/logger.js';
import type { ChangeNotification } from './types.js';
import { saveEmailEvent } from './saveEmailEvent.js';

/**
 * Handle a 'deleted' change notification.
 * The message is already deleted from Graph, so we can only record the event
 * with metadata copied from any prior event for this messageId.
 */
export async function handleDeleted(
  notification: ChangeNotification,
  userId: unknown,
  mailboxId: unknown,
): Promise<void> {
  const messageId = notification.resourceData?.id;
  if (!messageId) {
    logger.warn('Deleted notification missing resourceData.id', {
      subscriptionId: notification.subscriptionId,
    });
    return;
  }

  // Try to find a prior event for this message to copy metadata
  const priorEvent = await EmailEvent.findOne({ messageId })
    .sort({ timestamp: -1 })
    .lean();

  const eventData: Partial<IEmailEvent> = {
    userId,
    mailboxId,
    messageId,
    eventType: 'deleted',
    timestamp: new Date(),
  } as Partial<IEmailEvent>;

  // Copy metadata from prior event if available
  if (priorEvent) {
    eventData.sender = priorEvent.sender;
    eventData.subject = priorEvent.subject;
    eventData.internetMessageId = priorEvent.internetMessageId;
    eventData.receivedAt = priorEvent.receivedAt;
    eventData.importance = priorEvent.importance;
    eventData.hasAttachments = priorEvent.hasAttachments;
    eventData.conversationId = priorEvent.conversationId;
    eventData.categories = priorEvent.categories;
    eventData.metadata = priorEvent.metadata;
  }

  await saveEmailEvent(eventData);

  // Mark all prior arrived events for this message as deleted (avoids unbounded $nin queries)
  await EmailEvent.updateMany(
    { userId, mailboxId, messageId, eventType: 'arrived' },
    { $set: { isDeleted: true } },
  );
}
