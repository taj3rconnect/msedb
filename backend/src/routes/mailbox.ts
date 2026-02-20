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
import { graphFetch } from '../services/graphClient.js';
import { config } from '../config/index.js';
import logger from '../config/logger.js';
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js';

const mailboxRouter = Router();

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
  const folderMap = await refreshFolderCache(mailbox.email, accessToken);

  const folders = Array.from(folderMap.entries()).map(([id, displayName]) => ({
    id,
    displayName,
  }));

  res.json({ folders });
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

export default mailboxRouter;
