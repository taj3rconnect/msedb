import type { Job } from 'bullmq';
import { EmailEvent, type IEmailEvent } from '../../models/EmailEvent.js';
import { Mailbox } from '../../models/Mailbox.js';
import { queues } from '../queues.js';
import { getRedisClient } from '../../config/redis.js';
import logger from '../../config/logger.js';

const BATCH_SIZE = 500;
const CUTOFF_REDIS_KEY = 'embedding-reconcile:cutoff';

type MissingEvent = Pick<
  IEmailEvent,
  'userId' | 'mailboxId' | 'messageId' | 'sender' | 'subject' | 'receivedAt' |
  'toFolder' | 'importance' | 'hasAttachments' | 'categories' | 'isRead' | 'timestamp'
>;

/**
 * Pure mapping from a lean EmailEvent + its mailbox's address to the
 * email-embedding job payload (same shape deltaService/eventCollector enqueue).
 * Exported for unit testing without touching Mongo/Redis/BullMQ.
 */
export function toEmbedJobData(event: MissingEvent, mailboxEmail: string) {
  return {
    userId: String(event.userId),
    mailboxId: String(event.mailboxId),
    mailboxEmail,
    messageId: event.messageId,
    senderEmail: event.sender?.email || '',
    senderName: event.sender?.name || '',
    subject: event.subject || '',
    receivedAt: event.receivedAt?.toISOString() || event.timestamp?.toISOString() || new Date().toISOString(),
    folder: event.toFolder || '',
    importance: event.importance || 'normal',
    hasAttachments: event.hasAttachments || false,
    categories: event.categories || [],
    isRead: event.isRead || false,
  };
}

/**
 * First-ever run of this job records "now" as the reconciliation cutoff.
 * EmailEvents older than the cutoff predate the `embeddedAt` marker field,
 * so a missing field there is unknowable (may already be embedded — it just
 * predates the field that would say so) rather than a confirmed gap.
 * ponytail: cutoff stored as one Redis key (SET NX), reusing the Redis client
 * embeddingService already depends on instead of a new Mongo singleton doc.
 */
async function getOrInitCutoff(): Promise<Date> {
  const redis = getRedisClient();
  const now = new Date().toISOString();
  const set = await redis.set(CUTOFF_REDIS_KEY, now, 'NX');
  if (set === 'OK') return new Date(now);
  const existing = await redis.get(CUTOFF_REDIS_KEY);
  return existing ? new Date(existing) : new Date(now);
}

/**
 * Hourly reconciliation for the `embedding-reconcile` queue.
 *
 * Finds 'arrived' EmailEvents (not deleted, at/after the cutoff) with no
 * `embeddedAt` and re-enqueues them on the email-embedding queue, bounded to
 * BATCH_SIZE per run so a long Qdrant/Ollama outage backfills gradually
 * instead of stampeding Ollama in one burst.
 */
export async function processEmbeddingReconcile(job: Job): Promise<void> {
  const cutoff = await getOrInitCutoff();

  const missing = await EmailEvent.find({
    eventType: 'arrived',
    isDeleted: false,
    embeddedAt: { $exists: false },
    timestamp: { $gte: cutoff },
  })
    .sort({ timestamp: 1 })
    .limit(BATCH_SIZE)
    .select('userId mailboxId messageId sender subject receivedAt toFolder importance hasAttachments categories isRead timestamp')
    .lean();

  if (missing.length === 0) {
    logger.debug('Embedding reconcile: no missing embeddings', { jobId: job.id, cutoff });
    return;
  }

  // Batch-load mailbox addresses once instead of per event.
  const mailboxIds = [...new Set(missing.map((e) => String(e.mailboxId)))];
  const mailboxes = await Mailbox.find({ _id: { $in: mailboxIds } }).select('email').lean();
  const mailboxEmailById = new Map(mailboxes.map((m) => [String(m._id), m.email]));

  let enqueued = 0;
  let skippedNoMailbox = 0;
  for (const event of missing) {
    const mailboxEmail = mailboxEmailById.get(String(event.mailboxId));
    if (!mailboxEmail) {
      skippedNoMailbox++; // mailbox disconnected/removed since the event was recorded
      continue;
    }
    await queues['email-embedding'].add('embed-email', toEmbedJobData(event as MissingEvent, mailboxEmail));
    enqueued++;
  }

  logger.info('Embedding reconcile completed', {
    jobId: job.id,
    found: missing.length,
    enqueued,
    skippedNoMailbox,
  });
}
