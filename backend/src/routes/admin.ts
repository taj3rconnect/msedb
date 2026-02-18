import { Router, type Request, type Response } from 'express';
import { User } from '../models/User.js';
import { EmailEvent } from '../models/EmailEvent.js';
import { Rule } from '../models/Rule.js';
import { Pattern } from '../models/Pattern.js';
import { WebhookSubscription } from '../models/WebhookSubscription.js';
import { Mailbox } from '../models/Mailbox.js';
import { requireAuth, requireAdmin } from '../auth/middleware.js';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from '../middleware/errorHandler.js';
import logger from '../config/logger.js';
import { getTunnelStatus, refreshTunnel, updateTunnelUrl } from '../services/tunnelService.js';

const adminRouter = Router();

// All admin routes require authentication and admin role
adminRouter.use(requireAuth, requireAdmin);

// Simple email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/admin/invite
 *
 * Invite a new user by email and optionally assign a role.
 * Returns 409 if the user already exists.
 */
adminRouter.post('/invite', async (req: Request, res: Response) => {
  const { email, role } = req.body as { email?: string; role?: string };

  if (!email || !EMAIL_REGEX.test(email)) {
    throw new ValidationError('A valid email address is required');
  }

  if (role && role !== 'admin' && role !== 'user') {
    throw new ValidationError('Role must be "admin" or "user"');
  }

  const normalizedEmail = email.toLowerCase();

  // Check if user already exists
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    throw new ConflictError('A user with this email already exists');
  }

  const user = await User.create({
    email: normalizedEmail,
    role: role || 'user',
    isActive: true,
    invitedBy: req.user!.userId,
  });

  logger.info('User invited', {
    email: user.email,
    role: user.role,
    invitedBy: req.user!.userId,
  });

  res.status(201).json({
    id: user._id,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
  });
});

/**
 * GET /api/admin/users
 *
 * List all users with key fields.
 */
adminRouter.get('/users', async (_req: Request, res: Response) => {
  const users = await User.find()
    .select('email displayName role isActive lastLoginAt createdAt')
    .sort({ createdAt: -1 });

  res.json(users);
});

/**
 * PATCH /api/admin/users/:id/role
 *
 * Change a user's role. Admin cannot demote themselves.
 */
adminRouter.patch('/users/:id/role', async (req: Request, res: Response) => {
  const { role } = req.body as { role?: string };

  if (!role || (role !== 'admin' && role !== 'user')) {
    throw new ValidationError('Role must be "admin" or "user"');
  }

  // Prevent admin from demoting themselves
  if (req.params.id === req.user!.userId && role !== 'admin') {
    throw new ValidationError('Cannot change your own role');
  }

  const user = await User.findByIdAndUpdate(
    req.params.id,
    { role },
    { new: true },
  );

  if (!user) {
    throw new NotFoundError('User not found');
  }

  logger.info('User role updated', {
    targetUserId: user._id.toString(),
    newRole: role,
    updatedBy: req.user!.userId,
  });

  res.json({
    id: user._id,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
  });
});

/**
 * PATCH /api/admin/users/:id/deactivate
 *
 * Deactivate a user. Admin cannot deactivate themselves.
 */
adminRouter.patch(
  '/users/:id/deactivate',
  async (req: Request, res: Response) => {
    // Prevent admin from deactivating themselves
    if (req.params.id === req.user!.userId) {
      throw new ValidationError('Cannot deactivate your own account');
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true },
    );

    if (!user) {
      throw new NotFoundError('User not found');
    }

    logger.info('User deactivated', {
      targetUserId: user._id.toString(),
      deactivatedBy: req.user!.userId,
    });

    res.json({
      id: user._id,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
    });
  },
);

/**
 * GET /api/admin/analytics
 *
 * Aggregate analytics across all users.
 */
adminRouter.get('/analytics', async (_req: Request, res: Response) => {
  const [totalUsers, activeUsers, totalEvents, totalRules, totalPatterns] =
    await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isActive: true }),
      EmailEvent.countDocuments(),
      Rule.countDocuments({ isEnabled: true }),
      Pattern.countDocuments({ status: { $in: ['detected', 'suggested'] } }),
    ]);

  res.json({
    totalUsers,
    activeUsers,
    totalEvents,
    totalRules,
    totalPatterns,
  });
});

/**
 * GET /api/admin/health
 *
 * System health detail: per-mailbox webhook subscription status and per-user token health.
 */
adminRouter.get('/health', async (_req: Request, res: Response) => {
  const [subscriptions, mailboxes] = await Promise.all([
    WebhookSubscription.find()
      .populate('mailboxId', 'email displayName')
      .populate('userId', 'email displayName')
      .select(
        'subscriptionId status expiresAt lastNotificationAt errorCount mailboxId userId',
      )
      .lean(),
    Mailbox.find()
      .populate('userId', 'email displayName')
      .select('email isConnected encryptedTokens.expiresAt userId lastSyncAt')
      .lean(),
  ]);

  const now = new Date();
  const tokenHealth = mailboxes.map((m) => ({
    mailboxId: m._id,
    email: m.email,
    user: m.userId,
    isConnected: m.isConnected,
    tokenExpiresAt: m.encryptedTokens?.expiresAt,
    tokenHealthy:
      m.isConnected && m.encryptedTokens?.expiresAt
        ? new Date(m.encryptedTokens.expiresAt) > now
        : false,
    lastSyncAt: m.lastSyncAt,
  }));

  res.json({ subscriptions, tokenHealth });
});

/**
 * POST /api/admin/org-rules
 *
 * Create an org-wide rule (scope: 'org') without a mailboxId.
 */
adminRouter.post('/org-rules', async (req: Request, res: Response) => {
  const { name, conditions, actions, isEnabled, priority } = req.body as {
    name?: string;
    conditions?: Record<string, unknown>;
    actions?: unknown[];
    isEnabled?: boolean;
    priority?: number;
  };

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new ValidationError('Rule name is required');
  }

  if (!conditions || typeof conditions !== 'object') {
    throw new ValidationError('Rule conditions are required');
  }

  if (!actions || !Array.isArray(actions) || actions.length === 0) {
    throw new ValidationError('At least one action is required');
  }

  const rule = await Rule.create({
    name: name.trim(),
    conditions,
    actions,
    isEnabled: isEnabled ?? true,
    priority: priority ?? 0,
    scope: 'org',
    userId: req.user!.userId,
    createdBy: req.user!.userId,
  });

  logger.info('Org-wide rule created', {
    ruleId: rule._id.toString(),
    name: rule.name,
    createdBy: req.user!.userId,
  });

  res.status(201).json(rule);
});

/**
 * GET /api/admin/org-rules
 *
 * List all org-wide rules, sorted by priority.
 */
adminRouter.get('/org-rules', async (_req: Request, res: Response) => {
  const rules = await Rule.find({ scope: 'org' })
    .sort({ priority: 1 })
    .lean();

  res.json(rules);
});

/**
 * DELETE /api/admin/org-rules/:id
 *
 * Delete an org-wide rule by ID.
 */
adminRouter.delete('/org-rules/:id', async (req: Request, res: Response) => {
  const rule = await Rule.findOneAndDelete({
    _id: req.params.id,
    scope: 'org',
  });

  if (!rule) {
    throw new NotFoundError('Org-wide rule not found');
  }

  logger.info('Org-wide rule deleted', {
    ruleId: req.params.id,
    deletedBy: req.user!.userId,
  });

  res.json({ success: true });
});

/**
 * GET /api/admin/tunnel-status
 *
 * Return the current tunnel URL, health status, and subscription count.
 */
adminRouter.get('/tunnel-status', async (_req: Request, res: Response) => {
  const status = await getTunnelStatus();
  res.json(status);
});

/**
 * POST /api/admin/tunnel-refresh
 *
 * Restart the cloudflared tunnel container, detect the new URL,
 * update DB and runtime config, and re-sync webhook subscriptions.
 */
adminRouter.post('/tunnel-refresh', async (req: Request, res: Response) => {
  logger.info('Tunnel refresh requested', { requestedBy: req.user!.userId });
  const result = await refreshTunnel();
  res.json(result);
});

/**
 * PUT /api/admin/tunnel-url
 *
 * Manually set the tunnel URL, update DB and runtime config,
 * and re-sync webhook subscriptions.
 */
adminRouter.put('/tunnel-url', async (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };

  if (!url || typeof url !== 'string' || !url.startsWith('https://')) {
    throw new ValidationError('A valid HTTPS URL is required');
  }

  logger.info('Manual tunnel URL update', {
    url,
    updatedBy: req.user!.userId,
  });

  const result = await updateTunnelUrl(url.trim());
  res.json(result);
});

export default adminRouter;
