import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';

const { mailboxFind, mget } = vi.hoisted(() => ({
  mailboxFind: vi.fn(),
  mget: vi.fn(),
}));

vi.mock('../../models/Mailbox.js', () => ({ Mailbox: { find: mailboxFind } }));
vi.mock('../../config/redis.js', () => ({ getRedisClient: () => ({ mget }) }));

import {
  buildEventListFilter,
  buildMailboxCountsMatch,
  toAggregationFilter,
} from '../eventListFilter.js';

const USER_ID = '64b000000000000000000001';
const MAILBOX_ID = '64b000000000000000000002';

/** The query the inbox sends for Unread + all dates + Inbox. */
const UNREAD_INBOX_QUERY = {
  eventType: 'arrived',
  unreadOnly: 'true',
  excludeDeleted: 'true',
  folder: 'inbox',
};

function stubMailboxes(mailboxes: Array<{ email: string }>) {
  mailboxFind.mockReturnValue({
    select: () => ({ lean: () => Promise.resolve(mailboxes) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  stubMailboxes([{ email: 'a@example.com' }, { email: 'b@example.com' }]);
  mget.mockResolvedValue([]);
});

describe('buildMailboxCountsMatch', () => {
  it('applies the unread, deleted and folder filters instead of counting everything', async () => {
    const match = await buildMailboxCountsMatch(USER_ID, UNREAD_INBOX_QUERY);

    expect(match.isRead).toBe(false);
    expect(match.isDeleted).toEqual({ $ne: true });
    expect(match.eventType).toBe('arrived');
    expect(match.$and).toBeDefined();
  });

  it('matches the unified list filter, differing only in the cast userId', async () => {
    const list = await buildEventListFilter(USER_ID, UNREAD_INBOX_QUERY);
    const counts = await buildMailboxCountsMatch(USER_ID, UNREAD_INBOX_QUERY);

    expect({ ...counts, userId: USER_ID }).toEqual(list);
  });

  it('casts userId, because aggregation does not cast it', async () => {
    const match = await buildMailboxCountsMatch(USER_ID, {});

    expect(match.userId).toBeInstanceOf(Types.ObjectId);
    expect(String(match.userId)).toBe(USER_ID);
  });

  it('counts every mailbox even when the caller names one', async () => {
    const match = await buildMailboxCountsMatch(USER_ID, { mailboxId: MAILBOX_ID });

    expect(match).not.toHaveProperty('mailboxId');
  });

  it('counts only arrived events, whatever eventType is requested', async () => {
    const match = await buildMailboxCountsMatch(USER_ID, { eventType: 'deleted' });

    expect(match.eventType).toBe('arrived');
  });

  it('keeps the date window on arrival time for a plain filter', async () => {
    const dateFrom = '2026-11-01T00:00:00.000Z';
    const match = await buildMailboxCountsMatch(USER_ID, { dateFrom });

    expect(match.timestamp).toEqual({ $gte: new Date(dateFrom) });
  });

  it('moves the date window to the action time for a rule filter', async () => {
    const dateFrom = '2026-11-01T00:00:00.000Z';
    const match = await buildMailboxCountsMatch(USER_ID, { ruleAction: 'deleted', dateFrom });

    expect(match).not.toHaveProperty('timestamp');
    expect(match['metadata.ruleDeletedAt']).toEqual({
      $exists: true,
      $ne: null,
      $gte: new Date(dateFrom),
    });
  });
});

describe('buildEventListFilter', () => {
  it('resolves cached folder ids for every connected mailbox when none is named', async () => {
    mget.mockResolvedValueOnce(['folder-a', 'folder-b']).mockResolvedValueOnce([null, null]);

    const filter = await buildEventListFilter(USER_ID, { folder: 'inbox' });

    expect(mailboxFind).toHaveBeenCalledWith({ userId: USER_ID, isConnected: true });
    expect(filter.$and).toEqual([
      {
        $or: [
          { toFolder: 'Inbox' },
          { toFolder: 'Inbox' },
          { toFolder: 'inbox' },
          { toFolder: 'folder-a' },
          { toFolder: 'folder-b' },
        ],
      },
    ]);
  });

  it('escapes regex characters in search', async () => {
    const filter = await buildEventListFilter(USER_ID, { search: 'a.b' });

    expect(filter.$or).toContainEqual({
      subject: { $regex: 'a\\.b', $options: 'i' },
    });
  });
});

describe('toAggregationFilter', () => {
  it('casts a named mailboxId', () => {
    const agg = toAggregationFilter({ userId: USER_ID, mailboxId: MAILBOX_ID }, USER_ID);

    expect(agg.mailboxId).toBeInstanceOf(Types.ObjectId);
  });

  it('adds no mailboxId when none is set', () => {
    expect(toAggregationFilter({ userId: USER_ID }, USER_ID)).not.toHaveProperty('mailboxId');
  });
});
