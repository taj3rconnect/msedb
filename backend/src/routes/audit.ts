import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { requireAuth } from '../auth/middleware.js';
import { AuditLog } from '../models/AuditLog.js';
import { undoAction } from '../services/undoService.js';
import { ValidationError } from '../middleware/errorHandler.js';

const auditRouter = Router();

// All audit routes require authentication
auditRouter.use(requireAuth);

/**
 * GET /api/audit
 *
 * Paginated audit log with filters.
 * Query params: mailboxId, ruleId, action (comma-separated), startDate, endDate, page, limit
 */
auditRouter.get('/', async (req: Request, res: Response) => {
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
  const { mailboxId, ruleId, action, startDate, endDate } = req.query;

  if (mailboxId && typeof mailboxId === 'string') {
    filter.mailboxId = mailboxId;
  }

  if (action && typeof action === 'string') {
    const actions = action.split(',').map((a) => a.trim()).filter(Boolean);
    if (actions.length === 1) {
      filter.action = actions[0];
    } else if (actions.length > 1) {
      filter.action = { $in: actions };
    }
  }

  if (ruleId && typeof ruleId === 'string') {
    // Filter by ruleId in details.ruleId OR targetId
    filter.$or = [
      { 'details.ruleId': ruleId },
      { targetId: ruleId },
    ];
  }

  // Date range
  if (startDate || endDate) {
    const createdAtFilter: Record<string, Date> = {};
    if (startDate && typeof startDate === 'string') {
      const parsedDate = new Date(startDate);
      if (!isNaN(parsedDate.getTime())) {
        createdAtFilter.$gte = parsedDate;
      }
    }
    if (endDate && typeof endDate === 'string') {
      const parsedDate = new Date(endDate);
      if (!isNaN(parsedDate.getTime())) {
        createdAtFilter.$lte = parsedDate;
      }
    }
    if (Object.keys(createdAtFilter).length > 0) {
      filter.createdAt = createdAtFilter;
    }
  }

  // Parallel query + count
  const [auditLogs, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    AuditLog.countDocuments(filter),
  ]);

  res.json({
    auditLogs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/**
 * POST /api/audit/:id/undo
 *
 * Undo an automated action within the 48-hour safety window.
 */
auditRouter.post('/:id/undo', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const id = req.params.id as string;
  const auditLog = await undoAction(id, new Types.ObjectId(userId));

  res.json({ auditLog });
});

export { auditRouter };
