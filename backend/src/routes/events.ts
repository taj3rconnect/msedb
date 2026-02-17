import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { EmailEvent } from '../models/EmailEvent.js';

const eventsRouter = Router();

// All event routes require authentication
eventsRouter.use(requireAuth);

/**
 * GET /api/events
 *
 * Returns paginated, filterable email events for the authenticated user.
 * Query params: mailboxId, eventType, senderDomain, page, limit, sortBy, sortOrder
 */
eventsRouter.get('/', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { mailboxId, eventType, senderDomain } = req.query;

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
      limit = Math.min(parsed, 200);
    }
  }

  // Sort
  const sortBy = (req.query.sortBy as string) || 'timestamp';
  const sortOrder = (req.query.sortOrder as string) === 'asc' ? 1 : -1;

  // Build match filter -- always filter by userId
  const filter: Record<string, unknown> = { userId };
  if (mailboxId && typeof mailboxId === 'string') {
    filter.mailboxId = mailboxId;
  }
  if (eventType && typeof eventType === 'string') {
    filter.eventType = eventType;
  }
  if (senderDomain && typeof senderDomain === 'string') {
    filter['sender.domain'] = senderDomain;
  }

  // Parallel query + count
  const [events, total] = await Promise.all([
    EmailEvent.find(filter)
      .sort({ [sortBy]: sortOrder })
      .skip((page - 1) * limit)
      .limit(limit)
      .select(
        'eventType sender subject timestamp mailboxId fromFolder toFolder importance hasAttachments categories isRead',
      )
      .lean(),
    EmailEvent.countDocuments(filter),
  ]);

  res.json({
    events,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/**
 * GET /api/events/sender-breakdown
 *
 * Aggregates email events by sender domain, returning top 20 domains by count.
 * Optional ?mailboxId filter.
 */
eventsRouter.get('/sender-breakdown', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { mailboxId } = req.query;

  const matchFilter: Record<string, unknown> = { userId };
  if (mailboxId && typeof mailboxId === 'string') {
    matchFilter.mailboxId = mailboxId;
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
eventsRouter.get('/timeline', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { mailboxId } = req.query;
  const range = (req.query.range as string) === '30d' ? '30d' : '24h';

  const matchFilter: Record<string, unknown> = { userId };
  if (mailboxId && typeof mailboxId === 'string') {
    matchFilter.mailboxId = mailboxId;
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

export { eventsRouter };
