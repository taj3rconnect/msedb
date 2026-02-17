import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { requireAuth } from '../auth/middleware.js';
import { Rule } from '../models/Rule.js';
import { Mailbox } from '../models/Mailbox.js';
import { AuditLog } from '../models/AuditLog.js';
import { convertPatternToRule } from '../services/ruleConverter.js';
import {
  NotFoundError,
  ValidationError,
} from '../middleware/errorHandler.js';

const rulesRouter = Router();

// All rule routes require authentication
rulesRouter.use(requireAuth);

/**
 * GET /api/rules
 *
 * List rules for the current user with optional mailbox filter.
 * Query params: mailboxId (optional), page (default 1), limit (default 50, max 100)
 */
rulesRouter.get('/', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  // Pagination
  let page = 1;
  if (req.query.page) {
    const parsed = parseInt(req.query.page as string, 10);
    if (!isNaN(parsed) && parsed > 0) {
      page = parsed;
    }
  }

  let limit = 50;
  if (req.query.limit) {
    const parsed = parseInt(req.query.limit as string, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, 100);
    }
  }

  // Build filter
  const filter: Record<string, unknown> = { userId };
  const { mailboxId } = req.query;
  if (mailboxId && typeof mailboxId === 'string') {
    filter.mailboxId = mailboxId;
  }

  // Parallel query + count
  const [rules, total] = await Promise.all([
    Rule.find(filter)
      .sort({ priority: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Rule.countDocuments(filter),
  ]);

  res.json({
    rules,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/**
 * POST /api/rules
 *
 * Create a manual rule (not from pattern).
 * Body: { mailboxId, name, conditions, actions }
 */
rulesRouter.post('/', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { mailboxId, name, conditions, actions } = req.body as {
    mailboxId?: string;
    name?: string;
    conditions?: Record<string, unknown>;
    actions?: Array<{ actionType: string; toFolder?: string; category?: string; order?: number }>;
  };

  // Validate required fields
  if (!mailboxId) {
    throw new ValidationError('mailboxId is required');
  }
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new ValidationError('name is required and must be a non-empty string');
  }
  if (!conditions || Object.keys(conditions).length === 0) {
    throw new ValidationError('At least one condition is required');
  }
  if (!actions || !Array.isArray(actions) || actions.length === 0) {
    throw new ValidationError('At least one action is required');
  }

  // Validate mailbox belongs to user
  const mailbox = await Mailbox.findOne({ _id: mailboxId, userId });
  if (!mailbox) {
    throw new NotFoundError('Mailbox not found');
  }

  // Calculate next priority
  const highestPriorityRule = await Rule.findOne({ userId, mailboxId })
    .sort({ priority: -1 })
    .select('priority')
    .lean();
  const priority = highestPriorityRule ? highestPriorityRule.priority + 1 : 0;

  // Create rule
  const rule = await Rule.create({
    userId,
    mailboxId,
    name: name.trim(),
    isEnabled: true,
    priority,
    conditions,
    actions,
    stats: {
      totalExecutions: 0,
      emailsProcessed: 0,
    },
    scope: 'user',
  });

  // Audit log
  await AuditLog.create({
    userId,
    mailboxId,
    action: 'rule_created',
    targetType: 'rule',
    targetId: rule._id?.toString(),
    details: { name: name.trim(), conditions, actions },
    undoable: false,
  });

  res.status(201).json({ rule });
});

/**
 * POST /api/rules/from-pattern
 *
 * Convert an approved pattern to a rule (AUTO-04).
 * Body: { patternId }
 */
rulesRouter.post('/from-pattern', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { patternId } = req.body as { patternId?: string };

  if (!patternId) {
    throw new ValidationError('patternId is required');
  }

  const rule = await convertPatternToRule(patternId, new Types.ObjectId(userId));

  res.status(201).json({ rule });
});

/**
 * PUT /api/rules/reorder
 *
 * Reorder rules by priority via drag-and-drop.
 * Body: { mailboxId, ruleIds: string[] } -- ordered array of rule IDs
 *
 * NOTE: This route MUST be defined before /:id routes to avoid
 * 'reorder' being captured as an :id parameter.
 */
rulesRouter.put('/reorder', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { mailboxId, ruleIds } = req.body as {
    mailboxId?: string;
    ruleIds?: string[];
  };

  if (!mailboxId) {
    throw new ValidationError('mailboxId is required');
  }
  if (!ruleIds || !Array.isArray(ruleIds) || ruleIds.length === 0) {
    throw new ValidationError('ruleIds must be a non-empty array');
  }

  // Validate all ruleIds belong to user and mailboxId
  const existingRules = await Rule.find({
    _id: { $in: ruleIds },
    userId,
    mailboxId,
  }).select('_id');

  if (existingRules.length !== ruleIds.length) {
    throw new ValidationError('One or more rule IDs are invalid or do not belong to this mailbox');
  }

  // Atomic reorder: set priority to array index for each rule
  const bulkOps = ruleIds.map((ruleId, index) => ({
    updateOne: {
      filter: { _id: ruleId, userId, mailboxId },
      update: { $set: { priority: index } },
    },
  }));

  await Rule.bulkWrite(bulkOps);

  res.json({ success: true });
});

/**
 * PUT /api/rules/:id
 *
 * Update a rule (name, conditions, actions).
 */
rulesRouter.put('/:id', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const rule = await Rule.findOne({ _id: req.params.id, userId });
  if (!rule) {
    throw new NotFoundError('Rule not found');
  }

  const { name, conditions, actions } = req.body as {
    name?: string;
    conditions?: Record<string, unknown>;
    actions?: Array<{ actionType: string; toFolder?: string; category?: string; order?: number }>;
  };

  // Capture before state for audit
  const before = {
    name: rule.name,
    conditions: rule.conditions,
    actions: rule.actions,
  };

  // Update allowed fields only
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new ValidationError('name must be a non-empty string');
    }
    rule.name = name.trim();
  }
  if (conditions !== undefined) {
    rule.conditions = conditions as typeof rule.conditions;
  }
  if (actions !== undefined) {
    rule.actions = actions as typeof rule.actions;
  }

  await rule.save();

  // Audit log
  await AuditLog.create({
    userId,
    mailboxId: rule.mailboxId,
    action: 'rule_updated',
    targetType: 'rule',
    targetId: rule._id?.toString(),
    details: {
      before,
      after: { name: rule.name, conditions: rule.conditions, actions: rule.actions },
    },
    undoable: false,
  });

  res.json({ rule });
});

/**
 * PATCH /api/rules/:id/toggle
 *
 * Enable or disable a rule.
 */
rulesRouter.patch('/:id/toggle', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const rule = await Rule.findOne({ _id: req.params.id, userId });
  if (!rule) {
    throw new NotFoundError('Rule not found');
  }

  rule.isEnabled = !rule.isEnabled;
  await rule.save();

  // Audit log
  await AuditLog.create({
    userId,
    mailboxId: rule.mailboxId,
    action: 'rule_updated',
    targetType: 'rule',
    targetId: rule._id?.toString(),
    details: { toggled: true, isEnabled: rule.isEnabled },
    undoable: false,
  });

  res.json({ rule });
});

/**
 * DELETE /api/rules/:id
 *
 * Delete a rule.
 */
rulesRouter.delete('/:id', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const rule = await Rule.findOne({ _id: req.params.id, userId });
  if (!rule) {
    throw new NotFoundError('Rule not found');
  }

  // Capture details before deletion for audit
  const ruleDetails = {
    name: rule.name,
    conditions: rule.conditions,
    actions: rule.actions,
    priority: rule.priority,
    mailboxId: rule.mailboxId,
  };

  await Rule.deleteOne({ _id: rule._id });

  // Audit log
  await AuditLog.create({
    userId,
    mailboxId: rule.mailboxId,
    action: 'rule_deleted',
    targetType: 'rule',
    targetId: rule._id?.toString(),
    details: ruleDetails,
    undoable: false,
  });

  res.json({ success: true });
});

export { rulesRouter };
