import type { Job } from 'bullmq';
import { runDeltaSyncForMailbox } from '../../services/deltaService.js';
import { Mailbox } from '../../models/Mailbox.js';
import logger from '../../config/logger.js';

/**
 * BullMQ processor for the delta-sync queue.
 *
 * Handles two job types:
 * - 'run-delta-sync' (scheduled every 15 minutes): runs delta sync for ALL connected mailboxes
 * - 'lifecycle-delta-sync' (triggered by lifecycle events): runs delta sync for a specific mailbox
 */
export async function processDeltaSync(job: Job): Promise<void> {
  logger.info('Delta sync job started', { jobId: job.id, jobName: job.name });

  switch (job.name) {
    case 'run-delta-sync': {
      // Scheduled sync: iterate all connected mailboxes
      const mailboxes = await Mailbox.find({ isConnected: true });

      let synced = 0;
      let failed = 0;

      for (const mailbox of mailboxes) {
        try {
          await runDeltaSyncForMailbox(mailbox._id.toString());
          synced++;
        } catch (err) {
          logger.error('Delta sync failed for mailbox', {
            mailboxId: mailbox._id.toString(),
            email: mailbox.email,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
          failed++;
        }
      }

      logger.info('Scheduled delta sync completed', {
        jobId: job.id,
        synced,
        failed,
        total: mailboxes.length,
      });
      break;
    }

    case 'lifecycle-delta-sync': {
      // On-demand sync for a specific mailbox (triggered by lifecycle events)
      const { mailboxId } = job.data as { mailboxId: string };

      await runDeltaSyncForMailbox(mailboxId);

      logger.info('Lifecycle delta sync completed', {
        jobId: job.id,
        mailboxId,
      });
      break;
    }

    default:
      logger.warn('Unknown delta sync job name -- skipping', {
        jobId: job.id,
        jobName: job.name,
      });
  }
}
