import { Types } from 'mongoose';
import type { Job } from 'bullmq';
import { analyzeMailboxPatterns } from '../../services/patternEngine.js';
import { Mailbox } from '../../models/Mailbox.js';
import logger from '../../config/logger.js';

/**
 * BullMQ processor for the pattern-analysis queue.
 *
 * Handles two job types:
 * - 'run-pattern-analysis' (scheduled daily at 2 AM): runs analysis for ALL connected mailboxes
 * - 'on-demand-analysis' (triggered via API): runs analysis for a specific user/mailbox
 */
export async function processPatternAnalysis(job: Job): Promise<void> {
  logger.info('Pattern analysis job started', { jobId: job.id, jobName: job.name });

  switch (job.name) {
    case 'run-pattern-analysis': {
      // Scheduled analysis: iterate all connected mailboxes
      const mailboxes = await Mailbox.find({ isConnected: true });

      let analyzed = 0;
      let failed = 0;

      for (const mailbox of mailboxes) {
        try {
          await analyzeMailboxPatterns(mailbox.userId as Types.ObjectId, mailbox._id as Types.ObjectId);
          analyzed++;
          logger.debug('Pattern analysis completed for mailbox', {
            jobId: job.id,
            mailboxId: mailbox._id.toString(),
            progress: `${analyzed + failed}/${mailboxes.length}`,
          });
        } catch (err) {
          logger.error('Pattern analysis failed for mailbox', {
            mailboxId: mailbox._id.toString(),
            email: mailbox.email,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
          failed++;
        }
      }

      logger.info('Scheduled pattern analysis completed', {
        jobId: job.id,
        analyzed,
        failed,
        total: mailboxes.length,
      });
      break;
    }

    case 'on-demand-analysis': {
      // On-demand analysis for a specific user/mailbox
      const { userId, mailboxId } = job.data as { userId: string; mailboxId?: string };

      if (mailboxId) {
        // Analyze a single mailbox
        await analyzeMailboxPatterns(
          new Types.ObjectId(userId),
          new Types.ObjectId(mailboxId),
        );

        logger.info('On-demand pattern analysis completed for mailbox', {
          jobId: job.id,
          userId,
          mailboxId,
        });
      } else {
        // Analyze all connected mailboxes for this user
        const mailboxes = await Mailbox.find({ userId: new Types.ObjectId(userId), isConnected: true });

        let analyzed = 0;
        let failed = 0;

        for (const mailbox of mailboxes) {
          try {
            await analyzeMailboxPatterns(mailbox.userId as Types.ObjectId, mailbox._id as Types.ObjectId);
            analyzed++;
          } catch (err) {
            logger.error('On-demand pattern analysis failed for mailbox', {
              mailboxId: mailbox._id.toString(),
              error: err instanceof Error ? err.message : String(err),
            });
            failed++;
          }
        }

        logger.info('On-demand pattern analysis completed for user', {
          jobId: job.id,
          userId,
          analyzed,
          failed,
          total: mailboxes.length,
        });
      }
      break;
    }

    default:
      logger.warn('Unknown pattern analysis job name -- skipping', {
        jobId: job.id,
        jobName: job.name,
      });
  }
}
