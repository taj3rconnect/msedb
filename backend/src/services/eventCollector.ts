import { graphFetch, GraphApiError } from './graphClient.js';
import { extractMetadata, type GraphMessage } from './metadataExtractor.js';
import { buildSelectParam } from '../utils/graph.js';
import { getAccessTokenForMailbox } from '../auth/tokenManager.js';
import { EmailEvent, type IEmailEvent } from '../models/EmailEvent.js';
import { WebhookSubscription } from '../models/WebhookSubscription.js';
import { Mailbox } from '../models/Mailbox.js';
import { getIO } from '../config/socket.js';
import logger from '../config/logger.js';

/**
 * Save an EmailEvent document, handling deduplication via the compound unique index.
 * After a successful save, emits a Socket.IO event to the user's room.
 *
 * @returns true if saved, false if duplicate (silently skipped)
 * @throws Re-throws any error that is not a duplicate key error
 */
export async function saveEmailEvent(
  eventData: Partial<IEmailEvent>,
): Promise<boolean> {
  try {
    const savedEvent = await EmailEvent.create(eventData);

    // Emit Socket.IO event for real-time dashboard updates
    try {
      const io = getIO();
      const userId = String(savedEvent.userId);
      io.to(`user:${userId}`).emit('email:event', {
        id: savedEvent._id,
        eventType: savedEvent.eventType,
        sender: savedEvent.sender,
        subject: savedEvent.subject,
        timestamp: savedEvent.timestamp,
        mailboxId: savedEvent.mailboxId,
      });
    } catch {
      // Socket.IO not initialized (e.g., during tests) -- ignore silently
    }

    return true;
  } catch (err: unknown) {
    // MongoDB duplicate key error code 11000 -- silently skip
    if (
      err !== null &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: number }).code === 11000
    ) {
      return false;
    }
    throw err;
  }
}

export interface ChangeNotification {
  subscriptionId: string;
  changeType: string;
  resource: string;
  resourceData?: {
    id: string;
    '@odata.type'?: string;
  };
}

/**
 * Process a single change notification from Microsoft Graph into EmailEvent documents.
 *
 * Looks up the subscription, fetches message details from Graph API,
 * extracts metadata, detects move/read/flag/category changes, and stores
 * deduplicated EmailEvent documents.
 */
export async function processChangeNotification(
  notification: ChangeNotification,
): Promise<void> {
  const { subscriptionId, changeType, resourceData } = notification;

  try {
    // Look up the WebhookSubscription to get userId and mailboxId
    const subscription = await WebhookSubscription.findOne({ subscriptionId });
    if (!subscription) {
      logger.warn('Notification for unknown subscription -- may have been deleted', {
        subscriptionId,
        changeType,
      });
      return;
    }

    const { userId, mailboxId } = subscription;

    // Get access token for the mailbox
    let accessToken: string;
    try {
      accessToken = await getAccessTokenForMailbox(mailboxId.toString());
    } catch (err) {
      logger.error('Failed to get access token for mailbox -- token refresh will handle reconnection', {
        mailboxId: mailboxId.toString(),
        subscriptionId,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    // Update lastNotificationAt (fire-and-forget)
    WebhookSubscription.findByIdAndUpdate(subscription._id, {
      lastNotificationAt: new Date(),
    }).catch((err: unknown) => {
      logger.error('Failed to update lastNotificationAt', {
        subscriptionId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // Get the mailbox email for Graph API calls
    const mailbox = await Mailbox.findById(mailboxId).select('email');
    if (!mailbox) {
      logger.error('Mailbox not found', { mailboxId: mailboxId.toString() });
      return;
    }

    switch (changeType) {
      case 'deleted':
        await handleDeleted(notification, userId, mailboxId);
        break;

      case 'created':
        await handleCreated(notification, userId, mailboxId, mailbox.email, accessToken);
        break;

      case 'updated':
        await handleUpdated(notification, userId, mailboxId, mailbox.email, accessToken);
        break;

      default:
        logger.debug('Unknown changeType -- skipping', { changeType, subscriptionId });
    }
  } catch (err) {
    logger.error('Failed to process change notification', {
      subscriptionId,
      changeType,
      messageId: resourceData?.id,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
}

/**
 * Handle a 'deleted' change notification.
 * The message is already deleted from Graph, so we can only record the event
 * with metadata copied from any prior event for this messageId.
 */
async function handleDeleted(
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
}

/**
 * Fetch a message from Graph API using $select to minimize payload.
 * Returns null if the message was deleted (404) between notification and fetch.
 */
async function fetchGraphMessage(
  mailboxEmail: string,
  messageId: string,
  accessToken: string,
): Promise<GraphMessage | null> {
  const selectParam = buildSelectParam('message');
  const path = `/users/${mailboxEmail}/messages/${messageId}?$select=${selectParam}`;

  try {
    const response = await graphFetch(path, accessToken);
    return (await response.json()) as GraphMessage;
  } catch (err) {
    if (err instanceof GraphApiError && err.status === 404) {
      logger.info('Message deleted between notification and fetch -- skipping', {
        mailboxEmail,
        messageId,
      });
      return null;
    }
    throw err;
  }
}

/**
 * Handle a 'created' change notification.
 * Fetch message details and store as an 'arrived' event.
 */
async function handleCreated(
  notification: ChangeNotification,
  userId: unknown,
  mailboxId: unknown,
  mailboxEmail: string,
  accessToken: string,
): Promise<void> {
  const messageId = notification.resourceData?.id;
  if (!messageId) {
    logger.warn('Created notification missing resourceData.id', {
      subscriptionId: notification.subscriptionId,
    });
    return;
  }

  const graphMessage = await fetchGraphMessage(mailboxEmail, messageId, accessToken);
  if (!graphMessage) return;

  const metadata = extractMetadata(graphMessage);

  const eventData: Partial<IEmailEvent> = {
    ...metadata,
    userId,
    mailboxId,
    eventType: 'arrived',
    timestamp: new Date(),
    toFolder: graphMessage.parentFolderId,
  } as Partial<IEmailEvent>;

  await saveEmailEvent(eventData);
}

/**
 * Handle an 'updated' change notification.
 * Detect moves (parentFolderId change), read status, flag, and category changes.
 */
async function handleUpdated(
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
  }

  // Detect flag change: flag status changed to 'flagged'
  if (graphMessage.flag?.flagStatus === 'flagged') {
    const priorFlagStatus = priorEvent
      ? undefined // We do not store flag status in EmailEvent, so check if prior event was 'flagged' type
      : undefined;

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
