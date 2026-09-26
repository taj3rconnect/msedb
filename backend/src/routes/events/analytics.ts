import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { getUserId } from '../../auth/middleware.js';
import { EmailEvent } from '../../models/EmailEvent.js';

const analyticsRouter = Router();

/**
 * GET /api/events/sender-breakdown
 *
 * Aggregates email events by sender domain, returning top 20 domains by count.
 * Optional ?mailboxId filter.
 */
analyticsRouter.get('/sender-breakdown', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { mailboxId } = req.query;

  const matchFilter: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
  if (mailboxId && typeof mailboxId === 'string') {
    matchFilter.mailboxId = new Types.ObjectId(mailboxId);
  }

  const breakdown = await EmailEvent.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: '$sender.domain',
        count: { $sum: 1 },
        latestEvent: { $max: '$timestamp' },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 20 },
  ]);

  res.json({ breakdown });
});

/**
 * GET /api/events/timeline
 *
 * Aggregates email events into time buckets (hourly for 24h, daily for 30d).
 * Optional ?mailboxId and ?range ('24h' or '30d', default '24h') filters.
 */
analyticsRouter.get('/timeline', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { mailboxId } = req.query;
  const range = (req.query.range as string) === '30d' ? '30d' : '24h';

  const matchFilter: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
  if (mailboxId && typeof mailboxId === 'string') {
    matchFilter.mailboxId = new Types.ObjectId(mailboxId);
  }

  // Calculate the start date based on range
  const now = new Date();
  const since =
    range === '24h'
      ? new Date(now.getTime() - 24 * 60 * 60 * 1000)
      : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  matchFilter.timestamp = { $gte: since };

  // Group format: hourly for 24h, daily for 30d
  const dateFormat = range === '24h' ? '%Y-%m-%dT%H:00' : '%Y-%m-%d';

  const timeline = await EmailEvent.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: { $dateToString: { format: dateFormat, date: '$timestamp' } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  res.json({ timeline, range });
});

/**
 * GET /api/events/mailbox-counts
 *
 * Returns total indexed event counts grouped by mailboxId.
 */
analyticsRouter.get('/mailbox-counts', async (req: Request, res: Response) => {
  const userId = getUserId(req);

  const counts = await EmailEvent.aggregate([
    { $match: { userId: new Types.ObjectId(userId), eventType: 'arrived' } },
    { $group: { _id: '$mailboxId', count: { $sum: 1 } } },
  ]);

  const result: Record<string, number> = {};
  for (const c of counts) {
    result[c._id.toString()] = c.count;
  }

  res.json({ counts: result });
});

export default analyticsRouter;
