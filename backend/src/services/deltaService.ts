import { graphFetch, GraphApiError, GRAPH_BASE } from './graphClient.js';
import { buildSelectParam } from '../utils/graph.js';
import { getRedisClient } from '../config/redis.js';
import { extractMetadata, type GraphMessage } from './metadataExtractor.js';
import { saveEmailEvent } from './eventCollector.js';
import { getFolderName, getTrackedFolderIds, refreshFolderCache } from './folderCache.js';
import { getAccessTokenForMailbox } from '../auth/tokenManager.js';
import { Types } from 'mongoose';
import { Mailbox } from '../models/Mailbox.js';
import { EmailEvent } from '../models/EmailEvent.js';
import type { IEmailEvent } from '../models/EmailEvent.js';
import logger from '../config/logger.js';

/**
 * Delta query execution with pagination and deltaLink storage in Redis.
 *
 * Runs per-folder delta queries to discover new/updated/deleted messages,
 * processes them through the same saveEmailEvent deduplication pipeline
 * as webhook notifications.
 *
 * deltaLinks are stored in Redis with no TTL -- they expire server-side
 * (Graph API returns 410 Gone when the token has expired).
 */

const DELTA_KEY_PREFIX = 'delta';

// --- Internal helpers (not exported) ---

function deltaKey(mailboxId: string, folderId: string): string {
  return `${DELTA_KEY_PREFIX}:${mailboxId}:${folderId}`;
}

async function getDeltaLink(
  mailboxId: string,
  folderId: string,
): Promise<string | null> {
  return getRedisClient().get(deltaKey(mailboxId, folderId));
}

async function setDeltaLink(
  mailboxId: string,
  folderId: string,
  link: string,
): Promise<void> {
  // NO TTL -- deltaLinks expire server-side (410 Gone)
  await getRedisClient().set(deltaKey(mailboxId, folderId), link);
}

async function deleteDeltaLink(
  mailboxId: string,
  folderId: string,
): Promise<void> {
  await getRedisClient().del(deltaKey(mailboxId, folderId));
}

// --- Exported functions ---

export interface DeltaSyncResult {
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
}

interface DeltaQueryResponse {
  value: GraphMessage[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

/**
 * Run a delta query for a single folder in a mailbox.
 *
 * Uses stored deltaLink for incremental sync, or starts a full sync
 * if no deltaLink exists. Handles 410 Gone by deleting the stale
 * deltaLink and restarting with a full sync.
 *
 * All discovered messages are processed through saveEmailEvent for
 * deduplication via the compound unique index. The `skipped` count
 * represents duplicates -- this is EXPECTED and NORMAL since delta
 * sync will frequently see events already captured by webhooks.
 */
export async function runDeltaSync(
  mailboxId: string,
  mailboxEmail: string,
  folderId: string,
  accessToken: string,
  userId: string,
): Promise<DeltaSyncResult> {
  // Get stored deltaLink from Redis
  const storedDeltaLink = await getDeltaLink(mailboxId, folderId);

  // If exists, use it as starting URL; otherwise build initial delta URL
  let url: string = storedDeltaLink
    ? storedDeltaLink
    : `${GRAPH_BASE}/users/${mailboxEmail}/mailFolders/${folderId}/messages/delta?$select=${buildSelectParam('message')}`;

  // Get folder name for storing in EmailEvents
  const folderName = await getFolderName(mailboxEmail, folderId);

  const counters: DeltaSyncResult = { created: 0, updated: 0, deleted: 0, skipped: 0 };

  while (url) {
    let data: DeltaQueryResponse;

    try {
      const response = await graphFetch(url, accessToken);
      data = (await response.json()) as DeltaQueryResponse;
    } catch (err) {
      if (err instanceof GraphApiError && err.status === 410) {
        // Delta token expired -- delete and restart with full sync
        await deleteDeltaLink(mailboxId, folderId);
        logger.warn('Delta token expired, restarting full sync', {
          mailboxId,
          folderId,
        });
        return runDeltaSync(mailboxId, mailboxEmail, folderId, accessToken, userId);
      }
      throw err;
    }

    const messages: GraphMessage[] = data.value ?? [];

    for (const msg of messages) {
      if (msg['@removed']) {
        // Deleted message -- try to copy metadata from prior events
        const priorEvent = await EmailEvent.findOne({ messageId: msg.id })
          .sort({ timestamp: -1 })
          .lean();

        const eventData: Partial<IEmailEvent> = {
          userId: new Types.ObjectId(userId),
          mailboxId: new Types.ObjectId(mailboxId),
          messageId: msg.id,
          eventType: 'deleted',
          timestamp: new Date(),
        } as Partial<IEmailEvent>;

        // Copy metadata from prior event if available
        if (priorEvent) {
          eventData.sender = priorEvent.sender;
          eventData.subject = priorEvent.subject;
          eventData.internetMessageId = priorEvent.internetMessageId;
          eventData.receivedAt = priorEvent.receivedAt;
          eventData.importance = priorEvent.importance;
          eventData.hasAttachments = priorEvent.hasAttachments;
          eventData.conversationId = priorEvent.conversationId;
          eventData.categories = priorEvent.categories;
          eventData.metadata = priorEvent.metadata;
        }

        const saved = await saveEmailEvent(eventData);
        if (saved) {
          counters.deleted++;
        } else {
          counters.skipped++;
        }
      } else {
        // Created or updated -- extract metadata and save
        const metadata = extractMetadata(msg);
        const saved = await saveEmailEvent({
          userId: new Types.ObjectId(userId),
          mailboxId: new Types.ObjectId(mailboxId),
          ...metadata,
          eventType: 'arrived', // Delta sync treats all non-deleted as 'arrived'
          timestamp: metadata.receivedAt ?? new Date(),
          toFolder: folderName,
        } as Partial<IEmailEvent>);

        if (saved) {
          counters.created++;
        } else {
          counters.skipped++;
        }
      }
    }

    // Follow pagination or store deltaLink
    if (data['@odata.nextLink']) {
      url = data['@odata.nextLink'];
    } else if (data['@odata.deltaLink']) {
      await setDeltaLink(mailboxId, folderId, data['@odata.deltaLink']);
      url = '';
    } else {
      url = '';
    }
  }

  return counters;
}

/**
 * Run delta sync for all tracked folders in a mailbox.
 *
 * Finds the mailbox, gets an access token, refreshes the folder cache
 * if stale, then runs delta sync for each well-known folder.
 *
 * Error handling:
 * - Token acquisition failure: log error and skip mailbox
 * - Single folder failure: log and continue to next folder
 */
export async function runDeltaSyncForMailbox(mailboxId: string): Promise<void> {
  // Find the Mailbox document to get email and userId
  const mailbox = await Mailbox.findById(mailboxId);
  if (!mailbox) {
    logger.error('Mailbox not found for delta sync', { mailboxId });
    return;
  }

  const mailboxEmail = mailbox.email;
  const userId = mailbox.userId.toString();

  // Get access token
  let accessToken: string;
  try {
    accessToken = await getAccessTokenForMailbox(mailboxId);
  } catch (err) {
    logger.error('Failed to get access token for delta sync -- token refresh will handle reconnection', {
      mailboxId,
      email: mailboxEmail,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // Refresh folder cache (24h TTL handles staleness automatically)
  try {
    await refreshFolderCache(mailboxEmail, accessToken);
  } catch (err) {
    logger.warn('Failed to refresh folder cache -- using existing cache', {
      mailboxId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Get tracked folder IDs
  let folderIds: string[];
  try {
    folderIds = await getTrackedFolderIds(mailboxEmail, accessToken);
  } catch (err) {
    logger.error('Failed to get tracked folder IDs', {
      mailboxId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // Run delta sync for each folder
  const totals: DeltaSyncResult = { created: 0, updated: 0, deleted: 0, skipped: 0 };
  let foldersSucceeded = 0;
  let foldersFailed = 0;

  for (const folderId of folderIds) {
    try {
      const result = await runDeltaSync(mailboxId, mailboxEmail, folderId, accessToken, userId);
      totals.created += result.created;
      totals.updated += result.updated;
      totals.deleted += result.deleted;
      totals.skipped += result.skipped;
      foldersSucceeded++;
    } catch (err) {
      // Single folder failure -- log and continue
      logger.error('Delta sync failed for folder', {
        mailboxId,
        folderId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      foldersFailed++;
    }
  }

  // Update lastSyncAt
  await Mailbox.findByIdAndUpdate(mailboxId, { lastSyncAt: new Date() });

  logger.info('Delta sync completed for mailbox', {
    mailboxId,
    email: mailboxEmail,
    folders: { succeeded: foldersSucceeded, failed: foldersFailed, total: folderIds.length },
    totals,
  });
}
