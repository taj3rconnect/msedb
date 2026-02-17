import type { Job } from 'bullmq';
import { syncSubscriptionsOnStartup, handleLifecycleEvent } from '../../services/subscriptionService.js';
import logger from '../../config/logger.js';

/**
 * BullMQ processor for webhook subscription lifecycle management.
 *
 * Handles two job types:
 * - 'renew-webhooks' (scheduled every 2h): Syncs all mailbox subscriptions,
 *   renewing existing ones and creating new ones as needed.
 * - 'lifecycle-event' (enqueued by webhook handler): Processes lifecycle
 *   notifications from Microsoft Graph (subscriptionRemoved, missed,
 *   reauthorizationRequired).
 */
export async function processWebhookRenewal(job: Job): Promise<void> {
  logger.info('Webhook renewal job started', {
    jobId: job.id,
    jobName: job.name,
  });

  switch (job.name) {
    case 'renew-webhooks': {
      // Periodic renewal -- same logic as startup sync
      await syncSubscriptionsOnStartup();
      break;
    }

    case 'lifecycle-event': {
      const { notification } = job.data as {
        notification: { lifecycleEvent: string; subscriptionId: string };
      };
      await handleLifecycleEvent(notification);
      break;
    }

    default:
      logger.warn('Unknown webhook renewal job type', {
        jobId: job.id,
        jobName: job.name,
      });
  }

  logger.info('Webhook renewal job completed', {
    jobId: job.id,
    jobName: job.name,
  });
}
