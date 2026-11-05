import type { PipelineStage } from 'mongoose';
import type { Request } from 'express';
import { ValidationError } from '../middleware/errorHandler.js';

/**
 * "Who is piling up in my unread mail?" -- keep only the unread emails from
 * senders (or domains) with at least `minCount` of them, biggest first.
 *
 * Grouping, thresholding and sorting all run in Mongo. Rows with no sender
 * address are left out, because there is nothing to group them by.
 */

export type SenderGroupBy = 'sender' | 'domain';

export interface SenderVolumeFilter {
  minCount: number;
  groupBy: SenderGroupBy;
}

/** 1 would mean "every sender", which is just the plain unread list. */
export const MIN_SENDER_COUNT = 2;
export const MAX_SENDER_COUNT = 100_000;

const SENDER_EMAIL_EXPR = { $toLower: { $ifNull: ['$sender.email', ''] } };
const SENDER_DOMAIN_EXPR = {
  $ifNull: [{ $arrayElemAt: [{ $split: [SENDER_EMAIL_EXPR, '@'] }, 1] }, ''],
};

/**
 * Read ?minSenderCount= and ?senderGroupBy=. Returns undefined outside the
 * Unread filter: this feature exists only there, so the server enforces it too.
 */
export function parseSenderVolumeFilter(query: Request['query']): SenderVolumeFilter | undefined {
  const { minSenderCount, senderGroupBy, unreadOnly, ruleAction } = query;
  if (minSenderCount === undefined) return undefined;

  if (typeof minSenderCount !== 'string' || !/^\d+$/.test(minSenderCount)) {
    throw new ValidationError('minSenderCount must be a whole number');
  }
  const minCount = Number(minSenderCount);
  if (minCount < MIN_SENDER_COUNT || minCount > MAX_SENDER_COUNT) {
    throw new ValidationError(
      `minSenderCount must be between ${MIN_SENDER_COUNT} and ${MAX_SENDER_COUNT}`,
    );
  }

  const groupBy = senderGroupBy ?? 'sender';
  if (groupBy !== 'sender' && groupBy !== 'domain') {
    throw new ValidationError("senderGroupBy must be 'sender' or 'domain'");
  }

  return unreadOnly === 'true' && !ruleAction ? { minCount, groupBy } : undefined;
}

/** Match, then tag each row with its group, dropping rows that have no sender. */
function groupKeyStages(match: Record<string, unknown>, groupBy: SenderGroupBy): PipelineStage[] {
  return [
    { $match: match },
    { $addFields: { _groupKey: groupBy === 'domain' ? SENDER_DOMAIN_EXPR : SENDER_EMAIL_EXPR } },
    { $match: { _groupKey: { $ne: '' } } },
  ];
}

interface SenderVolumeListOptions {
  page: number;
  limit: number;
  project: Record<string, 0 | 1>;
  /** Set when the Sender header is sorted; otherwise the biggest group comes first. */
  senderSortOrder?: 1 | -1;
}

/** One page of rows plus the total. Result shape: [{ rows, total: [{ count }] }]. */
export function buildSenderVolumeListPipeline(
  match: Record<string, unknown>,
  { minCount, groupBy }: SenderVolumeFilter,
  { page, limit, project, senderSortOrder }: SenderVolumeListOptions,
): PipelineStage[] {
  const sort: Record<string, 1 | -1> = senderSortOrder
    ? { _senderEmail: senderSortOrder, timestamp: -1, _id: -1 }
    : { _groupCount: -1, _groupKey: 1, timestamp: -1, _id: -1 };

  return [
    ...groupKeyStages(match, groupBy),
    { $setWindowFields: { partitionBy: '$_groupKey', output: { _groupCount: { $count: {} } } } },
    { $match: { _groupCount: { $gte: minCount } } },
    {
      $facet: {
        rows: [
          { $addFields: { _senderEmail: SENDER_EMAIL_EXPR } },
          { $sort: sort },
          { $skip: (page - 1) * limit },
          { $limit: limit },
          { $project: { ...project, senderGroupCount: '$_groupCount' } },
        ],
        total: [{ $count: 'count' }],
      },
    },
  ];
}

/**
 * Pill counts. A mailbox pill must equal that mailbox's list, where a sender is
 * counted inside the one mailbox; the unified pill counts a sender across all of
 * them. So the two are tallied separately.
 * Result shape: [{ perMailbox: [{ _id, count }], unified: [{ count }] }].
 */
export function buildSenderVolumeCountsPipeline(
  match: Record<string, unknown>,
  { minCount, groupBy }: SenderVolumeFilter,
): PipelineStage[] {
  const atLeastMinCount = { $match: { n: { $gte: minCount } } };
  return [
    ...groupKeyStages(match, groupBy),
    {
      $facet: {
        perMailbox: [
          { $group: { _id: { key: '$_groupKey', mailboxId: '$mailboxId' }, n: { $sum: 1 } } },
          atLeastMinCount,
          { $group: { _id: '$_id.mailboxId', count: { $sum: '$n' } } },
        ],
        unified: [
          { $group: { _id: '$_groupKey', n: { $sum: 1 } } },
          atLeastMinCount,
          { $group: { _id: null, count: { $sum: '$n' } } },
        ],
      },
    },
  ];
}
