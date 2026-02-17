import { getRedisClient } from '../config/redis.js';
import { graphFetch, GraphApiError } from './graphClient.js';
import { buildSelectParam } from '../utils/graph.js';
import logger from '../config/logger.js';

/**
 * Folder ID-to-name cache in Redis.
 *
 * Caches folder ID-to-displayName mappings so EmailEvents can store
 * human-readable folder names alongside opaque Graph folder IDs.
 * Well-known folder discovery uses Graph API's well-known folder aliases
 * for reliable resolution.
 */

const FOLDER_CACHE_PREFIX = 'folder';
const FOLDER_CACHE_TTL = 24 * 60 * 60; // 24 hours -- folders change rarely

export const WELL_KNOWN_FOLDERS = [
  'Inbox',
  'SentItems',
  'DeletedItems',
  'Archive',
  'Drafts',
  'JunkEmail',
] as const;

export type WellKnownFolder = (typeof WELL_KNOWN_FOLDERS)[number];

interface GraphMailFolder {
  id: string;
  displayName: string;
}

interface GraphMailFolderListResponse {
  value: GraphMailFolder[];
  '@odata.nextLink'?: string;
}

/**
 * Refresh the folder cache for a mailbox by fetching all mail folders
 * from Graph API and storing ID-to-displayName mappings in Redis.
 *
 * Follows @odata.nextLink for pagination (mailboxes can have 100+ folders).
 *
 * @returns Map of folderId -> displayName
 */
export async function refreshFolderCache(
  mailboxEmail: string,
  accessToken: string,
): Promise<Map<string, string>> {
  const redis = getRedisClient();
  const folderMap = new Map<string, string>();

  const selectParam = buildSelectParam('mailFolder');
  let url: string | undefined =
    `/users/${mailboxEmail}/mailFolders?$select=${selectParam}&$top=100`;

  while (url) {
    const response = await graphFetch(url, accessToken);
    const data = (await response.json()) as GraphMailFolderListResponse;

    for (const folder of data.value) {
      folderMap.set(folder.id, folder.displayName);
    }

    url = data['@odata.nextLink'];
  }

  // Store each mapping in Redis with 24h TTL
  const pipeline = redis.pipeline();
  const folderIds: string[] = [];

  for (const [folderId, displayName] of folderMap) {
    const key = `${FOLDER_CACHE_PREFIX}:${mailboxEmail}:${folderId}`;
    pipeline.set(key, displayName, 'EX', FOLDER_CACHE_TTL);
    folderIds.push(folderId);
  }

  // Store the complete folder ID list
  const allKey = `${FOLDER_CACHE_PREFIX}:${mailboxEmail}:all`;
  pipeline.set(allKey, JSON.stringify(folderIds), 'EX', FOLDER_CACHE_TTL);

  await pipeline.exec();

  logger.info('Refreshed folder cache', {
    mailboxEmail,
    count: folderMap.size,
  });

  return folderMap;
}

/**
 * Get the display name for a folder ID from Redis cache.
 *
 * @returns The display name if cached, or the raw folderId if not found
 *          (stale cache or new folder -- next refresh will pick it up).
 */
export async function getFolderName(
  mailboxEmail: string,
  folderId: string,
): Promise<string> {
  const redis = getRedisClient();
  const key = `${FOLDER_CACHE_PREFIX}:${mailboxEmail}:${folderId}`;
  const name = await redis.get(key);
  return name ?? folderId;
}

/**
 * Get the folder IDs for well-known folders (Inbox, SentItems, etc.)
 * that should be tracked for delta sync.
 *
 * Uses Graph API's well-known folder aliases for reliable resolution.
 * Some folders may not exist (e.g. Archive might not be enabled) -- those
 * are skipped gracefully.
 *
 * @returns Array of folder IDs for the well-known folders that exist
 */
export async function getTrackedFolderIds(
  mailboxEmail: string,
  accessToken: string,
): Promise<string[]> {
  const redis = getRedisClient();
  const folderIds: string[] = [];

  // Use Graph API well-known folder aliases for reliable resolution
  for (const wellKnownName of WELL_KNOWN_FOLDERS) {
    // Check cache first
    const cacheKey = `${FOLDER_CACHE_PREFIX}:${mailboxEmail}:wk:${wellKnownName}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      folderIds.push(cached);
      continue;
    }

    // Fetch from Graph API using well-known folder alias
    try {
      const response = await graphFetch(
        `/users/${mailboxEmail}/mailFolders/${wellKnownName}?$select=id,displayName`,
        accessToken,
      );
      const folder = (await response.json()) as GraphMailFolder;

      // Cache the well-known folder ID mapping
      const pipeline = redis.pipeline();
      pipeline.set(cacheKey, folder.id, 'EX', FOLDER_CACHE_TTL);
      pipeline.set(
        `${FOLDER_CACHE_PREFIX}:${mailboxEmail}:${folder.id}`,
        folder.displayName,
        'EX',
        FOLDER_CACHE_TTL,
      );
      await pipeline.exec();

      folderIds.push(folder.id);
    } catch (err) {
      if (err instanceof GraphApiError && err.status === 404) {
        // Folder doesn't exist (e.g. Archive not enabled) -- skip
        logger.debug('Well-known folder not found -- skipping', {
          mailboxEmail,
          wellKnownName,
        });
        continue;
      }
      throw err;
    }
  }

  return folderIds;
}
