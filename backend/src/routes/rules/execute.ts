import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { getUserId } from '../../auth/middleware.js';
import { Rule } from '../../models/Rule.js';
import { Mailbox } from '../../models/Mailbox.js';
import { EmailEvent } from '../../models/EmailEvent.js';
import { AuditLog } from '../../models/AuditLog.js';
import { getAccessTokenForMailbox } from '../../auth/tokenManager.js';
import { simulateRule, findMatchingMessagesForRule, applyRuleActionsToMessages } from '../../services/ruleEngine.js';
import logger from '../../config/logger.js';
import {
  NotFoundError,
  ValidationError,
} from '../../middleware/errorHandler.js';

const executeRouter = Router();

/**
 * POST /api/rules/simulate
 *
 * Simulate a rule against historical emails without saving or executing.
 * Body: { mailboxId, conditions, dateRange? }
 */
executeRouter.post('/simulate', async (req: Request, res: Response) => {
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
 * POST /api/rules/:id/run
 *
 * Run a rule against the entire mailbox now.
 * Searches for matching messages via Graph API and applies the rule's actions.
 * Returns stats: { matched, applied, failed }.
 */
executeRouter.post('/:id/run', async (req: Request, res: Response) => {
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
executeRouter.post('/:id/simulate', async (req: Request, res: Response) => {
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

export default executeRouter;
