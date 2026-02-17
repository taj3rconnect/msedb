import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { EmailEvent } from '../models/EmailEvent.js';
import { Mailbox } from '../models/Mailbox.js';
import { Pattern } from '../models/Pattern.js';

const dashboardRouter = Router();

// All dashboard routes require authentication
dashboardRouter.use(requireAuth);

/**
 * GET /api/dashboard/stats
 *
 * Returns aggregate stats for the authenticated user's email events.
 * Optional ?mailboxId query param for per-mailbox filtering.
 */
dashboardRouter.get('/stats', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { mailboxId } = req.query;

  const filter: Record<string, unknown> = { userId };
  if (mailboxId && typeof mailboxId === 'string') {
    filter.mailboxId = mailboxId;
  }

  // Get total emails processed
  const emailsProcessed = await EmailEvent.countDocuments(filter);

  // Get per-mailbox breakdown
  const perMailboxAgg = await EmailEvent.aggregate([
    { $match: { userId } },
    { $group: { _id: '$mailboxId', count: { $sum: 1 } } },
  ]);

  // Join mailbox info (email, displayName) from Mailbox model
  const mailboxIds = perMailboxAgg.map((m) => m._id);
  const mailboxes = await Mailbox.find({ _id: { $in: mailboxIds } })
    .select('email displayName')
    .lean();

  const mailboxMap = new Map(
    mailboxes.map((m) => [m._id.toString(), { email: m.email, displayName: m.displayName }]),
  );

  const perMailbox = perMailboxAgg.map((m) => ({
    mailboxId: m._id,
    count: m.count,
    ...mailboxMap.get(m._id.toString()),
  }));

  // Count pending patterns (detected or suggested) for the user
  const patternFilter: Record<string, unknown> = {
    userId,
    status: { $in: ['detected', 'suggested'] },
  };
  if (mailboxId && typeof mailboxId === 'string') {
    patternFilter.mailboxId = mailboxId;
  }
  const patternsPending = await Pattern.countDocuments(patternFilter);

  res.json({
    emailsProcessed,
    rulesFired: 0,
    patternsPending,
    stagingCount: 0,
    perMailbox,
  });
});

/**
 * GET /api/dashboard/activity
 *
 * Returns recent email events for the authenticated user.
 * Optional ?mailboxId and ?limit (default 50, max 200) query params.
 */
dashboardRouter.get('/activity', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { mailboxId } = req.query;

  let limit = 50;
  if (req.query.limit) {
    const parsed = parseInt(req.query.limit as string, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, 200);
    }
  }

  const filter: Record<string, unknown> = { userId };
  if (mailboxId && typeof mailboxId === 'string') {
    filter.mailboxId = mailboxId;
  }

  const events = await EmailEvent.find(filter)
    .sort({ timestamp: -1 })
    .limit(limit)
    .select('eventType sender subject timestamp mailboxId fromFolder toFolder')
    .lean();

  res.json({ events });
});

export { dashboardRouter };
