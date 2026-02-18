import type { Job } from 'bullmq';
import { StagedEmail } from '../../models/StagedEmail.js';
import { Mailbox } from '../../models/Mailbox.js';
import { AuditLog } from '../../models/AuditLog.js';
import { getAccessTokenForMailbox } from '../../auth/tokenManager.js';
import { graphFetch, GraphApiError } from '../../services/graphClient.js';
import logger from '../../config/logger.js';

/**
 * BullMQ processor for the staging-processor queue.
 *
 * Runs every 30 minutes (via the scheduler). Finds staged emails whose grace
 * period has expired and executes their pending actions via Graph API.
 *
 * SAFETY:
 * - Handles 404 gracefully (message already deleted or rescued by user)
 * - Handles 429 (rate limit) by skipping the item for the next run
 * - Processes items in batches of 5 for concurrency control
 * - Uses soft-delete only (move to deleteditems, never permanentDelete)
 */
export async function processStagingItems(job: Job): Promise<void> {
  logger.info('Staging processor started', { jobId: job.id });

  // Find expired staged items (grace period has passed)
  const expiredItems = await StagedEmail.find({
    status: 'staged',
    expiresAt: { $lte: new Date() },
  }).limit(100);

  if (expiredItems.length === 0) {
    logger.debug('No expired staged items to process', { jobId: job.id });
    return;
  }

  let successes = 0;
  let failures = 0;
  let skipped = 0;

  // Process in chunks of 5 for concurrency control
  const chunkSize = 5;
  for (let i = 0; i < expiredItems.length; i += chunkSize) {
    const chunk = expiredItems.slice(i, i + chunkSize);

    const results = await Promise.allSettled(
      chunk.map((item) => processOneItem(item)),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        switch (result.value) {
          case 'success':
            successes++;
            break;
          case 'skipped':
            skipped++;
            break;
          case 'expired':
            successes++; // Count as handled successfully
            break;
        }
      } else {
        failures++;
      }
    }
  }

  logger.info('Staging processor completed', {
    jobId: job.id,
    total: expiredItems.length,
    successes,
    failures,
    skipped,
  });
}

/**
 * Process a single expired staged item.
 *
 * @returns 'success' if the action was executed,
 *          'expired' if the message was not found (404),
 *          'skipped' if rate-limited (429) or other recoverable error
 */
async function processOneItem(
  item: InstanceType<typeof StagedEmail>,
): Promise<'success' | 'expired' | 'skipped'> {
  try {
    // Get access token for the mailbox
    const accessToken = await getAccessTokenForMailbox(item.mailboxId.toString());

    // Get mailbox email for Graph API calls
    const mailbox = await Mailbox.findById(item.mailboxId).select('email');
    if (!mailbox) {
      logger.warn('Mailbox not found for staged item', {
        stagedEmailId: item._id.toString(),
        mailboxId: item.mailboxId.toString(),
      });
      return 'skipped';
    }

    const userPath = `/users/${encodeURIComponent(mailbox.email)}`;

    // Execute each staged action
    for (const action of item.actions) {
      switch (action.actionType) {
        case 'delete': {
          // Soft-delete: move from staging folder to Deleted Items
          await graphFetch(
            `${userPath}/messages/${item.messageId}/move`,
            accessToken,
            {
              method: 'POST',
              body: JSON.stringify({ destinationId: 'deleteditems' }),
            },
          );
          break;
        }

        case 'move': {
          if (action.toFolder) {
            await graphFetch(
              `${userPath}/messages/${item.messageId}/move`,
              accessToken,
              {
                method: 'POST',
                body: JSON.stringify({ destinationId: action.toFolder }),
              },
            );
          }
          break;
        }

        case 'markRead': {
          await graphFetch(
            `${userPath}/messages/${item.messageId}`,
            accessToken,
            {
              method: 'PATCH',
              body: JSON.stringify({ isRead: true }),
            },
          );
          break;
        }

        default:
          logger.warn('Unknown staged action type', {
            actionType: action.actionType,
            stagedEmailId: item._id.toString(),
          });
      }
    }

    // Success: update status to executed
    item.status = 'executed';
    item.executedAt = new Date();
    await item.save();

    // Create audit log entry
    await AuditLog.create({
      userId: item.userId,
      mailboxId: item.mailboxId,
      action: 'email_executed',
      targetType: 'email',
      targetId: item.messageId,
      details: {
        ruleId: item.ruleId.toString(),
        actions: item.actions.map((a) => a.actionType),
        messageId: item.messageId,
        originalFolder: item.originalFolder,
      },
      undoable: true,
    });

    logger.info('Staged item executed', {
      stagedEmailId: item._id.toString(),
      messageId: item.messageId,
      actions: item.actions.map((a) => a.actionType),
    });

    return 'success';
  } catch (error) {
    // Handle 404: message was manually deleted or rescued
    if (error instanceof GraphApiError && error.status === 404) {
      logger.warn('Staged message not found (may have been manually deleted or rescued)', {
        stagedEmailId: item._id.toString(),
        messageId: item.messageId,
      });
      item.status = 'expired';
      await item.save();
      return 'expired';
    }

    // Handle 429: rate limited -- skip for next run
    if (error instanceof GraphApiError && error.status === 429) {
      logger.warn('Rate limited during staging execution -- will retry next run', {
        stagedEmailId: item._id.toString(),
        messageId: item.messageId,
      });
      return 'skipped';
    }

    // Other errors: log and leave as 'staged' for retry on next run
    logger.error('Failed to execute staged item', {
      stagedEmailId: item._id.toString(),
      messageId: item.messageId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'skipped';
  }
}
