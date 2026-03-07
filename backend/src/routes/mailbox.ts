import { Router, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { Mailbox } from '../models/Mailbox.js';
import { EmailEvent } from '../models/EmailEvent.js';
import { AuditLog } from '../models/AuditLog.js';
import { requireAuth, requireAdmin } from '../auth/middleware.js';
import { createLoginMsalClient, GRAPH_SCOPES } from '../auth/msalClient.js';
import {
  addToOrgWhitelist,
  removeFromOrgWhitelist,
  getOrgWhitelist,
} from '../services/whitelistService.js';
import { getAccessTokenForMailbox } from '../auth/tokenManager.js';
import { refreshFolderCache } from '../services/folderCache.js';
import { getRedisClient } from '../config/redis.js';
import { runDeltaSync, type DeltaSyncResult } from '../services/deltaService.js';
import { graphFetch } from '../services/graphClient.js';
import { buildSelectParam } from '../utils/graph.js';
import { config } from '../config/index.js';
import logger from '../config/logger.js';
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { createTrackedEmail } from '../services/trackingService.js';

const mailboxRouter = Router();

/**
 * Inject tracking pixel HTML into an email body.
 * Inserts before </body> if present, otherwise appends.
 */
function injectTrackingPixel(html: string, pixelHtml: string): string {
  const bodyCloseIdx = html.lastIndexOf('</body>');
  if (bodyCloseIdx !== -1) {
    return html.slice(0, bodyCloseIdx) + pixelHtml + html.slice(bodyCloseIdx);
  }
  return html + pixelHtml;
}

/** Folders to hide from the folder browser (not useful for mail management). */
const HIDDEN_FOLDERS = new Set([
  'Outbox',
  'Sync Issues',
  'Conversation History',
  'RSS Feeds',
]);

/**
 * Prepend user's reply text into a Graph-generated draft HTML body.
 * Uses multiple fallback strategies to ensure the text is always inserted.
 */
function prependReplyHtml(draftBodyContent: string, replyText: string): string {
  const replyHtml = `<div style="font-family:Calibri,Arial,Helvetica,sans-serif;font-size:11pt;color:#000000">${replyText.replace(/\n/g, '<br>')}</div><br>`;

  // Strategy 1: Insert after the appendonsend marker (Graph's standard insertion point)
  const appendOnSend = draftBodyContent.match(/<div\s+id\s*=\s*["']appendonsend["'][^>]*>[\s\S]*?<\/div>/i);
  if (appendOnSend) {
    const insertPos = appendOnSend.index! + appendOnSend[0].length;
    return draftBodyContent.slice(0, insertPos) + replyHtml + draftBodyContent.slice(insertPos);
  }

  // Strategy 2: Insert right after the opening <body> tag
  const bodyTag = draftBodyContent.match(/<body[^>]*>/i);
  if (bodyTag) {
    const insertPos = bodyTag.index! + bodyTag[0].length;
    return draftBodyContent.slice(0, insertPos) + replyHtml + draftBodyContent.slice(insertPos);
  }

  // Strategy 3: Prepend to whatever content exists
  return replyHtml + draftBodyContent;
}

// All mailbox routes require authentication
mailboxRouter.use(requireAuth);

// ---- Org-wide whitelist routes (admin only) ----
// NOTE: These MUST be defined before /:id routes to avoid 'org-whitelist' being captured as an :id.

/**
 * GET /api/mailboxes/org-whitelist
 *
 * Get org-wide whitelist (admin only).
 */
mailboxRouter.get(
  '/org-whitelist',
  requireAdmin,
  async (_req: Request, res: Response) => {
    const { senders, domains } = await getOrgWhitelist();
    res.json({ senders, domains });
  },
);

/**
 * PUT /api/mailboxes/org-whitelist
 *
 * Update org-wide whitelist (admin only).
 * Body: { senders?: string[], domains?: string[] }
 */
mailboxRouter.put(
  '/org-whitelist',
  requireAdmin,
  async (req: Request, res: Response) => {
    const { senders, domains } = req.body as {
      senders?: string[];
      domains?: string[];
    };

    // Get current whitelist to compute diffs
    const current = await getOrgWhitelist();

    // Update senders
    if (senders && Array.isArray(senders)) {
      const currentSet = new Set(current.senders.map((s) => s.toLowerCase()));
      const newSet = new Set(senders.map((s) => s.toLowerCase()));

      // Add new senders
      for (const sender of newSet) {
        if (!currentSet.has(sender)) {
          await addToOrgWhitelist('sender', sender);
        }
      }
      // Remove old senders
      for (const sender of currentSet) {
        if (!newSet.has(sender)) {
          await removeFromOrgWhitelist('sender', sender);
        }
      }
    }

    // Update domains
    if (domains && Array.isArray(domains)) {
      const currentSet = new Set(current.domains.map((d) => d.toLowerCase()));
      const newSet = new Set(domains.map((d) => d.toLowerCase()));

      // Add new domains
      for (const domain of newSet) {
        if (!currentSet.has(domain)) {
          await addToOrgWhitelist('domain', domain);
        }
      }
      // Remove old domains
      for (const domain of currentSet) {
        if (!newSet.has(domain)) {
          await removeFromOrgWhitelist('domain', domain);
        }
      }
    }

    const updated = await getOrgWhitelist();
    res.json({ senders: updated.senders, domains: updated.domains });
  },
);

// ---- Mailbox connection routes ----

/**
 * POST /api/mailboxes/connect
 *
 * Initiates an OAuth flow to connect an additional Microsoft 365 mailbox.
 * Returns an auth URL that the frontend should redirect the user to.
 */
mailboxRouter.post('/connect', async (req: Request, res: Response) => {
  const { loginHint } = req.body as { loginHint?: string };

  // Create a signed JWT state parameter with userId and connect_mailbox action
  const stateToken = jwt.sign(
    {
      action: 'connect_mailbox',
      userId: req.user!.userId,
      ts: Date.now(),
    },
    config.jwtSecret,
    { expiresIn: '10m' },
  );

  const msalClient = createLoginMsalClient();

  const authCodeUrlParams: {
    scopes: string[];
    redirectUri: string;
    state: string;
    prompt: string;
    loginHint?: string;
  } = {
    scopes: GRAPH_SCOPES,
    redirectUri: `${config.apiUrl}/auth/callback`,
    state: stateToken,
    prompt: 'select_account',
  };

  if (loginHint) {
    authCodeUrlParams.loginHint = loginHint;
  }

  const authUrl = await msalClient.getAuthCodeUrl(authCodeUrlParams);

  logger.info('Mailbox connect flow initiated', {
    userId: req.user!.userId,
    loginHint: loginHint || 'none',
  });

  res.json({ authUrl });
});

/**
 * GET /api/mailboxes
 *
 * List all mailboxes connected by the current user.
 */
mailboxRouter.get('/', async (req: Request, res: Response) => {
  const mailboxes = await Mailbox.find({ userId: req.user!.userId })
    .select(
      'email displayName isConnected homeAccountId tenantId lastSyncAt settings createdAt',
    )
    .sort({ createdAt: 1 });

  res.json(mailboxes);
});

/**
 * GET /api/mailboxes/autocomplete?q=xxx
 *
 * Email autocomplete suggestions from contacts cache + recent senders.
 * Searches across ALL connected mailboxes for the user.
 */
mailboxRouter.get('/autocomplete', async (req: Request, res: Response) => {
  const q = (req.query.q as string || '').trim().toLowerCase();
  if (q.length < 2) {
    res.json({ suggestions: [] });
    return;
  }

  const userId = req.user!.userId;
  const mailboxes = await Mailbox.find({ userId, isConnected: true }).select('_id email');

  const seen = new Map<string, { email: string; name?: string; score: number }>();

  // Source 1: Contacts from Redis cache
  const redis = getRedisClient();
  for (const mb of mailboxes) {
    const cached = await redis.get(`contacts:${mb._id.toString()}:all`);
    if (!cached) continue;
    const contacts = JSON.parse(cached) as Array<{
      displayName?: string;
      emailAddresses?: Array<{ address?: string; name?: string }>;
    }>;
    for (const c of contacts) {
      if (!c.emailAddresses) continue;
      for (const ea of c.emailAddresses) {
        if (!ea.address) continue;
        const email = ea.address.toLowerCase();
        const name = c.displayName || ea.name || '';
        if (email.includes(q) || name.toLowerCase().includes(q)) {
          const existing = seen.get(email);
          if (!existing || existing.score < 100) {
            seen.set(email, { email: ea.address, name: name || undefined, score: 100 });
          }
        }
      }
    }
  }

  // Source 2: Recent senders from EmailEvent (aggregate by frequency)
  const mailboxIds = mailboxes.map((m) => m._id);
  const recentSenders = await EmailEvent.aggregate([
    {
      $match: {
        userId: new Types.ObjectId(userId),
        mailboxId: { $in: mailboxIds },
        'sender.email': { $exists: true, $ne: null },
        $or: [
          { 'sender.email': { $regex: q, $options: 'i' } },
          { 'sender.name': { $regex: q, $options: 'i' } },
        ],
      },
    },
    {
      $group: {
        _id: { $toLower: '$sender.email' },
        name: { $first: '$sender.name' },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 20 },
  ]);

  for (const s of recentSenders) {
    const email = s._id as string;
    const existing = seen.get(email);
    const score = Math.min(s.count, 99); // contacts always rank higher
    if (!existing || existing.score < score) {
      seen.set(email, { email: s.name ? email : email, name: s.name || undefined, score });
    }
    // If contact already there, keep it (higher score)
  }

  // Sort by score descending, then alphabetically
  const suggestions = [...seen.values()]
    .sort((a, b) => b.score - a.score || (a.email).localeCompare(b.email))
    .slice(0, 10)
    .map(({ email, name }) => ({ email, ...(name && { name }) }));

  res.json({ suggestions });
});

/**
 * DELETE /api/mailboxes/:id/disconnect
 *
 * Disconnect a mailbox and clear its tokens and MSAL cache.
 * User can only disconnect their own mailboxes.
 */
mailboxRouter.delete(
  '/:id/disconnect',
  async (req: Request, res: Response) => {
    const mailbox = await Mailbox.findOne({
      _id: req.params.id,
      userId: req.user!.userId,
    });

    if (!mailbox) {
      throw new NotFoundError('Mailbox not found');
    }

    await Mailbox.findByIdAndUpdate(mailbox._id, {
      isConnected: false,
      msalCache: null,
      encryptedTokens: {},
    });

    logger.info('Mailbox disconnected', {
      mailboxId: req.params.id,
      email: mailbox.email,
      userId: req.user!.userId,
    });

    res.json({ message: 'Mailbox disconnected', mailboxId: req.params.id });
  },
);

// ---- Per-mailbox folder listing ----

/**
 * GET /api/mailboxes/:id/folders
 *
 * Returns the mail folders for a mailbox (fetched from Graph API via cache).
 */
mailboxRouter.get('/:id/folders', async (req: Request, res: Response) => {
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
mailboxRouter.get('/:id/folders/:folderId/children', async (req: Request, res: Response) => {
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
mailboxRouter.post('/:id/folders/:folderId/sync', async (req: Request, res: Response) => {
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
mailboxRouter.post('/:id/folders', async (req: Request, res: Response) => {
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

// ---- Apply actions to messages ----

/**
 * POST /api/mailboxes/:id/apply-actions
 *
 * Immediately apply actions (delete, move, markRead) to specific messages via Graph API.
 * Body: { messageIds: string[], actions: { actionType: string, toFolder?: string }[] }
 */
mailboxRouter.post(
  '/:id/apply-actions',
  async (req: Request, res: Response) => {
    const { messageIds, actions } = req.body as {
      messageIds?: string[];
      actions?: { actionType: string; toFolder?: string }[];
    };

    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      throw new ValidationError('messageIds is required and must be a non-empty array');
    }
    if (!actions || !Array.isArray(actions) || actions.length === 0) {
      throw new ValidationError('actions is required and must be a non-empty array');
    }

    const mailbox = await Mailbox.findOne({
      _id: req.params.id,
      userId: req.user!.userId,
    });

    if (!mailbox) {
      throw new NotFoundError('Mailbox not found');
    }

    const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
    const email = mailbox.email;

    let applied = 0;
    let failed = 0;

    for (const msgId of messageIds) {
      try {
        for (const action of actions) {
          switch (action.actionType) {
            case 'delete':
              await graphFetch(
                `/users/${email}/messages/${msgId}/move`,
                accessToken,
                {
                  method: 'POST',
                  body: JSON.stringify({ destinationId: 'deleteditems' }),
                },
              );
              break;
            case 'move':
              if (action.toFolder) {
                await graphFetch(
                  `/users/${email}/messages/${msgId}/move`,
                  accessToken,
                  {
                    method: 'POST',
                    body: JSON.stringify({ destinationId: action.toFolder }),
                  },
                );
              }
              break;
            case 'markRead':
              await graphFetch(
                `/users/${email}/messages/${msgId}`,
                accessToken,
                {
                  method: 'PATCH',
                  body: JSON.stringify({ isRead: true }),
                },
              );
              break;
          }
        }
        applied++;
      } catch (err) {
        failed++;
        logger.warn('Failed to apply action to message', {
          mailboxId: req.params.id,
          messageId: msgId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Record 'deleted' EmailEvent records so excludeDeleted filter works
    const hasDeleteAction = actions.some((a) => a.actionType === 'delete');
    if (hasDeleteAction && applied > 0) {
      const successMsgIds = messageIds.slice(0, applied);
      const bulkOps = successMsgIds.map((msgId) => ({
        updateOne: {
          filter: {
            userId: new Types.ObjectId(req.user!.userId),
            mailboxId: mailbox._id,
            messageId: msgId,
            eventType: 'deleted' as const,
          },
          update: {
            $setOnInsert: {
              userId: new Types.ObjectId(req.user!.userId),
              mailboxId: mailbox._id,
              messageId: msgId,
              eventType: 'deleted' as const,
              timestamp: new Date(),
              sender: {},
              importance: 'normal' as const,
              hasAttachments: false,
              categories: [],
              isRead: false,
              metadata: {},
            },
          },
          upsert: true,
        },
      }));
      try {
        await EmailEvent.bulkWrite(bulkOps);
      } catch {
        // Non-critical, log and continue
      }
    }

    logger.info('Applied actions to messages', {
      mailboxId: req.params.id,
      applied,
      failed,
      total: messageIds.length,
    });

    res.json({ applied, failed, total: messageIds.length });
  },
);

/**
 * GET /api/mailboxes/deleted-count-all
 *
 * Returns the total number of messages in Deleted Items across all connected mailboxes.
 */
mailboxRouter.get('/deleted-count-all', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const mailboxes = await Mailbox.find({ userId, isConnected: true }).select('email').lean();

  let total = 0;
  const results = await Promise.allSettled(
    mailboxes.map(async (mb) => {
      const accessToken = await getAccessTokenForMailbox(mb._id.toString());
      const response = await graphFetch(
        `/users/${mb.email}/mailFolders/deleteditems?$select=totalItemCount`,
        accessToken,
      );
      const data = (await response.json()) as { totalItemCount?: number };
      return data.totalItemCount ?? 0;
    }),
  );

  for (const r of results) {
    if (r.status === 'fulfilled') {
      total += r.value;
    }
  }

  res.json({ count: total });
});

/**
 * GET /api/mailboxes/:id/deleted-count
 *
 * Returns the number of messages in the Deleted Items folder.
 */
mailboxRouter.get('/:id/deleted-count', async (req: Request, res: Response) => {
  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: req.user!.userId,
  });
  if (!mailbox) {
    throw new NotFoundError('Mailbox not found');
  }

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
  const response = await graphFetch(
    `/users/${mailbox.email}/mailFolders/deleteditems?$select=totalItemCount`,
    accessToken,
  );
  const data = (await response.json()) as { totalItemCount?: number };

  res.json({ count: data.totalItemCount ?? 0 });
});

/**
 * POST /api/mailboxes/:id/empty-deleted
 *
 * Permanently deletes all messages in the Deleted Items folder.
 */
mailboxRouter.post('/:id/empty-deleted', async (req: Request, res: Response) => {
  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: req.user!.userId,
  });
  if (!mailbox) {
    throw new NotFoundError('Mailbox not found');
  }

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
  const email = mailbox.email;

  let deleted = 0;
  let failed = 0;
  const CONCURRENCY = 20;
  const FETCH_SIZE = 200;

  // Fetch and permanently delete in parallel batches
  let hasMore = true;
  while (hasMore) {
    const response = await graphFetch(
      `/users/${email}/mailFolders/deleteditems/messages?$select=id&$top=${FETCH_SIZE}`,
      accessToken,
    );
    const data = (await response.json()) as {
      value: { id: string }[];
    };

    if (data.value.length === 0) break;

    // Delete in parallel batches of CONCURRENCY
    for (let i = 0; i < data.value.length; i += CONCURRENCY) {
      const batch = data.value.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((msg) =>
          graphFetch(`/users/${email}/messages/${msg.id}`, accessToken, {
            method: 'DELETE',
          }),
        ),
      );
      for (const r of results) {
        if (r.status === 'fulfilled') deleted++;
        else failed++;
      }
    }

    // If all failed this round, stop
    if (failed > 0 && deleted === 0) break;

    hasMore = data.value.length === FETCH_SIZE;
  }

  logger.info('Emptied deleted items', {
    mailboxId: req.params.id,
    deleted,
    failed,
  });

  res.json({ deleted, failed });
});

// ---- Fetch individual message (body) ----

/**
 * GET /api/mailboxes/:id/messages/:messageId
 *
 * Fetches an individual message from Graph API including its body content.
 */
mailboxRouter.get('/:id/messages/:messageId', async (req: Request, res: Response) => {
  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: req.user!.userId,
  });
  if (!mailbox) {
    throw new NotFoundError('Mailbox not found');
  }

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
  const response = await graphFetch(
    `/users/${mailbox.email}/messages/${req.params.messageId}?$select=id,subject,body,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,isRead,importance,hasAttachments,categories,flag`,
    accessToken,
  );

  const message = (await response.json()) as {
    id: string;
    subject?: string;
    body?: { contentType: string; content: string };
    bodyPreview?: string;
    from?: { emailAddress: { name?: string; address?: string } };
    toRecipients?: { emailAddress: { name?: string; address?: string } }[];
    ccRecipients?: { emailAddress: { name?: string; address?: string } }[];
    receivedDateTime?: string;
    isRead?: boolean;
    importance?: string;
    hasAttachments?: boolean;
    categories?: string[];
  };

  // If the HTML body has cid: image references, fetch inline attachments and
  // replace them with data: URIs so images render in the browser.
  if (message.body?.contentType === 'html' && message.body.content.includes('cid:')) {
    try {
      const attResponse = await graphFetch(
        `/users/${mailbox.email}/messages/${req.params.messageId}/attachments?$select=contentId,contentType,contentBytes,isInline`,
        accessToken,
      );
      const attData = (await attResponse.json()) as {
        value: { contentId?: string; contentType?: string; contentBytes?: string; isInline?: boolean }[];
      };
      if (attData.value?.length) {
        let html = message.body.content;
        for (const att of attData.value) {
          if (att.contentId && att.contentBytes && att.contentType && att.contentType.startsWith('image/')) {
            // contentId may be wrapped in angle brackets: <image001.jpg@...>
            const cid = att.contentId.replace(/^<|>$/g, '');
            const dataUri = `data:${att.contentType};base64,${att.contentBytes}`;
            // Replace all variations: cid:ID and cid:<ID>
            html = html.split(`cid:${cid}`).join(dataUri);
            html = html.split(`cid:<${cid}>`).join(dataUri);
          }
        }
        message.body.content = html;
      }
    } catch {
      // Non-fatal — return body as-is if attachment fetch fails
    }
  }

  res.json({ message });
});

// ---- Reply & Forward ----

/**
 * POST /api/mailboxes/:id/reply
 *
 * Two-step reply: createReply draft (with proper HTML + quoted original) → send.
 * Produces Outlook-identical formatting that passes spam filters.
 * Body: { messageId, body, contentType? }
 */
mailboxRouter.post('/:id/reply', async (req: Request, res: Response) => {
  const { messageId, body, cc, bcc, track = true } = req.body as {
    messageId?: string;
    body?: string;
    cc?: string[];
    bcc?: string[];
    track?: boolean;
  };

  if (!messageId) throw new ValidationError('messageId is required');
  if (!body || !body.trim()) throw new ValidationError('body is required');

  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: req.user!.userId,
  });
  if (!mailbox) throw new NotFoundError('Mailbox not found');

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());

  // Step 1: Create draft reply — empty body gives us the quoted original
  const createRes = await graphFetch(
    `/users/${mailbox.email}/messages/${messageId}/createReply`,
    accessToken,
    { method: 'POST', body: JSON.stringify({}) },
  );
  const draft = (await createRes.json()) as { id: string; body: { content: string; contentType: string } };

  // Step 2: Prepend user's reply as Outlook-formatted HTML into the draft body
  let updatedContent = prependReplyHtml(draft.body.content, body.trim());

  // Inject tracking pixel (only if tracking is enabled)
  if (track) {
    const replyDraft = (await graphFetch(
      `/users/${mailbox.email}/messages/${draft.id}?$select=subject,toRecipients`,
      accessToken,
    ).then((r) => r.json())) as { subject?: string; toRecipients?: { emailAddress: { address?: string } }[] };

    const { pixelHtml: replyPixel } = await createTrackedEmail({
      userId: req.user!.userId,
      mailboxId: req.params.id as string,
      subject: replyDraft.subject,
      recipients: replyDraft.toRecipients?.map((r) => r.emailAddress.address || '').filter(Boolean) || [],
    });
    updatedContent = injectTrackingPixel(updatedContent, replyPixel);
  }

  const replyPatch: Record<string, unknown> = {
    body: { contentType: 'HTML', content: updatedContent },
    importance: 'normal',
  };
  if (cc?.length) replyPatch.ccRecipients = cc.map((e) => ({ emailAddress: { address: e } }));
  if (bcc?.length) replyPatch.bccRecipients = bcc.map((e) => ({ emailAddress: { address: e } }));

  await graphFetch(
    `/users/${mailbox.email}/messages/${draft.id}`,
    accessToken,
    { method: 'PATCH', body: JSON.stringify(replyPatch) },
  );

  // Step 3: Send the draft
  await graphFetch(
    `/users/${mailbox.email}/messages/${draft.id}/send`,
    accessToken,
    { method: 'POST' },
  );

  logger.info('Reply sent (tracked)', {
    mailboxId: req.params.id,
    messageId,
    userId: req.user!.userId,
  });

  res.json({ success: true });
});

/**
 * POST /api/mailboxes/:id/reply-all
 *
 * Two-step reply-all: createReplyAll draft → send.
 * Body: { messageId, body, contentType? }
 */
mailboxRouter.post('/:id/reply-all', async (req: Request, res: Response) => {
  const { messageId, body, cc, bcc, track = true } = req.body as {
    messageId?: string;
    body?: string;
    cc?: string[];
    bcc?: string[];
    track?: boolean;
  };

  if (!messageId) throw new ValidationError('messageId is required');
  if (!body || !body.trim()) throw new ValidationError('body is required');

  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: req.user!.userId,
  });
  if (!mailbox) throw new NotFoundError('Mailbox not found');

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());

  // Step 1: Create draft reply-all
  const createRes = await graphFetch(
    `/users/${mailbox.email}/messages/${messageId}/createReplyAll`,
    accessToken,
    { method: 'POST', body: JSON.stringify({}) },
  );
  const draft = (await createRes.json()) as { id: string; body: { content: string; contentType: string } };

  // Step 2: Prepend user's reply as Outlook-formatted HTML
  let updatedContentAll = prependReplyHtml(draft.body.content, body.trim());

  // Inject tracking pixel (only if tracking is enabled)
  if (track) {
    const replyAllDraft = (await graphFetch(
      `/users/${mailbox.email}/messages/${draft.id}?$select=subject,toRecipients,ccRecipients`,
      accessToken,
    ).then((r) => r.json())) as { subject?: string; toRecipients?: { emailAddress: { address?: string } }[]; ccRecipients?: { emailAddress: { address?: string } }[] };

    const allRecips = [
      ...(replyAllDraft.toRecipients || []),
      ...(replyAllDraft.ccRecipients || []),
    ].map((r) => r.emailAddress.address || '').filter(Boolean);

    const { pixelHtml: replyAllPixel } = await createTrackedEmail({
      userId: req.user!.userId,
      mailboxId: req.params.id as string,
      subject: replyAllDraft.subject,
      recipients: allRecips,
    });
    updatedContentAll = injectTrackingPixel(updatedContentAll, replyAllPixel);
  }

  const replyAllPatch: Record<string, unknown> = {
    body: { contentType: 'HTML', content: updatedContentAll },
    importance: 'normal',
  };
  if (cc?.length) replyAllPatch.ccRecipients = cc.map((e) => ({ emailAddress: { address: e } }));
  if (bcc?.length) replyAllPatch.bccRecipients = bcc.map((e) => ({ emailAddress: { address: e } }));

  await graphFetch(
    `/users/${mailbox.email}/messages/${draft.id}`,
    accessToken,
    { method: 'PATCH', body: JSON.stringify(replyAllPatch) },
  );

  // Step 3: Send
  await graphFetch(
    `/users/${mailbox.email}/messages/${draft.id}/send`,
    accessToken,
    { method: 'POST' },
  );

  logger.info('Reply-all sent (tracked)', {
    mailboxId: req.params.id,
    messageId,
    userId: req.user!.userId,
  });

  res.json({ success: true });
});

/**
 * POST /api/mailboxes/:id/forward
 *
 * Two-step forward: createForward draft → set recipients → send.
 * Body: { messageId, toRecipients: [{email, name?}], body, contentType? }
 */
mailboxRouter.post('/:id/forward', async (req: Request, res: Response) => {
  const { messageId, toRecipients, body } = req.body as {
    messageId?: string;
    toRecipients?: { email: string; name?: string }[];
    body?: string;
  };

  if (!messageId) throw new ValidationError('messageId is required');
  if (!toRecipients || !Array.isArray(toRecipients) || toRecipients.length === 0) {
    throw new ValidationError('toRecipients is required and must be a non-empty array');
  }
  if (!body || !body.trim()) throw new ValidationError('body is required');

  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: req.user!.userId,
  });
  if (!mailbox) throw new NotFoundError('Mailbox not found');

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());

  // Step 1: Create draft forward
  const createRes = await graphFetch(
    `/users/${mailbox.email}/messages/${messageId}/createForward`,
    accessToken,
    { method: 'POST', body: JSON.stringify({}) },
  );
  const draft = (await createRes.json()) as { id: string; subject?: string; body: { content: string; contentType: string } };

  // Step 2: Set recipients and prepend user's comment
  let fwdContent = prependReplyHtml(draft.body.content, body.trim());

  // Inject tracking pixel
  const { pixelHtml: fwdPixel } = await createTrackedEmail({
    userId: req.user!.userId,
    mailboxId: req.params.id as string,
    subject: draft.subject,
    recipients: toRecipients.map((r) => r.email),
  });
  fwdContent = injectTrackingPixel(fwdContent, fwdPixel);

  await graphFetch(
    `/users/${mailbox.email}/messages/${draft.id}`,
    accessToken,
    {
      method: 'PATCH',
      body: JSON.stringify({
        toRecipients: toRecipients.map((r) => ({
          emailAddress: { address: r.email, name: r.name || r.email },
        })),
        body: { contentType: 'HTML', content: fwdContent },
        importance: 'normal',
      }),
    },
  );

  // Step 3: Send
  await graphFetch(
    `/users/${mailbox.email}/messages/${draft.id}/send`,
    accessToken,
    { method: 'POST' },
  );

  logger.info('Message forwarded (tracked)', {
    mailboxId: req.params.id,
    messageId,
    toRecipients: toRecipients.map((r) => r.email),
    userId: req.user!.userId,
  });

  res.json({ success: true });
});

// ---- Send new email ----

/**
 * POST /api/mailboxes/:id/send-email
 *
 * Compose and send a new email via Graph API sendMail.
 * Body: { to: string[], cc?: string[], bcc?: string[], subject: string, body: string, contentType?: 'Text' | 'HTML' }
 */
mailboxRouter.post('/:id/send-email', async (req: Request, res: Response) => {
  const { to, cc, bcc, subject, body, contentType, track } = req.body as {
    to?: string[];
    cc?: string[];
    bcc?: string[];
    subject?: string;
    body?: string;
    contentType?: 'Text' | 'HTML';
    track?: boolean;
  };

  if (!to || !Array.isArray(to) || to.length === 0) {
    throw new ValidationError('to is required and must be a non-empty array');
  }
  if (!subject) throw new ValidationError('subject is required');
  if (!body) throw new ValidationError('body is required');

  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: req.user!.userId,
  });
  if (!mailbox) throw new NotFoundError('Mailbox not found');

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());

  const mapRecipients = (addrs: string[]) =>
    addrs.map((address) => ({ emailAddress: { address } }));

  // Step 1: Create draft message
  const draftMsg: Record<string, unknown> = {
    subject,
    body: { contentType: contentType || 'Text', content: body },
    toRecipients: mapRecipients(to),
  };
  if (cc && cc.length > 0) draftMsg.ccRecipients = mapRecipients(cc);
  if (bcc && bcc.length > 0) draftMsg.bccRecipients = mapRecipients(bcc);

  const draftRes = await graphFetch(
    `/users/${mailbox.email}/messages`,
    accessToken,
    { method: 'POST', body: JSON.stringify(draftMsg) },
  );
  const draft = (await draftRes.json()) as { id: string; body: { content: string; contentType: string } };

  // Step 2: Optionally inject tracking pixel
  let htmlContent = draft.body.content;
  if (draft.body.contentType === 'Text' || (!contentType || contentType === 'Text')) {
    // Wrap plain text in basic HTML
    htmlContent = `<html><body><pre>${htmlContent}</pre></body></html>`;
  }
  if (track !== false) {
    const { pixelHtml } = await createTrackedEmail({
      userId: req.user!.userId,
      mailboxId: req.params.id as string,
      subject,
      recipients: [...to, ...(cc || []), ...(bcc || [])],
    });
    htmlContent = injectTrackingPixel(htmlContent, pixelHtml);
  }

  await graphFetch(
    `/users/${mailbox.email}/messages/${draft.id}`,
    accessToken,
    {
      method: 'PATCH',
      body: JSON.stringify({
        body: { contentType: 'HTML', content: htmlContent },
      }),
    },
  );

  // Step 3: Send the draft
  await graphFetch(
    `/users/${mailbox.email}/messages/${draft.id}/send`,
    accessToken,
    { method: 'POST' },
  );

  logger.info('New email sent (tracked)', {
    mailboxId: req.params.id,
    from: mailbox.email,
    to,
    subject,
    userId: req.user!.userId,
  });

  res.json({ success: true });
});

// ---- Per-mailbox whitelist endpoints ----

/**
 * GET /api/mailboxes/:id/whitelist
 *
 * Get per-mailbox whitelist.
 */
mailboxRouter.get('/:id/whitelist', async (req: Request, res: Response) => {
  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: req.user!.userId,
  }).select('settings.whitelistedSenders settings.whitelistedDomains');

  if (!mailbox) {
    throw new NotFoundError('Mailbox not found');
  }

  res.json({
    senders: mailbox.settings.whitelistedSenders,
    domains: mailbox.settings.whitelistedDomains,
  });
});

/**
 * PUT /api/mailboxes/:id/whitelist
 *
 * Update per-mailbox whitelist.
 * Body: { senders?: string[], domains?: string[] }
 */
mailboxRouter.put('/:id/whitelist', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId,
  });

  if (!mailbox) {
    throw new NotFoundError('Mailbox not found');
  }

  const { senders, domains } = req.body as {
    senders?: string[];
    domains?: string[];
  };

  if (senders !== undefined) {
    if (!Array.isArray(senders)) {
      throw new ValidationError('senders must be an array of strings');
    }
    mailbox.settings.whitelistedSenders = senders;
  }
  if (domains !== undefined) {
    if (!Array.isArray(domains)) {
      throw new ValidationError('domains must be an array of strings');
    }
    mailbox.settings.whitelistedDomains = domains;
  }

  await mailbox.save();

  // Audit log
  await AuditLog.create({
    userId,
    mailboxId: mailbox._id,
    action: 'whitelist_updated',
    targetType: 'settings',
    details: {
      senders: mailbox.settings.whitelistedSenders,
      domains: mailbox.settings.whitelistedDomains,
    },
    undoable: false,
  });

  res.json({
    senders: mailbox.settings.whitelistedSenders,
    domains: mailbox.settings.whitelistedDomains,
  });
});

// ---- Contact folder & search endpoints ----

/**
 * GET /api/mailboxes/:id/contact-folders
 *
 * Returns all contact folders for a mailbox with contact counts.
 */
mailboxRouter.get('/:id/contact-folders', async (req: Request, res: Response) => {
  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: req.user!.userId,
  });

  if (!mailbox) {
    throw new NotFoundError('Mailbox not found');
  }

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());

  interface ContactFolderResult {
    id: string;
    displayName: string;
    totalCount: number;
  }
  const folders: ContactFolderResult[] = [];

  // 1. Always include the default "Contacts" folder (not returned by /contactFolders)
  //    Use special id "default" — the contacts search endpoint handles this.
  try {
    const defaultCountRes = await graphFetch(
      `/users/${mailbox.email}/contacts/$count`,
      accessToken,
      { headers: { 'ConsistencyLevel': 'eventual' } },
    );
    const defaultCountText = await defaultCountRes.text();
    folders.push({
      id: 'default',
      displayName: 'Contacts',
      totalCount: parseInt(defaultCountText, 10) || 0,
    });
  } catch {
    // If count fails, still add with 0
    folders.push({ id: 'default', displayName: 'Contacts', totalCount: 0 });
  }

  // 2. List user-created sub-folders under the default contacts folder
  let url: string | undefined =
    `/users/${mailbox.email}/contactFolders?$top=100&$select=id,displayName`;

  while (url) {
    const response = await graphFetch(url, accessToken);
    const data = (await response.json()) as {
      value: { id: string; displayName: string }[];
      '@odata.nextLink'?: string;
    };

    for (const folder of data.value) {
      folders.push({
        id: folder.id,
        displayName: folder.displayName,
        totalCount: 0,
      });
    }

    url = data['@odata.nextLink'];
  }

  // Fetch contact counts for sub-folders in parallel
  const subFolders = folders.filter((f) => f.id !== 'default');
  const countResults = await Promise.allSettled(
    subFolders.map(async (folder) => {
      const countRes = await graphFetch(
        `/users/${mailbox.email}/contactFolders/${folder.id}/contacts/$count`,
        accessToken,
        { headers: { 'ConsistencyLevel': 'eventual' } },
      );
      const text = await countRes.text();
      return { id: folder.id, count: parseInt(text, 10) || 0 };
    }),
  );

  for (const result of countResults) {
    if (result.status === 'fulfilled') {
      const folder = folders.find((f) => f.id === result.value.id);
      if (folder) folder.totalCount = result.value.count;
    }
  }

  res.json({ folders });
});

/**
 * GET /api/mailboxes/:id/contacts
 *
 * Search contacts in a specific contact folder.
 * Query params:
 *   - folderId: contact folder ID (required)
 *   - q: search query (optional, searches all fields)
 *   - all: if "true", serves from Redis cache (instant). On cache miss, fetches
 *          first page from Graph and queues a background full-sync.
 *   - refresh: if "true" with all=true, forces a full Graph API fetch + cache rebuild
 */
mailboxRouter.get('/:id/contacts', async (req: Request, res: Response) => {
  const { folderId, q, all, refresh } = req.query as {
    folderId?: string; q?: string; all?: string; refresh?: string;
  };

  if (!folderId) {
    throw new ValidationError('folderId query parameter is required');
  }

  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: req.user!.userId,
  });

  if (!mailbox) {
    throw new NotFoundError('Mailbox not found');
  }

  const fetchAll = all === 'true';
  const forceRefresh = refresh === 'true';
  const redis = getRedisClient();
  const cacheKey = `contacts:${mailbox._id.toString()}:all`;
  const metaKey = `contacts:${mailbox._id.toString()}:meta`;

  // --- Fast path: serve from Redis cache when all=true ---
  if (fetchAll && !forceRefresh) {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const metaRaw = await redis.get(metaKey);
      const meta = metaRaw ? JSON.parse(metaRaw) : {};
      const contacts = JSON.parse(cached);
      contacts.sort((a: { displayName: string }, b: { displayName: string }) =>
        (!a.displayName ? 1 : 0) - (!b.displayName ? 1 : 0) || (a.displayName || '').localeCompare(b.displayName || ''),
      );
      res.json({ contacts, cached: true, syncedAt: meta.syncedAt || null });
      return;
    }
  }

  // --- Cache miss or refresh: fetch from Graph API ---
  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
  const selectFields = 'id,displayName,emailAddresses,companyName,department,jobTitle,businessPhones,mobilePhone,personalNotes';

  const basePath = folderId === 'default'
    ? `/users/${mailbox.email}/contacts`
    : `/users/${mailbox.email}/contactFolders/${folderId}/contacts`;

  interface RawContact {
    id: string;
    displayName?: string;
    emailAddresses?: Array<{ name?: string; address?: string }>;
    companyName?: string;
    department?: string;
    jobTitle?: string;
    businessPhones?: string[];
    mobilePhone?: string;
    personalNotes?: string;
  }

  const mapContact = (c: RawContact) => ({
    id: c.id,
    displayName: c.displayName || '',
    emailAddresses: c.emailAddresses || [],
    companyName: c.companyName || '',
    department: c.department || '',
    jobTitle: c.jobTitle || '',
    businessPhones: c.businessPhones || [],
    mobilePhone: c.mobilePhone || '',
    personalNotes: c.personalNotes || '',
  });

  const pageSize = fetchAll ? 100 : 50;

  let graphUrl: string | undefined;
  if (q && q.trim()) {
    const searchTerm = q.trim().replace(/"/g, '\\"');
    graphUrl = `${basePath}?$search="${searchTerm}"&$select=${selectFields}&$top=${pageSize}&$orderby=displayName`;
  } else if (fetchAll) {
    // Skip $orderby for fetchAll — Graph sorts empty displayName first, making
    // the first page all blank names.  We sort locally after fetching anyway.
    graphUrl = `${basePath}?$select=${selectFields}&$top=${pageSize}`;
  } else {
    graphUrl = `${basePath}?$select=${selectFields}&$top=${pageSize}&$orderby=displayName`;
  }

  // Fetch first page
  const firstPageResp = await graphFetch(graphUrl!, accessToken, {
    headers: { 'ConsistencyLevel': 'eventual' },
  });
  const firstPageData = (await firstPageResp.json()) as {
    value: RawContact[];
    '@odata.nextLink'?: string;
  };

  const firstPageContacts = (firstPageData.value || []).map(mapContact);
  const nextLink = fetchAll ? firstPageData['@odata.nextLink'] : undefined;

  // For fetchAll with remaining pages: return first page now, fetch rest in background
  if (fetchAll && nextLink) {
    firstPageContacts.sort((a, b) => (!a.displayName ? 1 : 0) - (!b.displayName ? 1 : 0) || (a.displayName || '').localeCompare(b.displayName || ''));
    // Mark as partial — a background job is populating the cache
    redis.set(`contacts:${mailbox._id.toString()}:loading`, '1', 'EX', 120).catch(() => {});
    res.json({ contacts: firstPageContacts, cached: false, syncedAt: null, partial: true });

    // Background: fetch remaining pages and populate cache
    (async () => {
      try {
        const allContacts = [...firstPageContacts];
        let nextUrl: string | undefined = nextLink;
        while (nextUrl) {
          const resp = await graphFetch(nextUrl, accessToken, {
            headers: { 'ConsistencyLevel': 'eventual' },
          });
          const data = (await resp.json()) as { value: RawContact[]; '@odata.nextLink'?: string };
          allContacts.push(...(data.value || []).map(mapContact));
          nextUrl = data['@odata.nextLink'];
        }
        allContacts.sort((a, b) => (!a.displayName ? 1 : 0) - (!b.displayName ? 1 : 0) || (a.displayName || '').localeCompare(b.displayName || ''));
        const now = new Date().toISOString();
        await redis.set(cacheKey, JSON.stringify(allContacts), 'EX', 86400);
        await redis.set(metaKey, JSON.stringify({ count: allContacts.length, syncedAt: now }), 'EX', 86400);
        await redis.del(`contacts:${mailbox._id.toString()}:loading`);
      } catch (err) {
        logger.error('Background contacts fetch failed', { error: (err as Error).message });
        await redis.del(`contacts:${mailbox._id.toString()}:loading`).catch(() => {});
      }
    })();
    return;
  }

  // No more pages — we have everything in firstPageContacts
  if (!fetchAll) {
    res.json({ contacts: firstPageContacts });
    return;
  }

  // fetchAll with no nextLink — all fit in one page
  firstPageContacts.sort((a, b) => (!a.displayName ? 1 : 0) - (!b.displayName ? 1 : 0) || (a.displayName || '').localeCompare(b.displayName || ''));
  const now = new Date().toISOString();
  redis.set(cacheKey, JSON.stringify(firstPageContacts), 'EX', 86400).catch(() => {});
  redis.set(metaKey, JSON.stringify({ count: firstPageContacts.length, syncedAt: now }), 'EX', 86400).catch(() => {});
  res.json({ contacts: firstPageContacts, cached: false, syncedAt: now });
});

// ---- Contact CRUD endpoints ----

/**
 * POST /api/mailboxes/:id/contacts/bulk-delete
 *
 * Delete multiple contacts at once.
 * Body: { contactIds: string[] }
 */
mailboxRouter.post('/:id/contacts/bulk-delete', async (req: Request, res: Response) => {
  const { contactIds } = req.body as { contactIds?: string[] };

  if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0) {
    throw new ValidationError('contactIds is required and must be a non-empty array');
  }

  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: req.user!.userId,
  });
  if (!mailbox) throw new NotFoundError('Mailbox not found');

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
  let deleted = 0;
  let failed = 0;

  // Delete in parallel batches of 10
  for (let i = 0; i < contactIds.length; i += 10) {
    const batch = contactIds.slice(i, i + 10);
    const results = await Promise.allSettled(
      batch.map((cid) =>
        graphFetch(`/users/${mailbox.email}/contacts/${cid}`, accessToken, {
          method: 'DELETE',
        }),
      ),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') deleted++;
      else failed++;
    }
  }

  logger.info('Bulk deleted contacts', { mailboxId: req.params.id, deleted, failed, total: contactIds.length });
  res.json({ deleted, failed, total: contactIds.length });
});

/**
 * POST /api/mailboxes/:id/contacts/import
 *
 * Import contacts into a contact folder.
 * Body: { folderId: string, contacts: ImportContact[] }
 */
mailboxRouter.post('/:id/contacts/import', async (req: Request, res: Response) => {
  const { folderId, contacts: importContacts } = req.body as {
    folderId?: string;
    contacts?: Array<{
      displayName: string;
      emailAddresses?: Array<{ address: string; name?: string }>;
      companyName?: string;
      department?: string;
      jobTitle?: string;
      businessPhones?: string[];
      mobilePhone?: string;
    }>;
  };

  if (!folderId) throw new ValidationError('folderId is required');
  if (!importContacts || !Array.isArray(importContacts) || importContacts.length === 0) {
    throw new ValidationError('contacts is required and must be a non-empty array');
  }

  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: req.user!.userId,
  });
  if (!mailbox) throw new NotFoundError('Mailbox not found');

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
  const basePath = folderId === 'default'
    ? `/users/${mailbox.email}/contacts`
    : `/users/${mailbox.email}/contactFolders/${folderId}/contacts`;

  let created = 0;
  let failed = 0;

  // Create in parallel batches of 5
  for (let i = 0; i < importContacts.length; i += 5) {
    const batch = importContacts.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map((contact) =>
        graphFetch(basePath, accessToken, {
          method: 'POST',
          body: JSON.stringify({
            displayName: contact.displayName,
            emailAddresses: contact.emailAddresses || [],
            companyName: contact.companyName || null,
            department: contact.department || null,
            jobTitle: contact.jobTitle || null,
            businessPhones: contact.businessPhones || [],
            mobilePhone: contact.mobilePhone || null,
          }),
        }),
      ),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') created++;
      else failed++;
    }
  }

  logger.info('Imported contacts', { mailboxId: req.params.id, created, failed, total: importContacts.length });
  res.json({ created, failed, total: importContacts.length });
});

/**
 * DELETE /api/mailboxes/:id/contacts/:contactId
 *
 * Delete a single contact.
 */
mailboxRouter.delete('/:id/contacts/:contactId', async (req: Request, res: Response) => {
  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: req.user!.userId,
  });
  if (!mailbox) throw new NotFoundError('Mailbox not found');

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
  await graphFetch(`/users/${mailbox.email}/contacts/${req.params.contactId}`, accessToken, {
    method: 'DELETE',
  });

  res.json({ success: true });
});

/**
 * PATCH /api/mailboxes/:id/contacts/:contactId
 *
 * Update a single contact.
 * Body: partial contact fields { displayName?, emailAddresses?, companyName?, department?, jobTitle?, businessPhones?, mobilePhone? }
 */
mailboxRouter.patch('/:id/contacts/:contactId', async (req: Request, res: Response) => {
  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: req.user!.userId,
  });
  if (!mailbox) throw new NotFoundError('Mailbox not found');

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
  const allowedFields = ['displayName', 'emailAddresses', 'companyName', 'department', 'jobTitle', 'businessPhones', 'mobilePhone', 'personalNotes'];
  const updateData: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  }

  const response = await graphFetch(
    `/users/${mailbox.email}/contacts/${req.params.contactId}`,
    accessToken,
    {
      method: 'PATCH',
      body: JSON.stringify(updateData),
    },
  );
  const updated = await response.json();

  res.json({ contact: updated });
});

export default mailboxRouter;
