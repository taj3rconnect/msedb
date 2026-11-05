import type { Request } from 'express';
import { Types } from 'mongoose';
import { Mailbox } from '../models/Mailbox.js';
import { getRedisClient } from '../config/redis.js';
import { applyRuleActionFilter } from '../utils/ruleActionFilter.js';

type EventListQuery = Request['query'];
type EventFilter = Record<string, unknown>;

/** The only event type the inbox lists, so the only one its counts may include. */
const ARRIVED_EVENT_TYPE = 'arrived';

/**
 * The Mongo filter behind the inbox list.
 *
 * The list and the mailbox count badges both use this, so a badge always equals
 * what the list shows under the same filters. Keep every filter here: a filter
 * added only to the route would make the two disagree again.
 */
export async function buildEventListFilter(
  userId: string,
  query: EventListQuery,
): Promise<EventFilter> {
  const { mailboxId, eventType, senderDomain, search, excludeDeleted, inboxOnly, unreadOnly, dateFrom, dateTo, folder, ruleAction } = query;

  // Build match filter -- always filter by userId
  const filter: EventFilter = { userId };
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

  // --- Rule-action filter ("what did my RULES do?") --------------------------
  // ruleAction=read | deleted -> only events a RULE marked read / deleted.
  // Manual inbox actions are deliberately unstamped and never match here.
  //
  // The date window MOVES to the action timestamp. Filtering rule actions by
  // `timestamp` would filter by when the mail ARRIVED, so an email that landed
  // last week and was deleted by a rule this morning would be missing from
  // "today" -- the exact question this filter exists to answer.
  applyRuleActionFilter(filter, ruleAction);

  // Filter to unread messages only. Meaningless alongside ruleAction=read
  // (those are read by definition), so the rule filter wins.
  if (unreadOnly === 'true' && ruleAction !== 'read') {
    filter.isRead = false;
  }

  // Exclude messages that have been deleted -- except when the caller is
  // explicitly ASKING for the rule-deleted ones, where this would hide the
  // entire result set.
  if (excludeDeleted === 'true' && ruleAction !== 'deleted') {
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
      ? await Mailbox.find({ _id: mailboxId, userId }).select('email').lean()
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

  return filter;
}

/** Aggregation does not cast like find() does, so ObjectId fields are cast here. */
export function toAggregationFilter(filter: EventFilter, userId: string): EventFilter {
  const aggFilter: EventFilter = { ...filter, userId: new Types.ObjectId(userId) };
  if (typeof filter.mailboxId === 'string') {
    aggFilter.mailboxId = new Types.ObjectId(filter.mailboxId);
  }
  return aggFilter;
}

/**
 * The $match for the mailbox count badges: the list's filter across EVERY
 * mailbox, because each badge shows its own mailbox whichever one is open.
 */
export async function buildMailboxCountsMatch(
  userId: string,
  query: EventListQuery,
): Promise<EventFilter> {
  const filter = await buildEventListFilter(userId, {
    ...query,
    mailboxId: undefined,
    eventType: ARRIVED_EVENT_TYPE,
  });
  return toAggregationFilter(filter, userId);
}
