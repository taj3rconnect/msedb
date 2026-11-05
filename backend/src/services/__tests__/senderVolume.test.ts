import { describe, expect, it } from 'vitest';
import type { PipelineStage } from 'mongoose';
import { ValidationError } from '../../middleware/errorHandler.js';
import {
  buildSenderVolumeCountsPipeline,
  buildSenderVolumeListPipeline,
  MAX_SENDER_COUNT,
  parseSenderVolumeFilter,
} from '../senderVolume.js';

const MATCH = { isRead: false };
const LIST_OPTIONS = { page: 2, limit: 50, project: { subject: 1 } } as const;

function stage(pipeline: PipelineStage[], name: string) {
  return pipeline.find((s) => name in s) as Record<string, any> | undefined;
}

describe('parseSenderVolumeFilter', () => {
  it('reads the count and defaults to grouping by sender', () => {
    expect(parseSenderVolumeFilter({ unreadOnly: 'true', minSenderCount: '5' })).toEqual({
      minCount: 5,
      groupBy: 'sender',
    });
  });

  it('accepts grouping by domain', () => {
    expect(
      parseSenderVolumeFilter({ unreadOnly: 'true', minSenderCount: '3', senderGroupBy: 'domain' }),
    ).toEqual({ minCount: 3, groupBy: 'domain' });
  });

  it('is off when no count is given', () => {
    expect(parseSenderVolumeFilter({ unreadOnly: 'true' })).toBeUndefined();
  });

  it('applies only to the Unread filter', () => {
    expect(parseSenderVolumeFilter({ minSenderCount: '5' })).toBeUndefined();
    expect(
      parseSenderVolumeFilter({ unreadOnly: 'true', minSenderCount: '5', ruleAction: 'read' }),
    ).toBeUndefined();
  });

  it.each(['1', '0', '-3', '2.5', 'abc', '', String(MAX_SENDER_COUNT + 1)])(
    'rejects count %j',
    (minSenderCount) => {
      expect(() => parseSenderVolumeFilter({ unreadOnly: 'true', minSenderCount })).toThrow(
        ValidationError,
      );
    },
  );

  it('rejects a repeated count parameter', () => {
    expect(() =>
      parseSenderVolumeFilter({ unreadOnly: 'true', minSenderCount: ['5', '6'] }),
    ).toThrow(ValidationError);
  });

  it('rejects an unknown grouping', () => {
    expect(() =>
      parseSenderVolumeFilter({ unreadOnly: 'true', minSenderCount: '5', senderGroupBy: 'name' }),
    ).toThrow(ValidationError);
  });
});

describe('buildSenderVolumeListPipeline', () => {
  const filter = { minCount: 5, groupBy: 'sender' } as const;

  it('keeps only groups at or over the threshold', () => {
    const pipeline = buildSenderVolumeListPipeline(MATCH, filter, LIST_OPTIONS);

    expect(pipeline).toContainEqual({ $match: { _groupCount: { $gte: 5 } } });
  });

  it('leaves out rows with no sender', () => {
    const pipeline = buildSenderVolumeListPipeline(MATCH, filter, LIST_OPTIONS);

    expect(pipeline).toContainEqual({ $match: { _groupKey: { $ne: '' } } });
  });

  it('puts the biggest group first and pages inside the facet', () => {
    const { $facet } = stage(buildSenderVolumeListPipeline(MATCH, filter, LIST_OPTIONS), '$facet')!;

    expect($facet.rows).toContainEqual({
      $sort: { _groupCount: -1, _groupKey: 1, timestamp: -1, _id: -1 },
    });
    expect($facet.rows).toContainEqual({ $skip: 50 });
    expect($facet.rows).toContainEqual({ $limit: 50 });
    expect($facet.total).toEqual([{ $count: 'count' }]);
  });

  it('follows the Sender header when it is sorted', () => {
    const { $facet } = stage(
      buildSenderVolumeListPipeline(MATCH, filter, { ...LIST_OPTIONS, senderSortOrder: -1 }),
      '$facet',
    )!;

    expect($facet.rows).toContainEqual({ $sort: { _senderEmail: -1, timestamp: -1, _id: -1 } });
  });

  it('returns the group count on each row', () => {
    const { $facet } = stage(buildSenderVolumeListPipeline(MATCH, filter, LIST_OPTIONS), '$facet')!;

    expect($facet.rows).toContainEqual({
      $project: { subject: 1, senderGroupCount: '$_groupCount' },
    });
  });

  it('groups by a different key for a domain', () => {
    const bySender = stage(buildSenderVolumeListPipeline(MATCH, filter, LIST_OPTIONS), '$addFields');
    const byDomain = stage(
      buildSenderVolumeListPipeline(MATCH, { ...filter, groupBy: 'domain' }, LIST_OPTIONS),
      '$addFields',
    );

    expect(byDomain).not.toEqual(bySender);
  });
});

describe('buildSenderVolumeCountsPipeline', () => {
  it('tallies each mailbox on its own and the unified pill across mailboxes', () => {
    const { $facet } = stage(
      buildSenderVolumeCountsPipeline(MATCH, { minCount: 5, groupBy: 'sender' }),
      '$facet',
    )!;

    expect($facet.perMailbox[0].$group._id).toEqual({ key: '$_groupKey', mailboxId: '$mailboxId' });
    expect($facet.unified[0].$group._id).toBe('$_groupKey');
    expect($facet.perMailbox[1]).toEqual({ $match: { n: { $gte: 5 } } });
    expect($facet.unified[1]).toEqual({ $match: { n: { $gte: 5 } } });
  });
});
