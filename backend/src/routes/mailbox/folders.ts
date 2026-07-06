import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { Mailbox } from '../../models/Mailbox.js';
import { EmailEvent } from '../../models/EmailEvent.js';
import { getAccessTokenForMailbox } from '../../auth/tokenManager.js';
import { refreshFolderCache } from '../../services/folderCache.js';
import { getRedisClient } from '../../config/redis.js';
import { runDeltaSync, type DeltaSyncResult } from '../../services/deltaService.js';
import { graphFetch } from '../../services/graphClient.js';
import { buildSelectParam } from '../../utils/graph.js';
import { NotFoundError, ValidationError } from '../../middleware/errorHandler.js';

const foldersRouter = Router();

/** Folders to hide from the folder browser (not useful for mail management). */
const HIDDEN_FOLDERS = new Set([
  'Outbox',
  'Sync Issues',
  'Conversation History',
  'RSS Feeds',
]);

// ---- Per-mailbox folder listing ----

/**
 * GET /api/mailboxes/:id/folders
 *
 * Returns the mail folders for a mailbox (fetched from Graph API via cache).
 */
foldersRouter.get('/:id/folders', async (req: Request, res: Response) => {
  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: req.user!.userId,
  });

  if (!mailbox) {
    throw new NotFoundError('Mailbox not found');
  }

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());

  // Fetch folders with counts directly from Graph API
  const selectParam = buildSelectParam('mailFolder');
  let url: string | undefined =
    `/users/${mailbox.email}/mailFolders?$select=${selectParam}&$top=100`;

  interface FolderResult {
    id: string;
    displayName: string;
    totalItemCount: number;
    unreadItemCount: number;
    childFolderCount: number;
  }
  const folders: FolderResult[] = [];

  while (url) {
    const response = await graphFetch(url, accessToken);
    const data = (await response.json()) as {
      value: { id: string; displayName: string; totalItemCount?: number; unreadItemCount?: number; childFolderCount?: number }[];
      '@odata.nextLink'?: string;
    };

    for (const folder of data.value) {
      // Skip non-useful system folders
      if (HIDDEN_FOLDERS.has(folder.displayName)) continue;
      folders.push({
        id: folder.id,
        displayName: folder.displayName,
        totalItemCount: folder.totalItemCount ?? 0,
        unreadItemCount: folder.unreadItemCount ?? 0,
        childFolderCount: folder.childFolderCount ?? 0,
      });
    }

    url = data['@odata.nextLink'];
  }

  // Also refresh the folder cache as a side effect
  refreshFolderCache(mailbox.email, accessToken).catch(() => {});

  // Overlay DB counts (only emails since syncSinceDate) on top of Graph folder structure
  const dbCounts = await getDbFolderCounts(mailbox._id.toString(), mailbox.email);
  for (const folder of folders) {
    const count = dbCounts.get(folder.id) ?? dbCounts.get(folder.displayName) ?? 0;
    folder.totalItemCount = count;
    // unreadItemCount from Graph is also not date-filtered; set to 0 for now
    folder.unreadItemCount = 0;
  }

  res.json({ folders });
});

/**
 * Build a map of folderId/folderName → message count from our DB.
 * Only counts non-deleted 'arrived' events (i.e. emails we've synced).
 */
async function getDbFolderCounts(
  mailboxId: string,
  mailboxEmail: string,
): Promise<Map<string, number>> {
  const redis = getRedisClient();
  const countMap = new Map<string, number>();

  // Aggregate counts by toFolder from EmailEvent
  const counts = await EmailEvent.aggregate([
    {
      $match: {
        mailboxId: new Types.ObjectId(mailboxId),
        eventType: { $ne: 'deleted' },
      },
    },
    { $group: { _id: '$toFolder', count: { $sum: 1 } } },
  ]);

  // Build reverse lookup: folder cache name → folder ID, and folder ID → name
  const allFolderIdsRaw = await redis.get(`folder:${mailboxEmail}:all`);
  const folderIdToName = new Map<string, string>();
  const folderNameToId = new Map<string, string>();
  if (allFolderIdsRaw) {
    const ids: string[] = JSON.parse(allFolderIdsRaw);
    for (const fid of ids) {
      const fname = await redis.get(`folder:${mailboxEmail}:${fid}`);
      if (fname) {
        folderIdToName.set(fid, fname);
        folderNameToId.set(fname, fid);
      }
    }
  }

  for (const row of counts) {
    const toFolder: string = row._id;
    const count: number = row.count;
    if (!toFolder) continue;

    // Store count by exact toFolder value
    countMap.set(toFolder, (countMap.get(toFolder) ?? 0) + count);

    // If toFolder is a folder ID, also map to its display name
    const name = folderIdToName.get(toFolder);
    if (name) {
      countMap.set(name, (countMap.get(name) ?? 0) + count);
    }

    // If toFolder is a display name, also map to its folder ID
    const id = folderNameToId.get(toFolder);
    if (id) {
      countMap.set(id, (countMap.get(id) ?? 0) + count);
    }
  }

  // For subfolder paths like "Inbox/Abacus", also aggregate into the parent's count
  // and map the leaf name to the folder ID
  for (const [key, count] of Array.from(countMap.entries())) {
    if (key.includes('/')) {
      const fid = folderNameToId.get(key);
      if (fid && !countMap.has(fid)) {
        countMap.set(fid, count);
      }
    }
  }

  return countMap;
}

/**
 * GET /api/mailboxes/:id/folders/:folderId/children
 *
 * Returns child folders for a specific folder.
 */
foldersRouter.get('/:id/folders/:folderId/children', async (req: Request, res: Response) => {
  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: req.user!.userId,
  });

  if (!mailbox) {
    throw new NotFoundError('Mailbox not found');
  }

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
  const selectParam = buildSelectParam('mailFolder');
  let url: string | undefined =
    `/users/${mailbox.email}/mailFolders/${req.params.folderId}/childFolders?$select=${selectParam}&$top=100`;

  const folders: { id: string; displayName: string; totalItemCount: number; unreadItemCount: number; childFolderCount: number }[] = [];

  while (url) {
    const response = await graphFetch(url, accessToken);
    const data = (await response.json()) as {
      value: { id: string; displayName: string; totalItemCount?: number; unreadItemCount?: number; childFolderCount?: number }[];
      '@odata.nextLink'?: string;
    };

    for (const folder of data.value) {
      folders.push({
        id: folder.id,
        displayName: folder.displayName,
        totalItemCount: folder.totalItemCount ?? 0,
        unreadItemCount: folder.unreadItemCount ?? 0,
        childFolderCount: folder.childFolderCount ?? 0,
      });
    }

    url = data['@odata.nextLink'];
  }

  // Overlay DB counts for child folders too
  const dbCounts = await getDbFolderCounts(mailbox._id.toString(), mailbox.email);
  for (const folder of folders) {
    const count = dbCounts.get(folder.id) ?? dbCounts.get(folder.displayName) ?? 0;
    folder.totalItemCount = count;
    folder.unreadItemCount = 0;
  }

  res.json({ folders });
});

/**
 * POST /api/mailboxes/:id/folders/:folderId/sync
 *
 * Trigger a delta sync for a specific folder. Used when user navigates
 * to a folder that may not have been synced yet.
 */
foldersRouter.post('/:id/folders/:folderId/sync', async (req: Request, res: Response) => {
  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: req.user!.userId,
  });

  if (!mailbox) {
    throw new NotFoundError('Mailbox not found');
  }

  // Set up SSE streaming for progress updates
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const ac = new AbortController();
  req.on('close', () => ac.abort());

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
    const folderId = req.params.folderId as string;

    const result = await runDeltaSync(
      mailbox._id.toString(),
      mailbox.email,
      folderId,
      accessToken,
      mailbox.userId.toString(),
      {
        signal: ac.signal,
        onProgress: (counters: DeltaSyncResult, pageMessages: number) => {
          if (!ac.signal.aborted) {
            sendEvent('progress', { ...counters, pageMessages });
          }
        },
      },
    );

    if (!ac.signal.aborted) {
      sendEvent('done', { synced: true, ...result });
    }
  } catch (err) {
    if (!ac.signal.aborted) {
      sendEvent('error', { message: err instanceof Error ? err.message : 'Sync failed' });
    }
  }

  res.end();
});

/**
 * POST /api/mailboxes/:id/folders
 *
 * Creates a new mail folder in the mailbox via Graph API.
 * Body: { displayName: string }
 */
foldersRouter.post('/:id/folders', async (req: Request, res: Response) => {
  const { displayName } = req.body as { displayName?: string };
  if (!displayName || !displayName.trim()) {
    throw new ValidationError('displayName is required');
  }

  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: req.user!.userId,
  });

  if (!mailbox) {
    throw new NotFoundError('Mailbox not found');
  }

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());

  const response = await graphFetch(
    `/users/${mailbox.email}/mailFolders`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ displayName: displayName.trim() }),
    },
  );

  const folder = (await response.json()) as { id: string; displayName: string };

  // Refresh cache so the new folder appears in listings
  await refreshFolderCache(mailbox.email, accessToken);

  res.status(201).json({ folder: { id: folder.id, displayName: folder.displayName } });
});

export default foldersRouter;
