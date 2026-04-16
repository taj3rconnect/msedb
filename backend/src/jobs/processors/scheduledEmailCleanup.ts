import type { Job } from 'bullmq';
import { ScheduledEmail } from '../../models/ScheduledEmail.js';
import logger from '../../config/logger.js';

/**
 * BullMQ processor for the scheduled-email-cleanup queue.
 *
 * Runs daily at 3 AM UTC. Handles two categories:
 *
 * 1. Stale pending emails — scheduledAt > 24 hours ago but still "pending".
 *    These were never picked up (server was down, queue stuck, etc.).
 *    Marks them as "failed" with an error message so the user sees them.
 *
 * 2. Orphaned records — sent/cancelled/failed WITHOUT a cleanupAt date.
 *    The TTL index can't auto-remove these. Sets cleanupAt = 30 days from now.
 *
 * The MongoDB TTL index on cleanupAt handles actual document deletion.
 * This job just ensures nothing falls through the cracks.
 */
export async function processScheduledEmailCleanup(job: Job): Promise<void> {
  logger.info('Scheduled email cleanup started', { jobId: job.id });

  const now = new Date();
  const staleThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago
  const cleanupDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

  // 1. Expire stale pending emails
  const staleResult = await ScheduledEmail.updateMany(
    {
      status: 'pending',
      scheduledAt: { $lt: staleThreshold },
    },
    {
      $set: {
        status: 'failed',
        error: 'Expired — scheduled time passed more than 24 hours ago',
        cleanupAt: cleanupDate,
      },
    },
  );

  // 2. Fix orphaned records missing cleanupAt
  const orphanResult = await ScheduledEmail.updateMany(
    {
      status: { $in: ['sent', 'cancelled', 'failed'] },
      cleanupAt: { $exists: false },
    },
    {
      $set: { cleanupAt: cleanupDate },
    },
  );

  logger.info('Scheduled email cleanup completed', {
    jobId: job.id,
    stalePendingExpired: staleResult.modifiedCount,
    orphansFixed: orphanResult.modifiedCount,
  });
}
