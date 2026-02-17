import type { Job } from 'bullmq';
import { Types } from 'mongoose';
import { Mailbox } from '../../models/Mailbox.js';
import { Notification } from '../../models/Notification.js';
import { createMsalClient, GRAPH_SCOPES } from '../../auth/msalClient.js';
import { isInteractionRequired } from '../../auth/tokenManager.js';
import logger from '../../config/logger.js';

/**
 * Mark a mailbox as disconnected and create a high-priority notification
 * prompting the user to reconnect.
 */
async function markMailboxDisconnected(
  mailboxId: Types.ObjectId,
  reason: string,
): Promise<void> {
  await Mailbox.findByIdAndUpdate(mailboxId, { isConnected: false });

  const mailbox = await Mailbox.findById(mailboxId).select('userId email');
  if (mailbox) {
    await Notification.create({
      userId: mailbox.userId,
      type: 'token_expiring',
      title: 'Mailbox disconnected',
      message: `Your mailbox ${mailbox.email} needs to be reconnected. Reason: ${reason}`,
      priority: 'high',
    });
  }

  logger.warn('Mailbox marked disconnected', {
    mailboxId: mailboxId.toString(),
    reason,
  });
}

/**
 * BullMQ processor that refreshes MSAL tokens for all connected mailboxes.
 *
 * Queries ALL connected mailboxes (no expiry filter). MSAL's acquireTokenSilent()
 * returns cached tokens immediately when still valid, so there is no performance
 * penalty for checking all mailboxes. This avoids the risk of a delayed job cycle
 * missing a narrow expiry window.
 *
 * When a refresh token has expired (interaction_required), the mailbox is marked
 * disconnected and a high-priority notification is created for the user.
 */
export async function processTokenRefresh(job: Job): Promise<void> {
  logger.info('Token refresh job started', { jobId: job.id });

  const mailboxes = await Mailbox.find({ isConnected: true });

  let refreshed = 0;
  let failed = 0;

  for (const mailbox of mailboxes) {
    try {
      const msalClient = createMsalClient(mailbox._id.toString());
      const tokenCache = msalClient.getTokenCache();
      const account = await tokenCache.getAccountByHomeId(
        mailbox.homeAccountId ?? '',
      );

      if (!account) {
        await markMailboxDisconnected(
          mailbox._id as Types.ObjectId,
          'Account not found in MSAL cache',
        );
        failed++;
        continue;
      }

      // Filter out offline_access as it is not a resource scope
      const scopes = GRAPH_SCOPES.filter((s) => s !== 'offline_access');

      const result = await msalClient.acquireTokenSilent({
        account,
        scopes,
      });

      await Mailbox.findByIdAndUpdate(mailbox._id, {
        'encryptedTokens.expiresAt': result.expiresOn,
      });

      refreshed++;
    } catch (err) {
      if (isInteractionRequired(err)) {
        await markMailboxDisconnected(
          mailbox._id as Types.ObjectId,
          'Refresh token expired -- user must re-authenticate',
        );
        failed++;
      } else {
        // Transient error -- will retry next cycle
        logger.error('Token refresh failed for mailbox', {
          mailboxId: mailbox._id.toString(),
          email: mailbox.email,
          error: err instanceof Error ? err.message : String(err),
        });
        failed++;
      }
    }
  }

  logger.info('Token refresh job completed', {
    jobId: job.id,
    refreshed,
    failed,
    total: mailboxes.length,
  });
}
