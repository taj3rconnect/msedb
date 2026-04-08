import type { Job } from 'bullmq';
import { syncEventCreate, syncEventUpdate, syncEventDelete, runCalendarDeltaSyncForMailbox } from '../../services/calendarSyncService.js';
import { Mailbox } from '../../models/Mailbox.js';
import logger from '../../config/logger.js';

/**
 * BullMQ processor for the calendar-sync queue.
 *
 * Job types:
 * - 'calendar-change': Triggered by Graph webhook for a calendar event change.
 *   Routes to create/update/delete based on changeType.
 * - 'calendar-delta-sync': Scheduled fallback that polls all mailboxes for changes.
 * - 'lifecycle-calendar-delta': On-demand delta sync for a specific mailbox.
 */
export async function processCalendarSync(job: Job): Promise<void> {
  logger.info('Calendar sync job started', { jobId: job.id, jobName: job.name });

  switch (job.name) {
    case 'calendar-change': {
      const { sourceMailboxId, eventId, changeType } = job.data as {
        sourceMailboxId: string;
        eventId: string;
        changeType: string;
      };

      if (changeType === 'created') {
        await syncEventCreate(sourceMailboxId, eventId);
      } else if (changeType === 'updated') {
        await syncEventUpdate(sourceMailboxId, eventId);
      } else if (changeType === 'deleted') {
        await syncEventDelete(sourceMailboxId, eventId);
      } else {
        logger.warn('Unknown calendar changeType', { changeType, eventId });
      }
      break;
    }

    case 'calendar-delta-sync': {
      // Scheduled sync: iterate all connected mailboxes
      const mailboxes = await Mailbox.find({ isConnected: true }).select('_id email');
      let synced = 0;
      let failed = 0;

      for (const mailbox of mailboxes) {
        try {
          await runCalendarDeltaSyncForMailbox(mailbox._id.toString());
          synced++;
        } catch (err) {
          failed++;
          logger.error('Calendar delta sync failed for mailbox', {
            mailboxId: mailbox._id.toString(),
            email: mailbox.email,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      logger.info('Calendar delta sync completed', {
        jobId: job.id,
        synced,
        failed,
        total: mailboxes.length,
      });
      break;
    }

    case 'lifecycle-calendar-delta': {
      const { mailboxId } = job.data as { mailboxId: string };
      await runCalendarDeltaSyncForMailbox(mailboxId);
      break;
    }

    default:
      logger.warn('Unknown calendar sync job type', { jobId: job.id, jobName: job.name });
  }

  logger.info('Calendar sync job completed', { jobId: job.id, jobName: job.name });
}
