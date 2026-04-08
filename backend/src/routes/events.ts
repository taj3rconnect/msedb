import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth } from '../auth/middleware.js';
import { EmailEvent } from '../models/EmailEvent.js';
import { Mailbox } from '../models/Mailbox.js';
import { getFolderName } from '../services/folderCache.js';
import { getRedisClient } from '../config/redis.js';
import { graphFetch } from '../services/graphClient.js';
import { getAccessTokenForMailbox } from '../auth/tokenManager.js';

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

  // Exclude messages that have been deleted
  if (excludeDeleted === 'true') {
    filter.isDeleted = { $ne: true };
  }

  // Filter by folder: supports 'inbox', 'deleted', well-known names, or subfolder paths
  const folderParam = typeof folder === 'string' ? folder : (inboxOnly === 'true' ? 'inbox' : null);
  if (folderParam) {
    const folderAliasMap: Record<string, string> = {
      inbox: 'Inbox',
      deleted: 'DeletedItems',
      sent: 'SentItems',
      drafts: 'Drafts',
      junk: 'JunkEmail',
      archive: 'Archive',
    };
    const wellKnownAlias = folderAliasMap[folderParam.toLowerCase()] || folderParam;
    const displayNameMap: Record<string, string> = {
      Inbox: 'Inbox',
      DeletedItems: 'Deleted Items',
      SentItems: 'Sent Items',
      Drafts: 'Drafts',
      JunkEmail: 'Junk Email',
      Archive: 'Archive',
    };
    const displayName = displayNameMap[wellKnownAlias] || wellKnownAlias;

    // Determine which mailboxes to resolve folder IDs for
    const mailboxesToResolve = mailboxId && typeof mailboxId === 'string'
      ? await Mailbox.find({ _id: mailboxId }).select('email').lean()
      : await Mailbox.find({ userId, isConnected: true }).select('email').lean();

    const redis = getRedisClient();
    const folderOrConditions: Record<string, unknown>[] = [
      { toFolder: displayName },
      { toFolder: wellKnownAlias },
      { toFolder: folderParam }, // exact match for subfolder paths like "Inbox/Abacus"
    ];
    // Batch fetch well-known folder IDs and full folder lists
    const wkKeys = mailboxesToResolve.filter((mb) => mb.email).map((mb) => `folder:${mb.email}:wk:${wellKnownAlias}`);
    const allKeys = mailboxesToResolve.filter((mb) => mb.email).map((mb) => `folder:${mb.email}:all`);
    const [wkValues, allValues] = await Promise.all([
      wkKeys.length > 0 ? redis.mget(...wkKeys) : Promise.resolve([]),
      allKeys.length > 0 ? redis.mget(...allKeys) : Promise.resolve([]),
    ]);

    for (const cachedFolderId of wkValues) {
      if (cachedFolderId) folderOrConditions.push({ toFolder: cachedFolderId });
    }

    // Collect all subfolder keys, then batch fetch
    const subfolderKeys: string[] = [];
    const subfolderMeta: Array<{ email: string; fid: string }> = [];
    for (let i = 0; i < allValues.length; i++) {
      const raw = allValues[i];
      if (!raw) continue;
      const mb = mailboxesToResolve.filter((m) => m.email)[i];
      const ids: string[] = JSON.parse(raw);
      for (const fid of ids) {
        subfolderKeys.push(`folder:${mb.email}:${fid}`);
        subfolderMeta.push({ email: mb.email, fid });
      }
    }

    if (subfolderKeys.length > 0) {
      const subfolderNames = await redis.mget(...subfolderKeys);
      for (let j = 0; j < subfolderNames.length; j++) {
        const fname = subfolderNames[j];
        const { fid } = subfolderMeta[j];
        if (
          fname === folderParam ||
          fname === displayName ||
          fname?.endsWith(`/${folderParam}`) ||
          fname?.endsWith(`/${displayName}`)
        ) {
          folderOrConditions.push({ toFolder: fid });
          if (fname) folderOrConditions.push({ toFolder: fname });
        }
      }
    }

    filter.$and = [
      ...(filter.$and ? (filter.$and as Record<string, unknown>[]) : []),
      { $or: folderOrConditions },
    ];
  }

  // For sender field sorts, use aggregation to handle nulls and case-insensitive ordering
  const senderSortFields = new Set(['sender.domain', 'sender.email', 'sender.name']);
  const useAggSort = senderSortFields.has(sortBy);

  // Aggregation-safe filter: ObjectId fields must be cast explicitly
  const aggFilter: Record<string, unknown> = { ...filter, userId: new Types.ObjectId(userId) };
  if (mailboxId && typeof mailboxId === 'string') {
    aggFilter.mailboxId = new Types.ObjectId(mailboxId);
  }

  const projectFields = {
    eventType: 1, sender: 1, subject: 1, timestamp: 1,
    mailboxId: 1, messageId: 1, fromFolder: 1, toFolder: 1,
    importance: 1, hasAttachments: 1, categories: 1, isRead: 1,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let events: any[];
  let total: number;

  if (useAggSort) {
    let sortKeyExpr: unknown;
    if (sortBy === 'sender.domain') {
      sortKeyExpr = {
        $toLower: {
          $ifNull: [
            '$sender.domain',
            { $ifNull: [{ $arrayElemAt: [{ $split: ['$sender.email', '@'] }, 1] }, ''] },
          ],
        },
      };
    } else if (sortBy === 'sender.email') {
      sortKeyExpr = { $toLower: { $ifNull: ['$sender.email', ''] } };
    } else {
      // sender.name
      sortKeyExpr = { $toLower: { $ifNull: ['$sender.name', ''] } };
    }

    [events, total] = await Promise.all([
      EmailEvent.aggregate([
        { $match: aggFilter },
        { $addFields: { _sortKey: sortKeyExpr } },
        { $sort: { _sortKey: sortOrder, timestamp: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
        { $project: projectFields },
      ]),
      EmailEvent.countDocuments(filter),
    ]);
  } else {
    [events, total] = await Promise.all([
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
  }

  // Resolve folder IDs to display names
  let resolvedEvents = events;
  {
    // Group events by mailboxId so we resolve folders per-mailbox
    const mbIds = new Set<string>();
    for (const e of events) {
      if (e.mailboxId) mbIds.add(e.mailboxId.toString());
    }
    if (mbIds.size > 0) {
      const mbDocs = await Mailbox.find({ _id: { $in: [...mbIds] } }).select('email').lean();
      const mbEmailMap = new Map<string, string>();
      for (const mb of mbDocs) {
        mbEmailMap.set(mb._id.toString(), mb.email);
      }

      // Collect folder IDs per mailbox email
      const perMailboxFolderIds = new Map<string, Set<string>>();
      for (const e of events) {
        const email = mbEmailMap.get(e.mailboxId?.toString());
        if (!email) continue;
        if (!perMailboxFolderIds.has(email)) perMailboxFolderIds.set(email, new Set());
        const idSet = perMailboxFolderIds.get(email)!;
        if (e.fromFolder) idSet.add(e.fromFolder);
        if (e.toFolder) idSet.add(e.toFolder);
      }

      // Resolve all folder IDs to names
      const nameMap = new Map<string, string>();
      await Promise.all(
        [...perMailboxFolderIds.entries()].flatMap(([email, ids]) =>
          [...ids].map(async (id) => {
            const name = await getFolderName(email, id);
            nameMap.set(id, name);
          }),
        ),
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

/**
 * GET /api/events/mailbox-counts
 *
 * Returns total indexed event counts grouped by mailboxId.
 */
eventsRouter.get('/mailbox-counts', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

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

/**
 * POST /api/events/summarize-today
 *
 * Uses AI to summarize today's emails, grouped by importance.
 * Body: { mailboxId?: string }
 */
eventsRouter.post('/summarize-today', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { mailboxId } = req.body;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    return;
  }

  // Query today's arrived events
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const filter: Record<string, unknown> = {
    userId,
    eventType: 'arrived',
    receivedAt: { $gte: startOfDay, $lte: endOfDay },
  };
  if (mailboxId && typeof mailboxId === 'string') {
    filter.mailboxId = mailboxId;
  }

  // Filter to inbox folder only (same logic as GET /events with folder=inbox)
  const mailboxesToResolve = mailboxId && typeof mailboxId === 'string'
    ? await Mailbox.find({ _id: mailboxId }).select('email').lean()
    : await Mailbox.find({ userId, isConnected: true }).select('email').lean();

  const redis = getRedisClient();
  const inboxFolderValues: string[] = ['Inbox'];
  for (const mb of mailboxesToResolve) {
    if (mb.email) {
      const cachedFolderId = await redis.get(`folder:${mb.email}:wk:Inbox`);
      if (cachedFolderId) inboxFolderValues.push(cachedFolderId);
    }
  }
  filter.toFolder = { $in: inboxFolderValues };

  // Exclude deleted emails
  filter.isDeleted = { $ne: true };

  // Build aggregation-safe filter with proper ObjectId casting
  const aggFilterBase: Record<string, unknown> = {
    userId: new Types.ObjectId(userId),
    eventType: 'arrived',
    receivedAt: { $gte: startOfDay, $lte: endOfDay },
    toFolder: { $in: inboxFolderValues },
  };
  if (mailboxId && typeof mailboxId === 'string') {
    aggFilterBase.mailboxId = new Types.ObjectId(mailboxId);
  }

  const aggFilterExclDeleted = { ...aggFilterBase, isDeleted: { $ne: true } };

  // Count today's inbox arrivals (including deleted) and read/unread for non-deleted
  const [events, readUnreadCounts, todayTotalCount] = await Promise.all([
    EmailEvent.find(filter)
      .sort({ receivedAt: -1 })
      .limit(200)
      .select('sender subject importance isRead categories metadata.isNewsletter hasAttachments receivedAt')
      .lean(),
    EmailEvent.aggregate([
      { $match: aggFilterExclDeleted },
      { $group: { _id: '$isRead', count: { $sum: 1 } } },
    ]),
    // Total arrived in inbox today (including deleted) — to compute deleted count
    EmailEvent.countDocuments({
      userId,
      eventType: 'arrived',
      receivedAt: { $gte: startOfDay, $lte: endOfDay },
      toFolder: { $in: inboxFolderValues },
      ...(mailboxId && typeof mailboxId === 'string' ? { mailboxId } : {}),
    }),
  ]);

  // Compute accurate read/unread stats from aggregation
  let readCount = 0;
  let unreadCount = 0;
  for (const bucket of readUnreadCounts) {
    if (bucket._id === true) readCount = bucket.count;
    else unreadCount = bucket.count;
  }
  const activeCount = readCount + unreadCount;
  const deletedCount = todayTotalCount - activeCount;
  const stats = { total: activeCount, read: readCount, unread: unreadCount, deleted: deletedCount };

  if (events.length === 0) {
    res.json({ summary: '<p style="color:#888">No emails received today.</p>', stats });
    return;
  }

  // Build text list for Claude
  const emailList = events.map((e, i) => {
    const sender = e.sender?.name
      ? `${e.sender.name} <${e.sender.email}>`
      : (e.sender?.email || 'Unknown');
    const subject = e.subject || '(no subject)';
    const importance = e.importance || 'normal';
    const isNewsletter = (e as any).metadata?.isNewsletter ? 'yes' : 'no';
    const isRead = e.isRead ? 'read' : 'unread';
    const attachments = e.hasAttachments ? 'has attachments' : '';
    const categories = e.categories?.length ? `categories: ${e.categories.join(', ')}` : '';
    const time = new Date(e.receivedAt ?? e.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    return `${i + 1}. [${time}] From: ${sender} | Subject: ${subject} | Importance: ${importance} | Newsletter: ${isNewsletter} | ${isRead} ${attachments} ${categories}`.trim();
  }).join('\n');

  const truncatedNote = activeCount > events.length
    ? `\n\nNote: Showing ${events.length} of ${activeCount} total emails received today.`
    : '';

  const prompt = `You are an email assistant. Summarize the following ${events.length} emails received today (${activeCount} total). Group them into these categories (use ALL that apply, skip empty categories):

1. **Needs Your Response** — emails that clearly require a reply or action (meetings to accept, questions asked, approvals needed)
2. **Important Updates** — significant emails that don't need a reply but should be read (announcements, reports, notifications from people)
3. **FYI / Updates** — informational emails, automated notifications, status updates
4. **Newsletters & Low Priority** — marketing, newsletters, bulk emails, promotions

Rules:
- Maximum 1 line per email, be very brief
- For "Needs Your Response" items, wrap each line in <span style="color:#ef4444;font-weight:600">...</span>
- Use HTML formatting. Each category as <h3> with a count. Each email as a <div> with sender name bolded.
- At the top, add a brief 1-sentence overall summary (e.g. "23 emails today — 3 need your attention")
- Do NOT use markdown, only HTML
- If an email is unread, prefix with a blue dot: <span style="color:#3b82f6">●</span>

Here are today's emails:
${emailList}${truncatedNote}`;

  try {
    const anthropic = new Anthropic({ apiKey });
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = message.content.find((b) => b.type === 'text');
    const summary = textBlock?.text || '<p>Failed to generate summary.</p>';

    res.json({ summary, stats });
  } catch (err: any) {
    console.error('Anthropic API error:', err.message);
    res.status(500).json({ error: `AI summary failed: ${err.message}` });
  }
});

/**
 * GET /api/events/summarize-today/csv
 *
 * Downloads today's emails as a CSV file.
 * Query: ?mailboxId (optional)
 */
eventsRouter.get('/summarize-today/csv', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { mailboxId } = req.query;

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const filter: Record<string, unknown> = {
    userId,
    eventType: 'arrived',
    receivedAt: { $gte: startOfDay, $lte: endOfDay },
  };
  if (mailboxId && typeof mailboxId === 'string') {
    filter.mailboxId = mailboxId;
  }

  // Filter to inbox folder only
  const csvMailboxes = mailboxId && typeof mailboxId === 'string'
    ? await Mailbox.find({ _id: mailboxId }).select('email').lean()
    : await Mailbox.find({ userId, isConnected: true }).select('email').lean();
  const csvRedis = getRedisClient();
  const csvInboxFolders: string[] = ['Inbox'];
  for (const mb of csvMailboxes) {
    if (mb.email) {
      const fid = await csvRedis.get(`folder:${mb.email}:wk:Inbox`);
      if (fid) csvInboxFolders.push(fid);
    }
  }
  filter.toFolder = { $in: csvInboxFolders };

  // Exclude deleted emails
  filter.isDeleted = { $ne: true };

  const events = await EmailEvent.find(filter)
    .sort({ receivedAt: -1 })
    .limit(500)
    .select('sender subject importance isRead hasAttachments categories receivedAt timestamp')
    .lean();

  // Build CSV
  const escapeCsv = (val: string) => {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };

  const header = 'Time,From Name,From Email,Subject,Importance,Read,Has Attachments,Categories';
  const rows = events.map((e) => {
    const time = new Date(e.receivedAt ?? e.timestamp).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
    return [
      escapeCsv(time),
      escapeCsv(e.sender?.name || ''),
      escapeCsv(e.sender?.email || ''),
      escapeCsv(e.subject || ''),
      escapeCsv(e.importance || 'normal'),
      e.isRead ? 'Yes' : 'No',
      e.hasAttachments ? 'Yes' : 'No',
      escapeCsv(e.categories?.join('; ') || ''),
    ].join(',');
  });

  const csv = [header, ...rows].join('\n');
  const dateStr = now.toISOString().slice(0, 10);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="email-summary-${dateStr}.csv"`);
  res.send(csv);
});

/**
 * POST /api/events/summarize-today/send
 *
 * Sends the summary as an email via Graph API sendMail.
 * Body: { to: string, summary: string }
 */
eventsRouter.post('/summarize-today/send', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { to, summary } = req.body;

  if (!to || !summary) {
    res.status(400).json({ error: 'Missing "to" or "summary" in request body' });
    return;
  }

  // Find the first connected mailbox to send from
  const mailbox = await Mailbox.findOne({ userId, isConnected: true }).lean();
  if (!mailbox) {
    res.status(400).json({ error: 'No connected mailbox to send from' });
    return;
  }

  try {
    const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const sendMailBody = {
      message: {
        subject: `Daily Email Summary — ${today}`,
        body: {
          contentType: 'HTML',
          content: summary,
        },
        toRecipients: to.split(/[,;]+/).map((email: string) => ({
          emailAddress: { address: email.trim() },
        })),
      },
      saveToSentItems: false,
    };

    await graphFetch(
      `/users/${mailbox.email}/sendMail`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify(sendMailBody),
      },
    );

    res.json({ success: true });
  } catch (err: any) {
    console.error('Send summary email error:', err.message);
    res.status(500).json({ error: `Failed to send email: ${err.message}` });
  }
});

export { eventsRouter };
