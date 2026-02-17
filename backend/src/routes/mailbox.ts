import { Router, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { Mailbox } from '../models/Mailbox.js';
import { AuditLog } from '../models/AuditLog.js';
import { requireAuth, requireAdmin } from '../auth/middleware.js';
import { createLoginMsalClient, GRAPH_SCOPES } from '../auth/msalClient.js';
import {
  addToOrgWhitelist,
  removeFromOrgWhitelist,
  getOrgWhitelist,
} from '../services/whitelistService.js';
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
