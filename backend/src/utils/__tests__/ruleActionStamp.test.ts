import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 1 });
vi.mock('../../models/EmailEvent.js', () => ({
  EmailEvent: { updateMany: (...args: unknown[]) => updateMany(...args) },
}));

import {
  stampRuleMarkedRead,
  stampRuleDeleted,
  clearRuleDeletedStamp,
} from '../ruleActionStamp.js';
import logger from '../../config/logger.js';

const userId = new Types.ObjectId();
const mailboxId = new Types.ObjectId();
const ruleId = new Types.ObjectId();
const messageId = 'AAMkAExampleArrivalId';

beforeEach(() => {
  updateMany.mockClear();
  updateMany.mockResolvedValue({ modifiedCount: 1 });
});

describe('stampRuleMarkedRead', () => {
  it('records which rule marked it read, and when', async () => {
    const at = new Date('2026-08-25T14:00:00Z');
    await stampRuleMarkedRead({ userId, mailboxId, messageId, ruleId, at });

    const [query, update] = updateMany.mock.calls[0] as [
      Record<string, unknown>,
      { $set: Record<string, unknown> },
    ];

    expect(query.messageId).toBe(messageId);
    expect(String(query.userId)).toBe(String(userId));
    expect(String(query.mailboxId)).toBe(String(mailboxId));

    // isRead still flips -- this REPLACED a bare `$set: { isRead: true }`,
    // so dropping it would regress the inbox read state.
    expect(update.$set.isRead).toBe(true);
    expect(update.$set['metadata.ruleMarkedReadAt']).toBe(at);
    expect(String(update.$set['metadata.ruleMarkedReadBy'])).toBe(String(ruleId));
    expect(String(update.$set['metadata.automatedByRule'])).toBe(String(ruleId));
  });

  it('accepts string ids and casts them to ObjectId', async () => {
    await stampRuleMarkedRead({
      userId: userId.toString(),
      mailboxId: mailboxId.toString(),
      messageId,
      ruleId: ruleId.toString(),
    });
    const [query, update] = updateMany.mock.calls[0] as [
      Record<string, unknown>,
      { $set: Record<string, unknown> },
    ];
    expect(query.userId).toBeInstanceOf(Types.ObjectId);
    expect(update.$set['metadata.ruleMarkedReadBy']).toBeInstanceOf(Types.ObjectId);
  });
});

describe('stampRuleDeleted', () => {
  it('records which rule deleted it, and when', async () => {
    const at = new Date('2026-08-25T15:30:00Z');
    await stampRuleDeleted({ userId, mailboxId, messageId, ruleId, at });

    const [, update] = updateMany.mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    expect(update.$set['metadata.ruleDeletedAt']).toBe(at);
    expect(String(update.$set['metadata.ruleDeletedBy'])).toBe(String(ruleId));
    expect(String(update.$set['metadata.automatedByRule'])).toBe(String(ruleId));
  });

  it('does NOT touch isRead -- deleting is not reading', async () => {
    await stampRuleDeleted({ userId, mailboxId, messageId, ruleId });
    const [, update] = updateMany.mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    expect(update.$set).not.toHaveProperty('isRead');
  });
});

describe('clearRuleDeletedStamp', () => {
  it('unsets both delete-stamp fields so a rescued email leaves the filter', async () => {
    await clearRuleDeletedStamp({ userId, mailboxId, messageId });
    const [, update] = updateMany.mock.calls[0] as [
      unknown,
      { $unset: Record<string, unknown> },
    ];
    expect(update.$unset).toHaveProperty('metadata.ruleDeletedAt');
    expect(update.$unset).toHaveProperty('metadata.ruleDeletedBy');
  });

  it('leaves the read stamp alone -- a rescue only undoes the delete', async () => {
    await clearRuleDeletedStamp({ userId, mailboxId, messageId });
    const [, update] = updateMany.mock.calls[0] as [
      unknown,
      { $unset: Record<string, unknown> },
    ];
    expect(update.$unset).not.toHaveProperty('metadata.ruleMarkedReadAt');
  });
});

describe('failure handling', () => {
  it('logs and swallows a DB error instead of failing the rule execution', async () => {
    // The Graph call has already succeeded by the time we stamp. Throwing here
    // would abort the rest of an approved rule's actions over lost metadata.
    updateMany.mockRejectedValueOnce(new Error('mongo down'));
    await expect(
      stampRuleDeleted({ userId, mailboxId, messageId, ruleId }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
