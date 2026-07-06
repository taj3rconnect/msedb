import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { requireAuth, getUserId } from '../auth/middleware.js';
import { Rule } from '../models/Rule.js';
import { Mailbox } from '../models/Mailbox.js';
import { EmailEvent } from '../models/EmailEvent.js';
import { AuditLog } from '../models/AuditLog.js';
import { convertPatternToRule } from '../services/ruleConverter.js';
import { getAccessTokenForMailbox } from '../auth/tokenManager.js';
import { syncRuleToGraph, deleteGraphRule, syncAllRulesToGraph } from '../services/graphRuleSync.js';
import { simulateRule, findMatchingMessagesForRule, applyRuleActionsToMessages } from '../services/ruleEngine.js';
import logger from '../config/logger.js';
import {
  NotFoundError,
  ValidationError,
} from '../middleware/errorHandler.js';
import { parsePagination } from '../utils/pagination.js';

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
  const userId = getUserId(req);

  // Pagination
  const { page, limit } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 100 });

  // Build filter
  const filter: Record<string, unknown> = { userId };
  const { mailboxId, search, sort } = req.query;
  if (mailboxId && typeof mailboxId === 'string') {
    filter.mailboxId = mailboxId;
  }
  if (search && typeof search === 'string' && search.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = { $regex: escaped, $options: 'i' };
    filter.$or = [
      { name: regex },
      { 'conditions.senderEmail': regex },
      { 'conditions.senderDomain': regex },
      { 'conditions.subjectContains': regex },
      { 'conditions.bodyContains': regex },
    ];
  }

  // For email/domain sorts, use aggregation to extract and sort by computed field
  let rules: unknown[];
  let total: number;

  if (sort === 'email' || sort === 'domain') {
    const aggFilter: Record<string, unknown> = { ...filter, userId: new Types.ObjectId(userId) };
    if (mailboxId && typeof mailboxId === 'string') {
      aggFilter.mailboxId = new Types.ObjectId(mailboxId);
    }
    // Extract first email if array, fall back to empty string
    const emailExpr = {
      $toLower: {
        $cond: [
          { $isArray: '$conditions.senderEmail' },
          { $ifNull: [{ $arrayElemAt: ['$conditions.senderEmail', 0] }, ''] },
          { $ifNull: ['$conditions.senderEmail', ''] },
        ],
      },
    };
    const sortKey = sort === 'domain'
      ? { $toLower: { $ifNull: ['$conditions.senderDomain', { $arrayElemAt: [{ $split: [emailExpr, '@'] }, 1] }] } }
      : emailExpr;

    [rules, total] = await Promise.all([
      Rule.aggregate([
        { $match: aggFilter },
        { $addFields: { _sortKey: sortKey } },
        { $sort: { _sortKey: 1, createdAt: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
        { $project: { _sortKey: 0 } },
      ]),
      Rule.countDocuments(filter),
    ]);
  } else {
    [rules, total] = await Promise.all([
      Rule.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Rule.countDocuments(filter),
    ]);
  }

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
  const userId = getUserId(req);
  const { mailboxId, name, conditions, actions, skipStaging } = req.body as {
    mailboxId?: string;
    name?: string;
    conditions?: Record<string, unknown>;
    actions?: Array<{ actionType: string; toFolder?: string; category?: string; forwardTo?: string[]; order?: number }>;
    skipStaging?: boolean;
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

  // Deduplicate: if a rule with the same senderEmail AND same action types
  // already exists, return it. Different action types get separate rules.
  // Uses findOneAndUpdate to prevent race conditions from concurrent requests.
  const senderEmail = conditions.senderEmail;
  if (senderEmail && typeof senderEmail === 'string') {
    const requestedTypes = actions.map((a) => a.actionType).sort().join(',');
    const candidates = await Rule.find({
      userId,
      mailboxId,
      'conditions.senderEmail': senderEmail,
    });
    const existing = candidates.find((r) => {
      const existingTypes = r.actions.map((a) => a.actionType).sort().join(',');
      return existingTypes === requestedTypes;
    });
    if (existing) {
      const updated = await Rule.findOneAndUpdate(
        { _id: existing._id },
        {
          $set: {
            name: name.trim(),
            isEnabled: true,
            ...(skipStaging ? { skipStaging: true } : {}),
          },
        },
        { new: true },
      );

      // Ensure Graph inbox rule exists / is re-enabled
      try {
        const accessToken = await getAccessTokenForMailbox(mailboxId);
        await syncRuleToGraph(existing._id.toString(), mailbox.email, accessToken);
      } catch (err) {
        logger.warn('Failed to sync existing rule to Graph inbox', {
          ruleId: existing._id?.toString(),
          error: err instanceof Error ? err.message : String(err),
        });
      }

      res.status(200).json({ rule: updated });
      return;
    }
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
    skipStaging: skipStaging ?? false,
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

  // Sync to Graph inbox rule (server-side, so future emails are processed before reaching client)
  try {
    const accessToken = await getAccessTokenForMailbox(mailboxId);
    await syncRuleToGraph(rule._id.toString(), mailbox.email, accessToken);
  } catch (err) {
    logger.warn('Failed to sync new rule to Graph inbox', {
      ruleId: rule._id?.toString(),
      error: err instanceof Error ? err.message : String(err),
    });
  }

  res.status(201).json({ rule });
});

/**
 * POST /api/rules/from-pattern
 *
 * Convert an approved pattern to a rule (AUTO-04).
 * Body: { patternId }
 */
rulesRouter.post('/from-pattern', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { patternId } = req.body as { patternId?: string };

  if (!patternId) {
    throw new ValidationError('patternId is required');
  }

  const rule = await convertPatternToRule(patternId, new Types.ObjectId(userId));

  res.status(201).json({ rule });
});

/**
 * POST /api/rules/sync-to-graph
 *
 * Bulk-sync all enabled rules for a mailbox to Graph inbox rules.
 * Body: { mailboxId }
 */
rulesRouter.post('/sync-to-graph', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { mailboxId } = req.body as { mailboxId?: string };

  if (!mailboxId) {
    throw new ValidationError('mailboxId is required');
  }

  const mailbox = await Mailbox.findOne({ _id: mailboxId, userId });
  if (!mailbox) {
    throw new NotFoundError('Mailbox not found');
  }

  const accessToken = await getAccessTokenForMailbox(mailboxId);
  const result = await syncAllRulesToGraph(userId, mailboxId, mailbox.email, accessToken);

  res.json(result);
});

/**
 * POST /api/rules/simulate
 *
 * Simulate a rule against historical emails without saving or executing.
 * Body: { mailboxId, conditions, dateRange? }
 */
rulesRouter.post('/simulate', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { mailboxId, conditions, dateRange } = req.body as {
    mailboxId?: string;
    conditions?: Record<string, unknown>;
    dateRange?: '30d' | '60d' | '90d';
  };

  if (!mailboxId) {
    throw new ValidationError('mailboxId is required');
  }
  if (!conditions || Object.keys(conditions).length === 0) {
    throw new ValidationError('At least one condition is required');
  }

  // Validate mailbox belongs to user
  const mailbox = await Mailbox.findOne({ _id: mailboxId, userId });
  if (!mailbox) {
    throw new NotFoundError('Mailbox not found');
  }

  const result = await simulateRule(userId, mailboxId, conditions as Parameters<typeof simulateRule>[2], dateRange);
  res.json(result);
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
  const userId = getUserId(req);
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
  const userId = getUserId(req);

  const rule = await Rule.findOne({ _id: req.params.id, userId });
  if (!rule) {
    throw new NotFoundError('Rule not found');
  }

  const { name, conditions, actions } = req.body as {
    name?: string;
    conditions?: Record<string, unknown>;
    actions?: Array<{ actionType: string; toFolder?: string; category?: string; forwardTo?: string[]; order?: number }>;
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
  const userId = getUserId(req);

  const rule = await Rule.findOne({ _id: req.params.id, userId });
  if (!rule) {
    throw new NotFoundError('Rule not found');
  }

  rule.isEnabled = !rule.isEnabled;
  await rule.save();

  // Sync enable/disable to Graph inbox rule
  if (rule.mailboxId) {
    try {
      const mailbox = await Mailbox.findById(rule.mailboxId);
      if (mailbox) {
        const accessToken = await getAccessTokenForMailbox(rule.mailboxId.toString());
        await syncRuleToGraph(rule._id.toString(), mailbox.email, accessToken);
      }
    } catch (err) {
      logger.warn('Failed to sync toggle to Graph inbox rule', {
        ruleId: rule._id?.toString(),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

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
 * POST /api/rules/:id/run
 *
 * Run a rule against the entire mailbox now.
 * Searches for matching messages via Graph API and applies the rule's actions.
 * Returns stats: { matched, applied, failed }.
 */
rulesRouter.post('/:id/run', async (req: Request, res: Response) => {
  const userId = getUserId(req);

  const rule = await Rule.findOne({ _id: req.params.id, userId });
  if (!rule) {
    throw new NotFoundError('Rule not found');
  }
  if (!rule.mailboxId) {
    throw new ValidationError('Rule has no associated mailbox');
  }

  const mailbox = await Mailbox.findOne({ _id: rule.mailboxId, userId });
  if (!mailbox) {
    throw new NotFoundError('Mailbox not found');
  }

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
  const email = mailbox.email;

  const { conditions } = rule;

  // senderEmail(s) — also needed below for the bulk isRead-by-sender update
  const senders = conditions.senderEmail
    ? Array.isArray(conditions.senderEmail)
      ? conditions.senderEmail
      : [conditions.senderEmail]
    : [];

  // Find matching messages (Graph fetch + client-side condition filter)
  const filteredMessages = await findMatchingMessagesForRule(email, accessToken, conditions);
  const allMessageIds = filteredMessages.map((m) => m.id);
  const matched = allMessageIds.length;

  // Apply rule actions to each matched message
  const { applied, failed } = await applyRuleActionsToMessages({
    email,
    accessToken,
    actions: rule.actions,
    messageIds: allMessageIds,
    userId,
    mailboxId: rule.mailboxId,
    ruleId: rule._id!.toString(),
  });

  // Record 'deleted' EmailEvent records for messages that were deleted,
  // so the excludeDeleted filter removes them from inbox listings.
  const hasDeleteAction = rule.actions.some((a) => a.actionType === 'delete');
  if (hasDeleteAction && applied > 0) {
    const deletedMsgIds = allMessageIds.slice(0, applied); // approximate: first N succeeded
    const bulkOps = deletedMsgIds.map((msgId) => ({
      updateOne: {
        filter: {
          userId: new Types.ObjectId(userId),
          mailboxId: rule.mailboxId,
          messageId: msgId,
          eventType: 'deleted' as const,
        },
        update: {
          $setOnInsert: {
            userId: new Types.ObjectId(userId),
            mailboxId: rule.mailboxId,
            messageId: msgId,
            eventType: 'deleted' as const,
            timestamp: new Date(),
            sender: {},
            importance: 'normal' as const,
            hasAttachments: false,
            categories: [],
            isRead: false,
            metadata: { automatedByRule: rule._id },
          },
        },
        upsert: true,
      },
    }));
    try {
      await EmailEvent.bulkWrite(bulkOps);
    } catch (err) {
      logger.warn('Failed to record deleted events', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Bulk-update isRead in our DB for markRead rules — mark ALL emails from this sender
  const hasMarkReadAction = rule.actions.some((a) => a.actionType === 'markRead');
  if (hasMarkReadAction) {
    const senderFilter: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
      mailboxId: rule.mailboxId,
      isRead: false,
    };
    // Match by sender email(s) from rule conditions
    if (senders.length === 1) {
      senderFilter['sender.email'] = { $regex: `^${senders[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' };
    } else if (senders.length > 1) {
      senderFilter['sender.email'] = {
        $in: senders.map((s) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')),
      };
    }
    try {
      const result = await EmailEvent.updateMany(senderFilter, { $set: { isRead: true } });
      logger.info('Bulk updated isRead in DB', { modified: result.modifiedCount });
    } catch (err) {
      logger.warn('Failed to bulk update isRead', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Update rule stats
  rule.stats.totalExecutions += 1;
  rule.stats.lastExecutedAt = new Date();
  rule.stats.emailsProcessed += applied;
  await rule.save();

  // Audit log
  await AuditLog.create({
    userId,
    mailboxId: rule.mailboxId,
    action: 'rule_executed',
    targetType: 'rule',
    targetId: rule._id?.toString(),
    details: { matched, applied, failed },
    undoable: false,
  });

  logger.info('Rule executed manually', {
    ruleId: rule._id?.toString(),
    matched,
    applied,
    failed,
  });

  res.json({ matched, applied, failed });
});

/**
 * POST /api/rules/:id/simulate
 *
 * Simulate a saved rule against historical emails.
 * Body: { dateRange? } — optional override (default 30d)
 */
rulesRouter.post('/:id/simulate', async (req: Request, res: Response) => {
  const userId = getUserId(req);

  const rule = await Rule.findOne({ _id: req.params.id, userId });
  if (!rule) {
    throw new NotFoundError('Rule not found');
  }
  if (!rule.mailboxId) {
    throw new ValidationError('Rule has no associated mailbox');
  }

  const { dateRange } = req.body as { dateRange?: '30d' | '60d' | '90d' };

  const result = await simulateRule(
    userId,
    rule.mailboxId.toString(),
    rule.conditions,
    dateRange,
  );

  res.json(result);
});

/**
 * POST /api/rules/delete-by-sender
 *
 * Delete all rules matching a sender email across all connected mailboxes.
 * Body: { senderEmail: string }
 */
rulesRouter.post('/delete-by-sender', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { senderEmail } = req.body as { senderEmail?: string };

  if (!senderEmail) throw new ValidationError('senderEmail is required');

  const senderLower = senderEmail.toLowerCase();

  // Find all rules for this user that match this sender
  const rules = await Rule.find({ userId });
  const matching = rules.filter((rule) => {
    const cond = rule.conditions.senderEmail;
    if (!cond) return false;
    const emails = Array.isArray(cond) ? cond : [cond];
    return emails.some((e) => e.toLowerCase() === senderLower);
  });

  let deleted = 0;
  let failed = 0;

  for (const rule of matching) {
    try {
      // Delete Graph inbox rule
      if (rule.graphRuleId && rule.mailboxId) {
        try {
          const mailbox = await Mailbox.findById(rule.mailboxId);
          if (mailbox) {
            const accessToken = await getAccessTokenForMailbox(rule.mailboxId.toString());
            await deleteGraphRule(rule._id.toString(), mailbox.email, accessToken);
          }
        } catch (err) {
          logger.warn('Failed to delete Graph inbox rule during bulk sender delete', {
            ruleId: rule._id?.toString(),
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      await Rule.deleteOne({ _id: rule._id });

      await AuditLog.create({
        userId,
        mailboxId: rule.mailboxId,
        action: 'rule_deleted',
        targetType: 'rule',
        targetId: rule._id?.toString(),
        details: { name: rule.name, conditions: rule.conditions, actions: rule.actions },
        undoable: false,
      });

      deleted++;
    } catch {
      failed++;
    }
  }

  logger.info('Deleted rules by sender', {
    userId,
    senderEmail: senderLower,
    deleted,
    failed,
    total: matching.length,
  });

  res.json({ deleted, failed, total: matching.length });
});

/**
 * DELETE /api/rules/:id
 *
 * Delete a rule.
 */
rulesRouter.delete('/:id', async (req: Request, res: Response) => {
  const userId = getUserId(req);

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

  // Delete the Graph inbox rule first
  if (rule.graphRuleId && rule.mailboxId) {
    try {
      const mailbox = await Mailbox.findById(rule.mailboxId);
      if (mailbox) {
        const accessToken = await getAccessTokenForMailbox(rule.mailboxId.toString());
        await deleteGraphRule(rule._id.toString(), mailbox.email, accessToken);
      }
    } catch (err) {
      logger.warn('Failed to delete Graph inbox rule', {
        ruleId: rule._id?.toString(),
        graphRuleId: rule.graphRuleId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

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
