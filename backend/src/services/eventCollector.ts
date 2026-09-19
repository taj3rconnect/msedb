import { WebhookSubscription } from '../models/WebhookSubscription.js';
import { Mailbox } from '../models/Mailbox.js';
import { getAccessTokenForMailbox } from '../auth/tokenManager.js';
import logger from '../config/logger.js';
import type { ChangeNotification } from './eventCollector/types.js';
import { handleDeleted } from './eventCollector/handleDeleted.js';
import { handleCreated } from './eventCollector/handleCreated.js';
import { handleUpdated } from './eventCollector/handleUpdated.js';

export { saveEmailEvent } from './eventCollector/saveEmailEvent.js';
export type { ChangeNotification } from './eventCollector/types.js';

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
