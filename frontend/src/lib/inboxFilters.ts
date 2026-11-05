import type { FetchEventsParams, MailFilter, SenderGroupBy } from '@/api/events';

/**
 * The inbox filter state, read in one place so the list (InboxPage) and the
 * mailbox count badges (Topbar) always ask the server the same question.
 */

export interface DateRange {
  dateFrom?: string;
  dateTo?: string;
}

/** "At least N unread from one sender". Lives in the URL as ?minCount= and ?groupBy=. */
export interface SenderVolume {
  minCount?: number;
  groupBy: SenderGroupBy;
}

const DEFAULT_DATE_FILTER = 'today';
const MIN_SENDER_COUNT = 2;
const MAX_SENDER_COUNT = 100_000;

/** ?date= value, or the default for a link that has none. */
export function parseDateFilter(value: string | null): string {
  return value || DEFAULT_DATE_FILTER;
}

/** ?status= value. Older links only ever said 'unread' or 'all'; both still resolve. */
export function parseMailFilter(value: string | null): MailFilter {
  return value === 'unread' || value === 'read' || value === 'deleted' ? value : 'all';
}

/** A typed or linked count, or undefined when it is not a usable threshold. */
export function parseMinSenderCount(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const count = Number(value);
  return count >= MIN_SENDER_COUNT && count <= MAX_SENDER_COUNT ? count : undefined;
}

/** ?groupBy= value. Anything else counts by sender. */
export function parseSenderGroupBy(value: string | null): SenderGroupBy {
  return value === 'domain' ? 'domain' : 'sender';
}

/** The ISO window for a date filter. 'all' and unknown values have no window. */
export function resolveDateRange(dateFilter: string): DateRange {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  const today = startOfDay(now);

  switch (dateFilter) {
    case 'today':
      return { dateFrom: today.toISOString(), dateTo: endOfDay(now).toISOString() };
    case 'yesterday': {
      const y = new Date(today); y.setDate(y.getDate() - 1);
      return { dateFrom: y.toISOString(), dateTo: endOfDay(y).toISOString() };
    }
    case 'this-week': {
      const d = new Date(today); d.setDate(d.getDate() - d.getDay());
      return { dateFrom: d.toISOString(), dateTo: endOfDay(now).toISOString() };
    }
    case 'last-week': {
      const d = new Date(today); d.setDate(d.getDate() - d.getDay() - 7);
      const e = new Date(d); e.setDate(e.getDate() + 6);
      return { dateFrom: d.toISOString(), dateTo: endOfDay(e).toISOString() };
    }
    case 'this-month': {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      return { dateFrom: d.toISOString(), dateTo: endOfDay(now).toISOString() };
    }
    case 'last-month': {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      return { dateFrom: d.toISOString(), dateTo: endOfDay(e).toISOString() };
    }
    case 'ytd': {
      const d = new Date(now.getFullYear(), 0, 1);
      return { dateFrom: d.toISOString(), dateTo: endOfDay(now).toISOString() };
    }
    case 'last-year': {
      const d = new Date(now.getFullYear() - 1, 0, 1);
      const e = new Date(now.getFullYear() - 1, 11, 31);
      return { dateFrom: d.toISOString(), dateTo: endOfDay(e).toISOString() };
    }
    default:
      return {};
  }
}

/** The filter params shared by the inbox list and the mailbox count badges. */
export function buildInboxFilterParams(
  mailFilter: MailFilter,
  folderFilter: string,
  dateRange: DateRange,
  senderVolume: SenderVolume,
): FetchEventsParams {
  const volumeActive = mailFilter === 'unread' && senderVolume.minCount !== undefined;
  return {
    eventType: 'arrived',
    excludeDeleted: folderFilter === 'inbox',
    folder: folderFilter,
    unreadOnly: mailFilter === 'unread' || undefined,
    // For 'read'/'deleted' the server reads the RULE-action stamp and
    // applies dateRange to when the rule acted, not to arrival time.
    ruleAction: mailFilter === 'read' || mailFilter === 'deleted' ? mailFilter : undefined,
    minSenderCount: volumeActive ? senderVolume.minCount : undefined,
    senderGroupBy: volumeActive ? senderVolume.groupBy : undefined,
    ...dateRange,
  };
}
