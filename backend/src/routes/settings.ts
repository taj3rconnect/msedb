import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { User } from '../models/User.js';
import { Mailbox } from '../models/Mailbox.js';
import { EmailEvent } from '../models/EmailEvent.js';
import { Pattern } from '../models/Pattern.js';
import { Rule } from '../models/Rule.js';
import { StagedEmail } from '../models/StagedEmail.js';
import { AuditLog } from '../models/AuditLog.js';
import { Notification } from '../models/Notification.js';
import { WebhookSubscription } from '../models/WebhookSubscription.js';

const settingsRouter = Router();

// All settings routes require authentication
settingsRouter.use(requireAuth);

/**
 * GET /api/settings
 *
 * Return current user settings including profile and mailbox connection status.
 * NEVER exposes encrypted token data.
 */
settingsRouter.get('/', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const [user, mailboxes] = await Promise.all([
    User.findById(userId)
      .select('email displayName preferences createdAt')
      .lean(),
    Mailbox.find({ userId })
      .select('email displayName isConnected encryptedTokens.expiresAt lastSyncAt settings createdAt')
      .lean(),
  ]);

  const now = new Date();
  const safeMailboxes = mailboxes.map((m) => ({
    id: m._id,
    email: m.email,
    displayName: m.displayName,
    isConnected: m.isConnected,
    tokenExpiresAt: m.encryptedTokens?.expiresAt,
    tokenHealthy:
      m.isConnected && m.encryptedTokens?.expiresAt
        ? new Date(m.encryptedTokens.expiresAt) > now
        : false,
    lastSyncAt: m.lastSyncAt,
    whitelistedSenders: m.settings?.whitelistedSenders ?? [],
    whitelistedDomains: m.settings?.whitelistedDomains ?? [],
    createdAt: m.createdAt,
  }));

  res.json({ user, mailboxes: safeMailboxes });
});

/**
 * GET /api/settings/export-data
 *
 * Export all user data as a downloadable JSON file.
 * Uses .lean() on all queries for memory efficiency.
 */
settingsRouter.get('/export-data', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const [user, mailboxes, rules, patterns, events, auditLogs] = await Promise.all([
    User.findById(userId).select('email displayName preferences createdAt').lean(),
    Mailbox.find({ userId }).select('email displayName settings createdAt').lean(),
    Rule.find({ userId }).select('-__v').lean(),
    Pattern.find({ userId }).select('-__v').lean(),
    EmailEvent.find({ userId })
      .sort({ createdAt: -1 })
      .limit(10000)
      .select('-__v')
      .lean(),
    AuditLog.find({ userId })
      .sort({ createdAt: -1 })
      .limit(5000)
      .select('-__v')
      .lean(),
  ]);

  const dateStr = new Date().toISOString().slice(0, 10);

  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="msedb-export-${dateStr}.json"`,
  );

  res.json({
    exportedAt: new Date().toISOString(),
    user,
    mailboxes,
    rules,
    patterns,
    events,
    auditLogs,
  });
});

/**
 * DELETE /api/settings/delete-data
 *
 * Delete all user data and account. Clears the session cookie.
 * This is a destructive, irreversible action.
 */
settingsRouter.delete('/delete-data', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  // Delete all user data across collections
  await Promise.all([
    EmailEvent.deleteMany({ userId }),
    Pattern.deleteMany({ userId }),
    Rule.deleteMany({ userId }),
    StagedEmail.deleteMany({ userId }),
    AuditLog.deleteMany({ userId }),
    Notification.deleteMany({ userId }),
    WebhookSubscription.deleteMany({ userId }),
    Mailbox.deleteMany({ userId }),
  ]);

  // Finally delete the user record
  await User.findByIdAndDelete(userId);

  // Clear the session cookie
  res.clearCookie('msedb_session');
  res.json({ message: 'All data deleted successfully' });
});

export { settingsRouter };
