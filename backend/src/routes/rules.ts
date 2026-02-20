import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { requireAuth } from '../auth/middleware.js';
import { Rule } from '../models/Rule.js';
import { Mailbox } from '../models/Mailbox.js';
import { EmailEvent } from '../models/EmailEvent.js';
import { AuditLog } from '../models/AuditLog.js';
import { convertPatternToRule } from '../services/ruleConverter.js';
import { getAccessTokenForMailbox } from '../auth/tokenManager.js';
import { graphFetch } from '../services/graphClient.js';
import logger from '../config/logger.js';
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
  const { mailboxId, search } = req.query;
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

  // Parallel query + count
  const [rules, total] = await Promise.all([
    Rule.find(filter)
      .sort({ createdAt: -1 })
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
  const { mailboxId, name, conditions, actions, skipStaging } = req.body as {
    mailboxId?: string;
    name?: string;
    conditions?: Record<string, unknown>;
    actions?: Array<{ actionType: string; toFolder?: string; category?: string; order?: number }>;
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
      // Same sender + same actions — return existing, re-enable if disabled
      existing.name = name.trim();
      if (skipStaging) existing.skipStaging = true;
      existing.isEnabled = true;
      await existing.save();

      res.status(200).json({ rule: existing });
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
 * POST /api/rules/:id/run
 *
 * Run a rule against the entire mailbox now.
 * Searches for matching messages via Graph API and applies the rule's actions.
 * Returns stats: { matched, applied, failed }.
 */
rulesRouter.post('/:id/run', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

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

  // Build Graph API query from rule conditions.
  // NOTE: $search (KQL) and $filter CANNOT be combined for messages in Graph API.
  // Strategy: use $search with KQL "from:email" for sender matching (case-insensitive),
  // and do all other filtering (isRead, domain, subject, body) client-side.
  const { conditions } = rule;

  const senders = conditions.senderEmail
    ? Array.isArray(conditions.senderEmail)
      ? conditions.senderEmail
      : [conditions.senderEmail]
    : [];

  // Build KQL $search for sender email(s)
  // Graph API wraps $search value in outer quotes: $search="from:email"
  // Do NOT add inner quotes — they cause nested quote parse errors.
  let searchStr = '';
  if (senders.length === 1) {
    searchStr = `&$search="${encodeURIComponent(`from:${senders[0]}`)}"`;
  } else if (senders.length > 1) {
    const kql = senders.map((s) => `from:${s}`).join(' OR ');
    searchStr = `&$search="${encodeURIComponent(kql)}"`;
  }

  // markRead-only: we need isRead field for client-side filtering
  const isMarkReadOnly = rule.actions.length > 0 && rule.actions.every((a) => a.actionType === 'markRead');

  // Select fields needed for client-side filtering
  const selectParts = ['id', 'from'];
  if (isMarkReadOnly) selectParts.push('isRead');
  if (conditions.subjectContains || conditions.bodyContains) selectParts.push('subject', 'bodyPreview');
  const selectFields = [...new Set(selectParts)].join(',');

  // Fetch all matching messages from the mailbox (paginated via @odata.nextLink)
  const allMessages: { id: string; isRead?: boolean; from?: { emailAddress: { address?: string } }; subject?: string; bodyPreview?: string }[] = [];
  const initialUrl = `/users/${email}/messages?$select=${selectFields}&$top=100${searchStr}`;
  logger.info('RunRule: fetching messages', { initialUrl, senders, email });
  let nextUrl: string | null = initialUrl;

  while (nextUrl) {
    const response = await graphFetch(nextUrl, accessToken);
    const data = (await response.json()) as {
      value: typeof allMessages;
      '@odata.nextLink'?: string;
    };
    for (const msg of data.value) {
      allMessages.push(msg);
    }
    nextUrl = data['@odata.nextLink'] ?? null;
  }

  logger.info('RunRule: fetch complete', { totalFetched: allMessages.length, sampleFrom: allMessages.slice(0, 3).map((m) => m.from?.emailAddress?.address) });

  // Client-side filtering — KQL $search is fuzzy, so we do exact matching here
  let filteredMessages = allMessages;

  // Exact sender email match (KQL from: can return partial matches)
  if (senders.length > 0) {
    const senderSet = new Set(senders.map((s) => s.toLowerCase()));
    filteredMessages = filteredMessages.filter((msg) => {
      const addr = msg.from?.emailAddress?.address?.toLowerCase() ?? '';
      return senderSet.has(addr);
    });
  }

  // markRead-only: skip already-read messages
  if (isMarkReadOnly) {
    filteredMessages = filteredMessages.filter((msg) => !msg.isRead);
  }

  // senderDomain: client-side endsWith
  if (conditions.senderDomain) {
    const domainLower = conditions.senderDomain.toLowerCase();
    filteredMessages = filteredMessages.filter((msg) => {
      const addr = msg.from?.emailAddress?.address?.toLowerCase() ?? '';
      const domain = addr.split('@')[1] ?? '';
      return domain === domainLower;
    });
  }

  // subjectContains: client-side case-insensitive
  if (conditions.subjectContains) {
    const needle = conditions.subjectContains.toLowerCase();
    filteredMessages = filteredMessages.filter(
      (msg) => (msg.subject ?? '').toLowerCase().includes(needle),
    );
  }

  // bodyContains: client-side case-insensitive (uses bodyPreview)
  if (conditions.bodyContains) {
    const needle = conditions.bodyContains.toLowerCase();
    filteredMessages = filteredMessages.filter(
      (msg) => (msg.bodyPreview ?? '').toLowerCase().includes(needle),
    );
  }

  const allMessageIds = filteredMessages.map((m) => m.id);
  const matched = allMessageIds.length;

  // Apply rule actions to each message
  let applied = 0;
  let failed = 0;

  for (const msgId of allMessageIds) {
    try {
      for (const action of rule.actions) {
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
          case 'archive':
            await graphFetch(
              `/users/${email}/messages/${msgId}/move`,
              accessToken,
              {
                method: 'POST',
                body: JSON.stringify({ destinationId: 'archive' }),
              },
            );
            break;
        }
      }
      applied++;
    } catch (err) {
      failed++;
      logger.warn('Failed to apply rule action to message', {
        ruleId: rule._id?.toString(),
        messageId: msgId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

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
