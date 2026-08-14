import type { Job } from 'bullmq';
import { processChangeNotification } from '../../services/eventCollector.js';
import logger from '../../config/logger.js';
import { isGraphNotification } from '../../utils/graphNotification.js';

/**
 * BullMQ processor that handles incoming change notifications from the
 * webhook-events queue.
 *
 * Each job contains a single change notification from Microsoft Graph.
 * The processor delegates to processChangeNotification which handles
 * fetching message details, extracting metadata, and storing EmailEvent
 * documents.
 *
 * Errors propagate to BullMQ for retry handling (attempts: 3, exponential backoff).
 */
export async function processWebhookEvent(job: Job): Promise<void> {
  const { notification, subscriptionId } = (job.data ?? {}) as {
    notification: unknown;
    subscriptionId: unknown;
  };

  // Defence in depth: the route validates before enqueueing, but jobs queued by
  // an older build could still carry an unchecked payload. A bad shape is
  // terminal -- log and complete rather than burn the retry budget.
  if (!isGraphNotification(notification)) {
    logger.warn('Malformed webhook job payload -- dropping', {
      jobId: job.id,
      subscriptionId: typeof subscriptionId === 'string' ? subscriptionId : undefined,
    });
    return;
  }

  logger.info('Processing webhook event', {
    jobId: job.id,
    changeType: notification.changeType,
    subscriptionId,
  });

  await processChangeNotification({
    subscriptionId: notification.subscriptionId,
    changeType: notification.changeType ?? '',
    resource: notification.resource ?? '',
    resourceData: notification.resourceData?.id
      ? {
          id: notification.resourceData.id,
          '@odata.type': notification.resourceData['@odata.type'],
        }
      : undefined,
  });

  logger.info('Webhook event processed', {
    jobId: job.id,
    changeType: notification.changeType,
    subscriptionId,
  });
}
