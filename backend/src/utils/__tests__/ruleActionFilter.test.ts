import { describe, it, expect } from 'vitest';
import {
  applyRuleActionFilter,
  resolveRuleActionField,
} from '../ruleActionFilter.js';

describe('resolveRuleActionField', () => {
  it('maps the two public filter values to provenance fields', () => {
    expect(resolveRuleActionField('read')).toBe('metadata.ruleMarkedReadAt');
    expect(resolveRuleActionField('deleted')).toBe('metadata.ruleDeletedAt');
  });

  it('returns undefined for anything else', () => {
    for (const v of ['all', 'unread', '', 'READ', undefined, null, 7, {}]) {
      expect(resolveRuleActionField(v)).toBeUndefined();
    }
  });
});

describe('applyRuleActionFilter', () => {
  it('is a no-op when no rule action is requested', () => {
    const from = new Date('2026-08-25T00:00:00Z');
    const filter: Record<string, unknown> = {
      userId: 'u1',
      timestamp: { $gte: from },
    };
    applyRuleActionFilter(filter, 'all');
    expect(filter).toEqual({ userId: 'u1', timestamp: { $gte: from } });
  });

  it('requires the provenance field to exist for ruleAction=read', () => {
    const filter: Record<string, unknown> = { userId: 'u1' };
    applyRuleActionFilter(filter, 'read');
    expect(filter['metadata.ruleMarkedReadAt']).toEqual({
      $exists: true,
      $ne: null,
    });
  });

  it('MOVES the date window from arrival time onto the action time', () => {
    // The regression this guards: an email that ARRIVED last week but was
    // deleted by a rule today must still appear under "Deleted / Today".
    const from = new Date('2026-08-25T00:00:00Z');
    const to = new Date('2026-08-25T23:59:59Z');
    const filter: Record<string, unknown> = {
      userId: 'u1',
      timestamp: { $gte: from, $lte: to },
    };

    applyRuleActionFilter(filter, 'deleted');

    expect(filter.timestamp).toBeUndefined();
    expect(filter['metadata.ruleDeletedAt']).toEqual({
      $exists: true,
      $ne: null,
      $gte: from,
      $lte: to,
    });
  });

  it('keeps unrelated filter keys untouched', () => {
    const filter: Record<string, unknown> = {
      userId: 'u1',
      mailboxId: 'm1',
      eventType: 'arrived',
    };
    applyRuleActionFilter(filter, 'read');
    expect(filter.userId).toBe('u1');
    expect(filter.mailboxId).toBe('m1');
    expect(filter.eventType).toBe('arrived');
  });

  it('works with no date window at all', () => {
    const filter: Record<string, unknown> = { userId: 'u1' };
    applyRuleActionFilter(filter, 'deleted');
    expect(filter['metadata.ruleDeletedAt']).toEqual({
      $exists: true,
      $ne: null,
    });
  });
});
