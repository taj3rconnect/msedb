import { Router, type Request, type Response } from 'express';
import { Mailbox } from '../../models/Mailbox.js';
import { AuditLog } from '../../models/AuditLog.js';
import { requireAdmin, getUserId } from '../../auth/middleware.js';
import {
  addToOrgWhitelist,
  removeFromOrgWhitelist,
  getOrgWhitelist,
} from '../../services/whitelistService.js';
import { NotFoundError, ValidationError } from '../../middleware/errorHandler.js';

const whitelistRouter = Router();

// ---- Org-wide whitelist routes (admin only) ----
// NOTE: These MUST be defined before /:id routes to avoid 'org-whitelist' being captured as an :id.

/**
 * GET /api/mailboxes/org-whitelist
 *
 * Get org-wide whitelist (admin only).
 */
whitelistRouter.get(
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
whitelistRouter.put(
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

// ---- Per-mailbox whitelist endpoints ----

/**
 * GET /api/mailboxes/:id/whitelist
 *
 * Get per-mailbox whitelist.
 */
whitelistRouter.get('/:id/whitelist', async (req: Request, res: Response) => {
  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: getUserId(req),
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
whitelistRouter.put('/:id/whitelist', async (req: Request, res: Response) => {
  const userId = getUserId(req);

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

export default whitelistRouter;
