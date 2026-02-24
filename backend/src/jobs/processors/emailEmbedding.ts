import type { Job } from 'bullmq';
import { embedEmail, backfillMailboxEmbeddings } from '../../services/embeddingService.js';
import logger from '../../config/logger.js';

/**
 * Process email embedding jobs.
 *
 * Job types:
 * - embed-email: Embed a single email (fired from deltaService/eventCollector)
 * - backfill-embeddings: Embed all emails for a mailbox
 */
export async function processEmailEmbedding(job: Job): Promise<void> {
  switch (job.name) {
    case 'embed-email': {
      const { userId, mailboxId, mailboxEmail, messageId, senderEmail, senderName, subject, receivedAt, folder, importance, hasAttachments, categories, isRead } = job.data;
      try {
        const embedded = await embedEmail({
          userId,
          mailboxId,
          mailboxEmail,
          messageId,
          senderEmail: senderEmail || '',
          senderName: senderName || '',
          subject: subject || '',
          receivedAt: receivedAt || new Date().toISOString(),
          folder: folder || '',
          importance: importance || 'normal',
          hasAttachments: hasAttachments || false,
          categories: categories || [],
          isRead: isRead || false,
        });
        if (embedded) {
          logger.debug('Email embedded successfully', { messageId });
        }
      } catch (err) {
        logger.warn('Email embedding failed', {
          messageId,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err; // Let BullMQ retry
      }
      break;
    }

    case 'backfill-embeddings': {
      const { mailboxId, userId } = job.data;
      const result = await backfillMailboxEmbeddings(mailboxId, userId);
      logger.info('Backfill embeddings completed', {
        mailboxId,
        ...result,
      });
      break;
    }

    default:
      logger.warn('Unknown email-embedding job name', { jobName: job.name });
  }
}
