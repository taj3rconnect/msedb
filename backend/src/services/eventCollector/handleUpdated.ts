import { extractMetadata } from '../metadataExtractor.js';
import { EmailEvent, type IEmailEvent } from '../../models/EmailEvent.js';
import logger from '../../config/logger.js';
import type { ChangeNotification } from './types.js';
import { saveEmailEvent } from './saveEmailEvent.js';
import { fetchGraphMessage } from './fetchGraphMessage.js';

/**
 * Handle an 'updated' change notification.
 * Detect moves (parentFolderId change), read status, flag, and category changes.
 */
export async function handleUpdated(
  notification: ChangeNotification,
  userId: unknown,
  mailboxId: unknown,
  mailboxEmail: string,
  accessToken: string,
): Promise<void> {
  const messageId = notification.resourceData?.id;
  if (!messageId) {
    logger.warn('Updated notification missing resourceData.id', {
      subscriptionId: notification.subscriptionId,
    });
    return;
  }

  const graphMessage = await fetchGraphMessage(mailboxEmail, messageId, accessToken);
  if (!graphMessage) return;

  const metadata = extractMetadata(graphMessage);

  // Look up the most recent event for this messageId to detect changes
  const priorEvent = await EmailEvent.findOne({ messageId })
    .sort({ timestamp: -1 })
    .lean();

  let eventCreated = false;

  // Detect move: parentFolderId changed from last known state
  if (priorEvent?.toFolder && graphMessage.parentFolderId !== priorEvent.toFolder) {
    const moveEvent: Partial<IEmailEvent> = {
      ...metadata,
      userId,
      mailboxId,
      eventType: 'moved',
      timestamp: new Date(),
      fromFolder: priorEvent.toFolder,
      toFolder: graphMessage.parentFolderId,
    } as Partial<IEmailEvent>;

    await saveEmailEvent(moveEvent);
    eventCreated = true;
  }

  // Detect read status change: was unread, now read
  if (priorEvent && !priorEvent.isRead && graphMessage.isRead === true) {
    const readEvent: Partial<IEmailEvent> = {
      ...metadata,
      userId,
      mailboxId,
      eventType: 'read',
      timestamp: new Date(),
      toFolder: graphMessage.parentFolderId,
    } as Partial<IEmailEvent>;

    await saveEmailEvent(readEvent);
    eventCreated = true;

    // Update isRead on ALL events for this message so inbox page reflects the change
    await EmailEvent.updateMany(
      { messageId, userId, mailboxId },
      { $set: { isRead: true } },
    );
  }

  // Detect flag change: flag status changed to 'flagged'
  if (graphMessage.flag?.flagStatus === 'flagged') {
    // We do not store flag status in EmailEvent, so check if prior event was 'flagged' type
    // Only create flagged event if there is no prior 'flagged' event for this message
    const hasPriorFlagEvent = await EmailEvent.findOne({
      messageId,
      eventType: 'flagged',
    }).lean();

    if (!hasPriorFlagEvent) {
      const flagEvent: Partial<IEmailEvent> = {
        ...metadata,
        userId,
        mailboxId,
        eventType: 'flagged',
        timestamp: new Date(),
        toFolder: graphMessage.parentFolderId,
      } as Partial<IEmailEvent>;

      await saveEmailEvent(flagEvent);
      eventCreated = true;
    }
  }

  // Detect category change
  if (priorEvent) {
    const priorCategories = priorEvent.categories ?? [];
    const currentCategories = graphMessage.categories ?? [];

    const categoriesChanged =
      priorCategories.length !== currentCategories.length ||
      priorCategories.some((c: string) => !currentCategories.includes(c));

    if (categoriesChanged) {
      const categoryEvent: Partial<IEmailEvent> = {
        ...metadata,
        userId,
        mailboxId,
        eventType: 'categorized',
        timestamp: new Date(),
        toFolder: graphMessage.parentFolderId,
        categories: currentCategories,
      } as Partial<IEmailEvent>;

      await saveEmailEvent(categoryEvent);
      eventCreated = true;
    }
  }

  if (!eventCreated) {
    logger.debug('Updated notification with no detectable changes -- skipping', {
      subscriptionId: notification.subscriptionId,
      messageId,
    });
  }
}
