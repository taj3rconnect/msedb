import type { Job } from 'bullmq';
import { Mailbox } from '../../models/Mailbox.js';
import { getAccessTokenForMailbox } from '../../auth/tokenManager.js';
import { graphFetch } from '../../services/graphClient.js';
import { getRedisClient } from '../../config/redis.js';
import logger from '../../config/logger.js';

const CONTACTS_CACHE_TTL = 86400; // 24 hours
const CONTACTS_SELECT = 'id,displayName,emailAddresses,companyName,department,jobTitle,businessPhones,mobilePhone';

/**
 * Fetch ALL contacts from a mailbox's default Contacts folder via Graph API,
 * paginating through @odata.nextLink, and cache them in Redis.
 */
async function syncContactsForMailbox(mailboxId: string, email: string): Promise<number> {
  const accessToken = await getAccessTokenForMailbox(mailboxId);
  const redis = getRedisClient();

  interface RawContact {
    id: string;
    displayName?: string;
    emailAddresses?: Array<{ name?: string; address?: string }>;
    companyName?: string;
    department?: string;
    jobTitle?: string;
    businessPhones?: string[];
    mobilePhone?: string;
  }

  const allContacts: RawContact[] = [];
  let url: string | undefined =
    `/users/${email}/contacts?$select=${CONTACTS_SELECT}&$top=100&$orderby=displayName`;

  while (url) {
    const response = await graphFetch(url, accessToken, {
      headers: { ConsistencyLevel: 'eventual' },
    });
    const data = (await response.json()) as {
      value: RawContact[];
      '@odata.nextLink'?: string;
    };
    allContacts.push(...(data.value || []));
    url = data['@odata.nextLink'];
  }

  // Normalize and store in Redis
  const contacts = allContacts.map((c) => ({
    id: c.id,
    displayName: c.displayName || '',
    emailAddresses: c.emailAddresses || [],
    companyName: c.companyName || '',
    department: c.department || '',
    jobTitle: c.jobTitle || '',
    businessPhones: c.businessPhones || [],
    mobilePhone: c.mobilePhone || '',
  }));

  const cacheKey = `contacts:${mailboxId}:all`;
  await redis.set(cacheKey, JSON.stringify(contacts), 'EX', CONTACTS_CACHE_TTL);

  // Store metadata
  await redis.set(
    `contacts:${mailboxId}:meta`,
    JSON.stringify({ count: contacts.length, syncedAt: new Date().toISOString() }),
    'EX', CONTACTS_CACHE_TTL,
  );

  return contacts.length;
}

/**
 * BullMQ processor for nightly contacts sync.
 *
 * Iterates all connected mailboxes, fetches ALL contacts from each via Graph API,
 * and caches them in Redis. This provides a fast local index for the frontend
 * contacts search (MiniSearch).
 */
export async function processContactsSync(job: Job): Promise<void> {
  logger.info('Contacts sync job started', { jobId: job.id, jobName: job.name });

  const mailboxes = await Mailbox.find({ isConnected: true }).select('email');

  let synced = 0;
  let failed = 0;

  for (const mailbox of mailboxes) {
    try {
      const count = await syncContactsForMailbox(
        mailbox._id.toString(),
        mailbox.email,
      );
      synced++;
      logger.info('Contacts synced for mailbox', {
        mailboxId: mailbox._id.toString(),
        email: mailbox.email,
        contactCount: count,
      });
    } catch (err) {
      failed++;
      logger.error('Contacts sync failed for mailbox', {
        mailboxId: mailbox._id.toString(),
        email: mailbox.email,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('Contacts sync job completed', {
    jobId: job.id,
    synced,
    failed,
    total: mailboxes.length,
  });
}
