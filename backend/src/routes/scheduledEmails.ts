import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { ScheduledEmail } from '../models/ScheduledEmail.js';
import { Mailbox } from '../models/Mailbox.js';
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js';

const scheduledEmailsRouter = Router();

// All routes require authentication
scheduledEmailsRouter.use(requireAuth);

/**
 * GET /api/scheduled-emails
 *
 * List scheduled emails for the current user.
 * Query params: status (optional), page, limit
 */
scheduledEmailsRouter.get('/', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  let page = 1;
  if (req.query.page) {
    const parsed = parseInt(req.query.page as string, 10);
    if (!isNaN(parsed) && parsed > 0) page = parsed;
  }

  let limit = 20;
  if (req.query.limit) {
    const parsed = parseInt(req.query.limit as string, 10);
    if (!isNaN(parsed) && parsed > 0) limit = Math.min(parsed, 100);
  }

  const filter: Record<string, unknown> = { userId };
  const { status } = req.query;
  if (status && typeof status === 'string') {
    filter.status = status;
  }

  const [scheduledEmails, total] = await Promise.all([
    ScheduledEmail.find(filter)
      .sort({ scheduledAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    ScheduledEmail.countDocuments(filter),
  ]);

  res.json({
    scheduledEmails,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/**
 * GET /api/scheduled-emails/count
 *
 * Get count of pending scheduled emails (for sidebar badge).
 */
scheduledEmailsRouter.get('/count', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const count = await ScheduledEmail.countDocuments({ userId, status: 'pending' });
  res.json({ count });
});

/**
 * POST /api/scheduled-emails
 *
 * Create a new scheduled email.
 * Body: { mailboxId, to, cc?, bcc?, subject, body, scheduledAt }
 */
scheduledEmailsRouter.post('/', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { mailboxId, to, cc, bcc, subject, body, scheduledAt } = req.body;

  if (!mailboxId || !to || !Array.isArray(to) || to.length === 0) {
    throw new ValidationError('mailboxId and at least one recipient (to) are required');
  }
  if (!subject || typeof subject !== 'string' || !subject.trim()) {
    throw new ValidationError('subject is required');
  }
  if (!body || typeof body !== 'string' || !body.trim()) {
    throw new ValidationError('body is required');
  }
  if (!scheduledAt) {
    throw new ValidationError('scheduledAt is required');
  }

  const scheduledDate = new Date(scheduledAt);
  if (isNaN(scheduledDate.getTime())) {
    throw new ValidationError('scheduledAt must be a valid date');
  }
  if (scheduledDate.getTime() <= Date.now()) {
    throw new ValidationError('scheduledAt must be in the future');
  }

  // Verify mailbox ownership
  const mailbox = await Mailbox.findOne({ _id: mailboxId, userId });
  if (!mailbox) {
    throw new NotFoundError('Mailbox not found');
  }

  const scheduledEmail = await ScheduledEmail.create({
    userId,
    mailboxId,
    mailboxEmail: mailbox.email,
    to,
    ...(cc && Array.isArray(cc) && cc.length > 0 && { cc }),
    ...(bcc && Array.isArray(bcc) && bcc.length > 0 && { bcc }),
    subject: subject.trim(),
    body: body.trim(),
    contentType: 'HTML',
    scheduledAt: scheduledDate,
    status: 'pending',
  });

  res.status(201).json({ scheduledEmail });
});

/**
 * DELETE /api/scheduled-emails/:id
 *
 * Cancel a scheduled email (only if status is 'pending').
 */
scheduledEmailsRouter.delete('/:id', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const scheduledEmail = await ScheduledEmail.findOne({ _id: id, userId });
  if (!scheduledEmail) {
    throw new NotFoundError('Scheduled email not found');
  }

  if (scheduledEmail.status !== 'pending') {
    throw new ValidationError(`Cannot cancel email with status '${scheduledEmail.status}'`);
  }

  scheduledEmail.status = 'cancelled';
  scheduledEmail.cancelledAt = new Date();
  scheduledEmail.cleanupAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  await scheduledEmail.save();

  res.json({ scheduledEmail });
});

export { scheduledEmailsRouter };
