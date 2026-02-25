import { User } from '../models/User.js';
import { Mailbox } from '../models/Mailbox.js';
import { getRedisClient } from '../config/redis.js';
import { syncContactsForMailbox } from '../jobs/processors/contactsSync.js';
import logger from '../config/logger.js';

/**
 * Pre-warm contacts cache on startup.
 *
 * Checks each user's configured contacts mailbox. If the Redis cache is empty,
 * fetches all contacts from Graph API and populates the cache so the first
 * page load is instant.
 */
export async function warmContactsCache(): Promise<void> {
  const redis = getRedisClient();

  // Find all users who have a contacts mailbox configured
  const users = await User.find({
    'preferences.contactsMailboxId': { $exists: true, $ne: null },
  }).select('preferences.contactsMailboxId').lean();

  if (users.length === 0) {
    logger.info('No users with contacts configured — skipping cache warm-up');
    return;
  }

  // Dedupe mailbox IDs (multiple users could share the same mailbox)
  const mailboxIds = [...new Set(users.map((u) => u.preferences?.contactsMailboxId).filter(Boolean))] as string[];

  for (const mailboxId of mailboxIds) {
    // Skip if cache already exists
    const cached = await redis.get(`contacts:${mailboxId}:all`);
    if (cached) {
      logger.info('Contacts cache already warm', { mailboxId });
      continue;
    }

    // Fetch mailbox email for Graph API
    const mailbox = await Mailbox.findById(mailboxId).select('email isConnected').lean();
    if (!mailbox || !mailbox.isConnected) continue;

    try {
      const count = await syncContactsForMailbox(mailboxId, mailbox.email);
      logger.info('Contacts cache warmed on startup', {
        mailboxId,
        email: mailbox.email,
        contactCount: count,
      });
    } catch (err) {
      logger.warn('Failed to warm contacts cache for mailbox', {
        mailboxId,
        email: mailbox.email,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
