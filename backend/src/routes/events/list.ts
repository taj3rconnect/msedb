import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { getUserId } from '../../auth/middleware.js';
import { EmailEvent } from '../../models/EmailEvent.js';
import { Mailbox } from '../../models/Mailbox.js';
import { getFolderName } from '../../services/folderCache.js';
import { getRedisClient } from '../../config/redis.js';
import { parsePagination } from '../../utils/pagination.js';

const listRouter = Router();

/**
 * GET /api/events
 *
 * Returns paginated, filterable email events for the authenticated user.
 * Query params: mailboxId, eventType, senderDomain, page, limit, sortBy, sortOrder
 */
listRouter.get('/', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { mailboxId, eventType, senderDomain, search, excludeDeleted, inboxOnly, unreadOnly, dateFrom, dateTo, folder } = req.query;

  // Pagination
  const { page, limit } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });

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

export default listRouter;
