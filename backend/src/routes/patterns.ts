import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { requireAuth } from '../auth/middleware.js';
import { Pattern } from '../models/Pattern.js';
import { Rule } from '../models/Rule.js';
import { AuditLog } from '../models/AuditLog.js';
import { User } from '../models/User.js';
import { queues } from '../jobs/queues.js';
import { convertPatternToRule } from '../services/ruleConverter.js';
import logger from '../config/logger.js';
import {
  NotFoundError,
  ConflictError,
  ValidationError,
} from '../middleware/errorHandler.js';

const patternsRouter = Router();

// All pattern routes require authentication
patternsRouter.use(requireAuth);

// Valid action types for customization
const VALID_ACTION_TYPES = ['delete', 'move', 'archive', 'markRead', 'flag', 'categorize'] as const;

/**
 * GET /api/patterns
 *
 * Returns paginated patterns for the authenticated user.
 * Query params: mailboxId (optional), status (optional, comma-separated), page, limit
 */
patternsRouter.get('/', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { mailboxId, status, hasRule, search } = req.query;

  // Pagination
  let page = 1;
  if (req.query.page) {
    const parsed = parseInt(req.query.page as string, 10);
    if (!isNaN(parsed) && parsed > 0) {
      page = parsed;
    }
  }

  let limit = 20;
  if (req.query.limit) {
    const parsed = parseInt(req.query.limit as string, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, 100);
    }
  }

  // Build filter using $and to safely combine multiple $or clauses
  const filterClauses: Record<string, unknown>[] = [{ userId }];
  if (mailboxId && typeof mailboxId === 'string') {
    filterClauses.push({ mailboxId });
  }
  if (status && typeof status === 'string') {
    const statuses = status.split(',').map((s) => s.trim()).filter(Boolean);
    if (statuses.length === 1) {
      filterClauses.push({ status: statuses[0] });
    } else if (statuses.length > 1) {
      filterClauses.push({ status: { $in: statuses } });
    }
  }

  // Search filter: case-insensitive match on sender email, domain, or subject pattern
  if (search && typeof search === 'string' && search.trim()) {
    const searchRegex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filterClauses.push({
      $or: [
        { 'condition.senderEmail': searchRegex },
        { 'condition.senderDomain': searchRegex },
        { 'condition.subjectPattern': searchRegex },
      ],
    });
  }

  // If hasRule filter is specified, pre-lookup rules by sourcePatternId OR sender email/domain
  // so pagination reflects the correct filtered total. Rules created via quick actions (Ban/Delete,
  // MarkRead) don't have sourcePatternId but match on conditions.senderEmail/senderDomain.
  if (hasRule === 'true' || hasRule === 'false') {
    const ruleQuery: Record<string, unknown> = { userId };
    if (mailboxId && typeof mailboxId === 'string') ruleQuery.mailboxId = mailboxId;
    const rulesAll = await Rule.find(ruleQuery)
      .select('sourcePatternId conditions.senderEmail conditions.senderDomain')
      .lean();

    const rulePatternIds = rulesAll.map((r) => r.sourcePatternId?.toString()).filter(Boolean) as string[];
    const ruleSenderEmails = rulesAll
      .flatMap((r) =>
        Array.isArray(r.conditions?.senderEmail)
          ? r.conditions.senderEmail
          : r.conditions?.senderEmail
            ? [r.conditions.senderEmail]
            : [],
      )
      .filter(Boolean) as string[];
    const ruleSenderDomains = rulesAll
      .map((r) => r.conditions?.senderDomain)
      .filter(Boolean) as string[];

    const matchClauses: Record<string, unknown>[] = [];
    if (rulePatternIds.length) matchClauses.push({ _id: { $in: rulePatternIds.map((id) => new Types.ObjectId(id)) } });
    if (ruleSenderEmails.length) matchClauses.push({ 'condition.senderEmail': { $in: ruleSenderEmails } });
    if (ruleSenderDomains.length) matchClauses.push({ 'condition.senderDomain': { $in: ruleSenderDomains } });

    if (hasRule === 'true') {
      filterClauses.push(matchClauses.length ? { $or: matchClauses } : { _id: { $in: [] } });
    } else {
      if (matchClauses.length) filterClauses.push({ $nor: matchClauses });
    }
  }

  const filter = filterClauses.length === 1 ? filterClauses[0] : { $and: filterClauses };

  // Parallel query + count
  const [patterns, total] = await Promise.all([
    Pattern.find(filter)
      .sort({ confidence: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Pattern.countDocuments(filter),
  ]);

  // Enrich patterns with hasRule — match by sourcePatternId OR sender email/domain
  const patternIds = patterns.map((p) => p._id);
  const patternSenderEmails = patterns.map((p) => p.condition?.senderEmail).filter(Boolean) as string[];
  const patternSenderDomains = patterns.map((p) => p.condition?.senderDomain).filter(Boolean) as string[];

  const enrichOrClauses: Record<string, unknown>[] = [{ sourcePatternId: { $in: patternIds } }];
  if (patternSenderEmails.length) enrichOrClauses.push({ 'conditions.senderEmail': { $in: patternSenderEmails } });
  if (patternSenderDomains.length) enrichOrClauses.push({ 'conditions.senderDomain': { $in: patternSenderDomains } });

  const rulesForPatterns = await Rule.find({ userId, $or: enrichOrClauses })
    .select('_id sourcePatternId conditions.senderEmail conditions.senderDomain')
    .lean();

  // Build lookup maps: patternId/email/domain → first matching ruleId
  const ruleByPatternId = new Map<string, string>();
  const ruleBySenderEmail = new Map<string, string>();
  const ruleBySenderDomain = new Map<string, string>();

  for (const r of rulesForPatterns) {
    const rid = r._id.toString();
    if (r.sourcePatternId) {
      const pid = r.sourcePatternId.toString();
      if (!ruleByPatternId.has(pid)) ruleByPatternId.set(pid, rid);
    }
    const emails = Array.isArray(r.conditions?.senderEmail)
      ? r.conditions.senderEmail
      : r.conditions?.senderEmail ? [r.conditions.senderEmail] : [];
    for (const e of emails) {
      const key = e.toLowerCase();
      if (!ruleBySenderEmail.has(key)) ruleBySenderEmail.set(key, rid);
    }
    if (r.conditions?.senderDomain) {
      const key = r.conditions.senderDomain.toLowerCase();
      if (!ruleBySenderDomain.has(key)) ruleBySenderDomain.set(key, rid);
    }
  }

  const enrichedPatterns = patterns.map((p) => {
    const pid = p._id.toString();
    const emailKey = p.condition?.senderEmail?.toLowerCase();
    const domainKey = p.condition?.senderDomain?.toLowerCase();
    const ruleId =
      ruleByPatternId.get(pid) ??
      (emailKey ? ruleBySenderEmail.get(emailKey) : undefined) ??
      (domainKey ? ruleBySenderDomain.get(domainKey) : undefined);
    return { ...p, hasRule: !!ruleId, ruleId: ruleId ?? null };
  });

  res.json({
    patterns: enrichedPatterns,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/**
 * POST /api/patterns/analyze
 *
 * Trigger on-demand pattern analysis for the current user.
 * Optional body: { mailboxId } for single-mailbox analysis.
 *
 * NOTE: This route MUST be defined before /:id routes to avoid
 * 'analyze' being captured as an :id parameter.
 */
patternsRouter.post('/analyze', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { mailboxId } = req.body as { mailboxId?: string };

  const job = await queues['pattern-analysis'].add('on-demand-analysis', {
    userId,
    mailboxId,
  });

  res.json({
    message: 'Pattern analysis queued',
    jobId: job.id,
  });
});

/**
 * POST /api/patterns/:id/approve
 *
 * Approve a detected/suggested pattern.
 */
patternsRouter.post('/:id/approve', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const pattern = await Pattern.findOne({ _id: req.params.id, userId });
  if (!pattern) {
    throw new NotFoundError('Pattern not found');
  }

  if (pattern.status !== 'detected' && pattern.status !== 'suggested') {
    throw new ConflictError(`Pattern is already ${pattern.status}`);
  }

  pattern.status = 'approved';
  pattern.approvedAt = new Date();
  await pattern.save();

  await AuditLog.create({
    userId,
    mailboxId: pattern.mailboxId,
    action: 'pattern_approved',
    targetType: 'pattern',
    targetId: pattern._id.toString(),
    details: {
      patternType: pattern.patternType,
      confidence: pattern.confidence,
      condition: pattern.condition,
      suggestedAction: pattern.suggestedAction,
    },
  });

  // Auto-convert approved pattern to rule (ROADMAP success criterion 1)
  // Rule creation failure should not fail the approve response
  try {
    await convertPatternToRule(pattern._id, new Types.ObjectId(userId));
  } catch (err) {
    logger.warn('Auto-conversion of pattern to rule failed', {
      patternId: pattern._id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  res.json({ pattern });
});

/**
 * POST /api/patterns/:id/reject
 *
 * Reject a detected/suggested pattern with 30-day cooldown.
 */
patternsRouter.post('/:id/reject', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const pattern = await Pattern.findOne({ _id: req.params.id, userId });
  if (!pattern) {
    throw new NotFoundError('Pattern not found');
  }

  if (pattern.status !== 'detected' && pattern.status !== 'suggested') {
    throw new ConflictError(`Pattern is already ${pattern.status}`);
  }

  // Delete any rules associated with this pattern (by sourcePatternId or sender email/domain)
  const ruleDeleteClauses: Record<string, unknown>[] = [
    { sourcePatternId: pattern._id },
  ];
  if (pattern.condition?.senderEmail) {
    ruleDeleteClauses.push({ 'conditions.senderEmail': pattern.condition.senderEmail });
  }
  if (pattern.condition?.senderDomain) {
    ruleDeleteClauses.push({ 'conditions.senderDomain': pattern.condition.senderDomain });
  }
  const deleteResult = await Rule.deleteMany({ userId, $or: ruleDeleteClauses });
  if (deleteResult.deletedCount > 0) {
    logger.info('Deleted rules on pattern rejection', {
      patternId: pattern._id,
      deletedCount: deleteResult.deletedCount,
      userId,
    });
  }

  // Fetch user's pattern settings for cooldown duration
  const user = await User.findById(userId).select('patternSettings').lean();
  const cooldownDays = user?.patternSettings?.rejectionCooldownDays ?? 30;

  pattern.status = 'rejected';
  pattern.rejectedAt = new Date();
  pattern.rejectionCooldownUntil = new Date(Date.now() + cooldownDays * 24 * 60 * 60 * 1000);
  await pattern.save();

  await AuditLog.create({
    userId,
    mailboxId: pattern.mailboxId,
    action: 'pattern_rejected',
    targetType: 'pattern',
    targetId: pattern._id.toString(),
    details: {
      patternType: pattern.patternType,
      confidence: pattern.confidence,
      condition: pattern.condition,
      suggestedAction: pattern.suggestedAction,
      rulesDeleted: deleteResult.deletedCount,
    },
  });

  res.json({ pattern });
});

/**
 * POST /api/patterns/:id/customize
 *
 * Customize a pattern's suggested action and approve it.
 */
patternsRouter.post('/:id/customize', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const pattern = await Pattern.findOne({ _id: req.params.id, userId });
  if (!pattern) {
    throw new NotFoundError('Pattern not found');
  }

  if (pattern.status !== 'detected' && pattern.status !== 'suggested') {
    throw new ConflictError(`Pattern is already ${pattern.status}`);
  }

  const { suggestedAction } = req.body as {
    suggestedAction?: { actionType?: string; toFolder?: string; category?: string };
  };

  if (!suggestedAction?.actionType) {
    throw new ValidationError('suggestedAction.actionType is required');
  }

  if (!VALID_ACTION_TYPES.includes(suggestedAction.actionType as typeof VALID_ACTION_TYPES[number])) {
    throw new ValidationError(
      `Invalid actionType. Must be one of: ${VALID_ACTION_TYPES.join(', ')}`,
    );
  }

  // Save original action for audit trail
  const originalAction = {
    actionType: pattern.suggestedAction.actionType,
    toFolder: pattern.suggestedAction.toFolder,
    category: pattern.suggestedAction.category,
  };

  // Update suggested action
  pattern.suggestedAction = {
    actionType: suggestedAction.actionType as typeof VALID_ACTION_TYPES[number],
    ...(suggestedAction.toFolder ? { toFolder: suggestedAction.toFolder } : {}),
    ...(suggestedAction.category ? { category: suggestedAction.category } : {}),
  };

  pattern.status = 'approved';
  pattern.approvedAt = new Date();
  await pattern.save();

  await AuditLog.create({
    userId,
    mailboxId: pattern.mailboxId,
    action: 'pattern_approved',
    targetType: 'pattern',
    targetId: pattern._id.toString(),
    details: {
      patternType: pattern.patternType,
      confidence: pattern.confidence,
      condition: pattern.condition,
      suggestedAction: pattern.suggestedAction,
      customized: true,
      originalAction,
    },
  });

  // Auto-convert approved pattern to rule (ROADMAP success criterion 1)
  // Rule creation failure should not fail the approve response
  try {
    await convertPatternToRule(pattern._id, new Types.ObjectId(userId));
  } catch (err) {
    logger.warn('Auto-conversion of customized pattern to rule failed', {
      patternId: pattern._id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  res.json({ pattern });
});

export { patternsRouter };
