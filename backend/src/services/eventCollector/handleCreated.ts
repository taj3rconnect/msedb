import { extractMetadata } from '../metadataExtractor.js';
import { evaluateRulesForMessage } from '../ruleEngine.js';
import { executeActions } from '../actionExecutor.js';
import { getIO } from '../../config/socket.js';
import type { IEmailEvent } from '../../models/EmailEvent.js';
import type { Types } from 'mongoose';
import { queues } from '../../jobs/queues.js';
import logger from '../../config/logger.js';
import type { ChangeNotification } from './types.js';
import { saveEmailEvent } from './saveEmailEvent.js';
import { fetchGraphMessage } from './fetchGraphMessage.js';

/**
 * Handle a 'created' change notification.
 * Fetch message details and store as an 'arrived' event.
 */
export async function handleCreated(
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

  const saved = await saveEmailEvent(eventData);

  // Fire-and-forget: enqueue embedding + body prefetch jobs for new emails
  if (saved) {
    try {
      await queues['email-embedding'].add('embed-email', {
        userId: String(userId),
        mailboxId: String(mailboxId),
        mailboxEmail,
        messageId,
        senderEmail: metadata.sender?.email || '',
        senderName: metadata.sender?.name || '',
        subject: metadata.subject || '',
        receivedAt: metadata.receivedAt?.toISOString() || new Date().toISOString(),
        folder: graphMessage.parentFolderId || '',
        importance: metadata.importance || 'normal',
        hasAttachments: metadata.hasAttachments || false,
        categories: metadata.categories || [],
        isRead: graphMessage.isRead || false,
      }, {
        attempts: 2,
        backoff: { type: 'exponential', delay: 10000 },
        delay: 2000,
      });
    } catch { /* non-blocking */ }
    try {
      await queues['body-prefetch'].add('prefetch-body', {
        mailboxId: String(mailboxId),
        mailboxEmail,
        messageId,
      }, {
        jobId: `body:${String(mailboxId)}:${messageId}`,
        attempts: 2,
        backoff: { type: 'exponential', delay: 15000 },
        delay: 3000,
      });
    } catch { /* non-blocking */ }
  }

  // Evaluate automation rules for the new message -- skip on duplicate delivery
  // (webhook redelivery) to avoid executing actions twice
  if (!saved) return;

  try {
    const result = await evaluateRulesForMessage(
      userId as Types.ObjectId,
      mailboxId as Types.ObjectId,
      graphMessage,
      accessToken,
    );

    if (result.matched && result.ruleId && result.actions) {
      logger.info('Rule matched incoming email', {
        ruleId: result.ruleId,
        messageId,
        actionsCount: result.actions.length,
        skipStaging: result.skipStaging,
      });

      // Emit popup socket event for any popup actions (non-blocking)
      const popupAction = result.actions.find((a) => a.actionType === 'popup');
      if (popupAction) {
        try {
          const io = getIO();
          io.to(`user:${userId}`).emit('rule:popup', {
            message: popupAction.popupMessage || 'Rule triggered',
            sender: graphMessage.from?.emailAddress?.address || '',
            subject: graphMessage.subject || '',
          });
        } catch { /* non-blocking */ }
      }

      // Skip executeActions for popup-only rules (nothing else to do)
      const nonPopupActions = result.actions.filter((a) => a.actionType !== 'popup');
      if (nonPopupActions.length === 0) return;

      await executeActions({
        mailboxEmail,
        messageId,
        actions: result.actions,
        ruleId: result.ruleId as unknown as Types.ObjectId,
        userId: userId as Types.ObjectId,
        mailboxId: mailboxId as Types.ObjectId,
        originalFolder: graphMessage.parentFolderId ?? '',
        accessToken,
        skipStaging: result.skipStaging,
      });
    }
  } catch (err) {
    // Rule evaluation failures must not block event collection
    logger.error('Rule evaluation failed for incoming email', {
      messageId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
