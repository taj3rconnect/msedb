import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { Pattern } from '../models/Pattern.js';
import { AuditLog } from '../models/AuditLog.js';
import { queues } from '../jobs/queues.js';
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
  const { mailboxId, status } = req.query;

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

  // Build filter
  const filter: Record<string, unknown> = { userId };
  if (mailboxId && typeof mailboxId === 'string') {
    filter.mailboxId = mailboxId;
  }
  if (status && typeof status === 'string') {
    const statuses = status.split(',').map((s) => s.trim()).filter(Boolean);
    if (statuses.length === 1) {
      filter.status = statuses[0];
    } else if (statuses.length > 1) {
      filter.status = { $in: statuses };
    }
  }

  // Parallel query + count
  const [patterns, total] = await Promise.all([
    Pattern.find(filter)
      .sort({ confidence: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Pattern.countDocuments(filter),
  ]);

  res.json({
    patterns,
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

  pattern.status = 'rejected';
  pattern.rejectedAt = new Date();
  pattern.rejectionCooldownUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
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

  res.json({ pattern });
});

export { patternsRouter };
