import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { EmailEvent } from '../models/EmailEvent.js';
import { Mailbox } from '../models/Mailbox.js';
import { getFolderName } from '../services/folderCache.js';
import { getRedisClient } from '../config/redis.js';

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
  const { mailboxId, eventType, senderDomain, search, excludeDeleted, inboxOnly, unreadOnly, dateFrom, dateTo, folder } = req.query;

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
  if (search && typeof search === 'string' && search.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = { $regex: escaped, $options: 'i' };
    filter.$or = [
      { 'sender.email': regex },
      { 'sender.name': regex },
      { subject: regex },
    ];
  }

  // Date range filter
  if (dateFrom && typeof dateFrom === 'string') {
    const from = new Date(dateFrom);
    if (!isNaN(from.getTime())) {
      filter.timestamp = { ...(filter.timestamp as Record<string, unknown> || {}), $gte: from };
    }
  }
  if (dateTo && typeof dateTo === 'string') {
    const to = new Date(dateTo);
    if (!isNaN(to.getTime())) {
      filter.timestamp = { ...(filter.timestamp as Record<string, unknown> || {}), $lte: to };
    }
  }

  // Filter to unread messages only
  if (unreadOnly === 'true') {
    filter.isRead = false;
  }

  // Exclude messages that have been deleted (have a corresponding 'deleted' event)
  if (excludeDeleted === 'true') {
    const deletedMessageIds = await EmailEvent.distinct('messageId', {
      userId,
      ...(mailboxId && typeof mailboxId === 'string' ? { mailboxId } : {}),
      eventType: 'deleted',
    });
    if (deletedMessageIds.length > 0) {
      filter.messageId = { $nin: deletedMessageIds };
    }
  }

  // Filter by folder: supports 'inbox', 'deleted', or well-known folder names
  const folderParam = typeof folder === 'string' ? folder : (inboxOnly === 'true' ? 'inbox' : null);
  if (folderParam && mailboxId && typeof mailboxId === 'string') {
    const mb = await Mailbox.findById(mailboxId).select('email').lean();
    if (mb?.email) {
      const redis = getRedisClient();
      const folderAliasMap: Record<string, string> = {
        inbox: 'Inbox',
        deleted: 'DeletedItems',
        sent: 'SentItems',
        drafts: 'Drafts',
        junk: 'JunkEmail',
        archive: 'Archive',
      };
      const wellKnownAlias = folderAliasMap[folderParam.toLowerCase()] || folderParam;
      const cachedFolderId = await redis.get(`folder:${mb.email}:wk:${wellKnownAlias}`);
      const displayNameMap: Record<string, string> = {
        Inbox: 'Inbox',
        DeletedItems: 'Deleted Items',
        SentItems: 'Sent Items',
        Drafts: 'Drafts',
        JunkEmail: 'Junk Email',
        Archive: 'Archive',
      };
      const displayName = displayNameMap[wellKnownAlias] || wellKnownAlias;
      filter.$and = [
        ...(filter.$and ? (filter.$and as Record<string, unknown>[]) : []),
        { $or: [
          ...(cachedFolderId ? [{ toFolder: cachedFolderId }] : []),
          { toFolder: displayName },
          { toFolder: wellKnownAlias },
        ]},
      ];
    }
  }

  // Parallel query + count
  const [events, total] = await Promise.all([
    EmailEvent.find(filter)
      .sort({ [sortBy]: sortOrder })
      .skip((page - 1) * limit)
      .limit(limit)
      .select(
        'eventType sender subject timestamp mailboxId messageId fromFolder toFolder importance hasAttachments categories isRead',
      )
      .lean(),
    EmailEvent.countDocuments(filter),
  ]);

  // Resolve folder IDs to display names when filtered by mailbox
  let resolvedEvents = events;
  if (mailboxId && typeof mailboxId === 'string') {
    const mb = await Mailbox.findById(mailboxId).select('email').lean();
    if (mb?.email) {
      const folderIds = new Set<string>();
      for (const e of events) {
        if (e.fromFolder) folderIds.add(e.fromFolder);
        if (e.toFolder) folderIds.add(e.toFolder);
      }
      const nameMap = new Map<string, string>();
      await Promise.all(
        [...folderIds].map(async (id) => {
          const name = await getFolderName(mb.email, id);
          nameMap.set(id, name);
        }),
      );
      resolvedEvents = events.map((e) => ({
        ...e,
        fromFolder: e.fromFolder ? nameMap.get(e.fromFolder) ?? e.fromFolder : e.fromFolder,
        toFolder: e.toFolder ? nameMap.get(e.toFolder) ?? e.toFolder : e.toFolder,
      }));
    }
  }

  res.json({
    events: resolvedEvents,
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
