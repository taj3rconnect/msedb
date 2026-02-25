import type { Job } from 'bullmq';
import { ScheduledEmail } from '../../models/ScheduledEmail.js';
import { getAccessTokenForMailbox } from '../../auth/tokenManager.js';
import { graphFetch, GraphApiError } from '../../services/graphClient.js';
import logger from '../../config/logger.js';

/**
 * BullMQ processor for the scheduled-email queue.
 *
 * Runs every 1 minute (via the scheduler). Finds pending scheduled emails
 * whose scheduledAt has passed and sends them via Graph API.
 */
export async function processScheduledEmail(job: Job): Promise<void> {
  logger.info('Scheduled email processor started', { jobId: job.id });

  const now = new Date();
  const dueItems = await ScheduledEmail.find({
    status: 'pending',
    scheduledAt: { $lte: now },
  }).limit(10);

  if (dueItems.length === 0) {
    logger.debug('No scheduled emails due for sending', { jobId: job.id });
    return;
  }

  let sent = 0;
  let failures = 0;

  // Process in chunks of 5 for concurrency control
  const chunkSize = 5;
  for (let i = 0; i < dueItems.length; i += chunkSize) {
    const chunk = dueItems.slice(i, i + chunkSize);

    const results = await Promise.allSettled(
      chunk.map((item) => sendOneEmail(item)),
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value === 'sent') {
        sent++;
      } else {
        failures++;
      }
    }
  }

  logger.info('Scheduled email processor completed', {
    jobId: job.id,
    total: dueItems.length,
    sent,
    failures,
  });
}

async function sendOneEmail(
  item: InstanceType<typeof ScheduledEmail>,
): Promise<'sent' | 'skipped'> {
  try {
    const accessToken = await getAccessTokenForMailbox(item.mailboxId.toString());

    const message: Record<string, unknown> = {
      subject: item.subject,
      body: { contentType: item.contentType, content: item.body },
      toRecipients: item.to.map((email) => ({
        emailAddress: { address: email },
      })),
    };

    if (item.cc && item.cc.length > 0) {
      message.ccRecipients = item.cc.map((email) => ({
        emailAddress: { address: email },
      }));
    }
    if (item.bcc && item.bcc.length > 0) {
      message.bccRecipients = item.bcc.map((email) => ({
        emailAddress: { address: email },
      }));
    }

    await graphFetch(
      `/users/${encodeURIComponent(item.mailboxEmail)}/sendMail`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({ message, saveToSentItems: 'true' }),
      },
    );

    item.status = 'sent';
    item.sentAt = new Date();
    item.cleanupAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    await item.save();

    logger.info('Scheduled email sent', {
      scheduledEmailId: item._id?.toString(),
      to: item.to,
      subject: item.subject,
    });

    return 'sent';
  } catch (error) {
    // Rate limited — skip for next run
    if (error instanceof GraphApiError && error.status === 429) {
      logger.warn('Rate limited sending scheduled email -- will retry next run', {
        scheduledEmailId: item._id?.toString(),
      });
      return 'skipped';
    }

    // Other errors: mark as failed
    item.status = 'failed';
    item.error = error instanceof Error ? error.message : String(error);
    item.cleanupAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await item.save();

    logger.error('Failed to send scheduled email', {
      scheduledEmailId: item._id?.toString(),
      error: error instanceof Error ? error.message : String(error),
    });

    return 'skipped';
  }
}
