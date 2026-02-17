import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { requireAuth } from '../auth/middleware.js';
import { StagedEmail } from '../models/StagedEmail.js';
import { Mailbox } from '../models/Mailbox.js';
import { AuditLog } from '../models/AuditLog.js';
import {
  rescueStagedEmail,
  batchRescueStagedEmails,
} from '../services/stagingManager.js';
import { graphFetch } from '../services/graphClient.js';
import { getAccessTokenForMailbox } from '../auth/tokenManager.js';
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import logger from '../config/logger.js';

const stagingRouter = Router();

// All staging routes require authentication
stagingRouter.use(requireAuth);

/**
 * GET /api/staging
 *
 * List staged emails for the current user.
 * Query params: mailboxId (optional), status (default 'staged'), page, limit
 */
stagingRouter.get('/', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

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
  const { mailboxId, status } = req.query;
  if (mailboxId && typeof mailboxId === 'string') {
    filter.mailboxId = mailboxId;
  }
  filter.status = (status && typeof status === 'string') ? status : 'staged';

  // Parallel query + count
  const [stagedEmails, total] = await Promise.all([
    StagedEmail.find(filter)
      .sort({ expiresAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    StagedEmail.countDocuments(filter),
  ]);

  res.json({
    stagedEmails,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/**
 * GET /api/staging/count
 *
 * Get count of active staged emails (for badge).
 * Query params: mailboxId (optional)
 */
stagingRouter.get('/count', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const filter: Record<string, unknown> = { userId, status: 'staged' };
  const { mailboxId } = req.query;
  if (mailboxId && typeof mailboxId === 'string') {
    filter.mailboxId = mailboxId;
  }

  const count = await StagedEmail.countDocuments(filter);

  res.json({ count });
});

/**
 * POST /api/staging/:id/rescue
 *
 * Rescue a single staged email (cancel pending deletion).
 */
stagingRouter.post('/:id/rescue', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const id = req.params.id as string;

  const stagedEmail = await rescueStagedEmail(id, new Types.ObjectId(userId));

  res.json({ stagedEmail });
});

/**
 * POST /api/staging/batch-rescue
 *
 * Batch rescue multiple staged emails.
 * Body: { ids: string[] }
 */
stagingRouter.post('/batch-rescue', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { ids } = req.body as { ids?: string[] };

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw new ValidationError('ids must be a non-empty array');
  }

  const rescued = await batchRescueStagedEmails(ids, new Types.ObjectId(userId));

  res.json({ rescued });
});

/**
 * POST /api/staging/:id/execute
 *
 * Execute a single staged email immediately (before grace period expires).
 */
stagingRouter.post('/:id/execute', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const id = req.params.id as string;

  const item = await StagedEmail.findOne({
    _id: id,
    userId,
    status: 'staged',
  });

  if (!item) {
    throw new NotFoundError('Staged email not found or not in staged status');
  }

  // Get access token and mailbox email
  const mailbox = await Mailbox.findById(item.mailboxId).select('email');
  if (!mailbox) {
    throw new NotFoundError('Mailbox not found');
  }

  const accessToken = await getAccessTokenForMailbox(item.mailboxId.toString());

  // Execute the staged action: for delete actions, move to Deleted Items
  for (const action of item.actions) {
    if (action.actionType === 'delete') {
      await graphFetch(
        `/users/${encodeURIComponent(mailbox.email)}/messages/${item.messageId}/move`,
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({ destinationId: 'deleteditems' }),
        },
      );
    } else if (action.actionType === 'move' && action.toFolder) {
      await graphFetch(
        `/users/${encodeURIComponent(mailbox.email)}/messages/${item.messageId}/move`,
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({ destinationId: action.toFolder }),
        },
      );
    } else if (action.actionType === 'archive') {
      await graphFetch(
        `/users/${encodeURIComponent(mailbox.email)}/messages/${item.messageId}/move`,
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({ destinationId: 'archive' }),
        },
      );
    }
  }

  // Update status
  item.status = 'executed';
  item.executedAt = new Date();
  await item.save();

  // Audit log
  await AuditLog.create({
    userId,
    mailboxId: item.mailboxId,
    action: 'email_executed',
    targetType: 'email',
    targetId: item.messageId,
    details: {
      ruleId: item.ruleId.toString(),
      actions: item.actions,
      originalFolder: item.originalFolder,
      stagedEmailId: item._id?.toString(),
    },
    undoable: true,
  });

  res.json({ stagedEmail: item });
});

/**
 * POST /api/staging/batch-execute
 *
 * Batch execute staged emails immediately.
 * Body: { ids: string[] }
 */
stagingRouter.post('/batch-execute', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { ids } = req.body as { ids?: string[] };

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw new ValidationError('ids must be a non-empty array');
  }

  // Find all staged emails
  const items = await StagedEmail.find({
    _id: { $in: ids },
    userId,
    status: 'staged',
  });

  if (items.length === 0) {
    res.json({ executed: 0 });
    return;
  }

  // Process with concurrency limit of 5
  let executed = 0;
  const chunkSize = 5;

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const results = await Promise.allSettled(
      chunk.map(async (item) => {
        const mailbox = await Mailbox.findById(item.mailboxId).select('email');
        if (!mailbox) {
          throw new Error(`Mailbox ${item.mailboxId} not found`);
        }

        const accessToken = await getAccessTokenForMailbox(item.mailboxId.toString());

        // Execute each action
        for (const action of item.actions) {
          if (action.actionType === 'delete') {
            await graphFetch(
              `/users/${encodeURIComponent(mailbox.email)}/messages/${item.messageId}/move`,
              accessToken,
              {
                method: 'POST',
                body: JSON.stringify({ destinationId: 'deleteditems' }),
              },
            );
          } else if (action.actionType === 'move' && action.toFolder) {
            await graphFetch(
              `/users/${encodeURIComponent(mailbox.email)}/messages/${item.messageId}/move`,
              accessToken,
              {
                method: 'POST',
                body: JSON.stringify({ destinationId: action.toFolder }),
              },
            );
          } else if (action.actionType === 'archive') {
            await graphFetch(
              `/users/${encodeURIComponent(mailbox.email)}/messages/${item.messageId}/move`,
              accessToken,
              {
                method: 'POST',
                body: JSON.stringify({ destinationId: 'archive' }),
              },
            );
          }
        }

        // Update status
        item.status = 'executed';
        item.executedAt = new Date();
        await item.save();

        // Audit log
        await AuditLog.create({
          userId,
          mailboxId: item.mailboxId,
          action: 'email_executed',
          targetType: 'email',
          targetId: item.messageId,
          details: {
            ruleId: item.ruleId.toString(),
            actions: item.actions,
            originalFolder: item.originalFolder,
            stagedEmailId: item._id?.toString(),
            batchExecute: true,
          },
          undoable: true,
        });
      }),
    );

    // Count successes
    for (const result of results) {
      if (result.status === 'fulfilled') {
        executed++;
      } else {
        logger.warn('Failed to execute staged email in batch', {
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }
  }

  res.json({ executed });
});

export { stagingRouter };
