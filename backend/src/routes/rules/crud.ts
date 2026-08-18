import { Router, type Request, type Response } from 'express';
import { getUserId } from '../../auth/middleware.js';
import { Rule } from '../../models/Rule.js';
import { Mailbox } from '../../models/Mailbox.js';
import { AuditLog } from '../../models/AuditLog.js';
import { StagedEmail } from '../../models/StagedEmail.js';
import { getAccessTokenForMailbox } from '../../auth/tokenManager.js';
import { syncRuleToGraph, deleteGraphRule } from '../../services/graphRuleSync.js';
import logger from '../../config/logger.js';
import {
  NotFoundError,
  ValidationError,
} from '../../middleware/errorHandler.js';

const crudRouter = Router();

/**
 * True when `value` is a plain 24-hex-char ObjectId string. Request-body
 * fields destined for a Mongoose filter must pass this before use --
 * without it, a JSON object like `{"$ne":null}` survives the `!mailboxId`
 * truthiness check and reaches the query as a live operator.
 */
function isValidObjectIdString(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value);
}

/**
 * POST /api/rules
 *
 * Create a manual rule (not from pattern).
 * Body: { mailboxId, name, conditions, actions }
 */
crudRouter.post('/', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { mailboxId, name, conditions, actions, skipStaging } = req.body as {
    mailboxId?: string;
    name?: string;
    conditions?: Record<string, unknown>;
    actions?: Array<{ actionType: string; toFolder?: string; category?: string; forwardTo?: string[]; order?: number }>;
    skipStaging?: boolean;
  };

  // Validate required fields
  if (!isValidObjectIdString(mailboxId)) {
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
 * PUT /api/rules/reorder
 *
 * Reorder rules by priority via drag-and-drop.
 * Body: { mailboxId, ruleIds: string[] } -- ordered array of rule IDs
 *
 * NOTE: This route MUST be defined before /:id routes to avoid
 * 'reorder' being captured as an :id parameter.
 */
crudRouter.put('/reorder', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { mailboxId, ruleIds } = req.body as {
    mailboxId?: string;
    ruleIds?: string[];
  };

  if (!isValidObjectIdString(mailboxId)) {
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
crudRouter.put('/:id', async (req: Request, res: Response) => {
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

  // Sync edited conditions/actions to Graph inbox rule (create/toggle already do this;
  // without it, the Graph rule keeps acting on the mailbox per its old definition)
  if (rule.mailboxId) {
    try {
      const mailbox = await Mailbox.findById(rule.mailboxId);
      if (mailbox) {
        const accessToken = await getAccessTokenForMailbox(rule.mailboxId.toString());
        await syncRuleToGraph(rule._id.toString(), mailbox.email, accessToken);
      }
    } catch (err) {
      logger.warn('Failed to sync rule update to Graph inbox rule', {
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
crudRouter.patch('/:id/toggle', async (req: Request, res: Response) => {
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
 * POST /api/rules/delete-by-sender
 *
 * Delete all rules matching a sender email across all connected mailboxes.
 * Body: { senderEmail: string }
 */
crudRouter.post('/delete-by-sender', async (req: Request, res: Response) => {
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

      // Retire (never delete) staged emails still pointing at this rule, so the
      // deleted rule leaves no dangling StagedEmail.ruleId reference.
      await StagedEmail.updateMany(
        { ruleId: rule._id, status: 'staged' },
        { $set: { status: 'expired' } }
      );

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
    } catch (err) {
      failed++;
      logger.warn('Failed to delete rule by sender', {
        ruleId: rule._id?.toString(),
        error: err instanceof Error ? err.message : String(err),
      });
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
crudRouter.delete('/:id', async (req: Request, res: Response) => {
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

  // Retire (never delete) staged emails still pointing at this rule, so the
  // deleted rule leaves no dangling StagedEmail.ruleId reference.
  await StagedEmail.updateMany(
    { ruleId: rule._id, status: 'staged' },
    { $set: { status: 'expired' } }
  );

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

export default crudRouter;
