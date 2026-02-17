import type { Job } from 'bullmq';
import { processChangeNotification } from '../../services/eventCollector.js';
import logger from '../../config/logger.js';

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
  const { notification, subscriptionId } = job.data as {
    notification: {
      subscriptionId: string;
      changeType: string;
      resource: string;
      resourceData?: { id: string; '@odata.type'?: string };
    };
    subscriptionId: string;
  };

  logger.info('Processing webhook event', {
    jobId: job.id,
    changeType: notification.changeType,
    subscriptionId,
  });

  await processChangeNotification(notification);

  logger.info('Webhook event processed', {
    jobId: job.id,
    changeType: notification.changeType,
    subscriptionId,
  });
}
