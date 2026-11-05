import { describe, it, expect } from 'vitest';
import {
  collectSenderEmails,
  buildSenderActionMap,
  attachSenderRuleActions,
} from '../senderRuleActions.js';

describe('collectSenderEmails', () => {
  it('returns distinct lowercased emails and skips blanks', () => {
    const emails = collectSenderEmails([
      { sender: { email: 'Boss@Example.com' } },
      { sender: { email: 'boss@example.com' } },
      { sender: { email: '  ' } },
      { sender: { email: null } },
      { sender: null },
      {},
      { sender: { email: 'news@vendor.io' } },
    ]);
    expect(emails.sort()).toEqual(['boss@example.com', 'news@vendor.io']);
  });
});

describe('buildSenderActionMap', () => {
  it('maps a single-sender rule to its action types', () => {
    const map = buildSenderActionMap([
      { conditions: { senderEmail: 'news@vendor.io' }, actions: [{ actionType: 'markRead' }] },
    ]);
    expect(map.get('news@vendor.io')).toEqual(['markRead']);
  });

  it('matches case-insensitively, like POST /api/rules/delete-by-sender', () => {
    const map = buildSenderActionMap([
      { conditions: { senderEmail: 'News@Vendor.IO' }, actions: [{ actionType: 'delete' }] },
    ]);
    expect(map.get('news@vendor.io')).toEqual(['delete']);
  });

  it('handles the array form of conditions.senderEmail', () => {
    const map = buildSenderActionMap([
      {
        conditions: { senderEmail: ['a@x.com', 'B@X.com'] },
        actions: [{ actionType: 'archive' }],
      },
    ]);
    expect(map.get('a@x.com')).toEqual(['archive']);
    expect(map.get('b@x.com')).toEqual(['archive']);
  });

  it('unions distinct actions across multiple rules for the same sender', () => {
    const map = buildSenderActionMap([
      { conditions: { senderEmail: 'news@vendor.io' }, actions: [{ actionType: 'markRead' }] },
      {
        conditions: { senderEmail: 'news@vendor.io' },
        actions: [{ actionType: 'delete' }, { actionType: 'markRead' }],
      },
    ]);
    expect(map.get('news@vendor.io')).toEqual(['markRead', 'delete']);
  });

  it('ignores rules with no sender condition or no actions', () => {
    const map = buildSenderActionMap([
      { conditions: { senderEmail: null }, actions: [{ actionType: 'delete' }] },
      { conditions: { senderEmail: 'empty@x.com' }, actions: [] },
      { conditions: { senderEmail: 'nulls@x.com' }, actions: [{ actionType: null }] },
    ]);
    expect(map.size).toBe(0);
  });
});

describe('attachSenderRuleActions', () => {
  it('attaches matching actions and an empty array when the sender has none', () => {
    const map = buildSenderActionMap([
      { conditions: { senderEmail: 'news@vendor.io' }, actions: [{ actionType: 'markRead' }] },
    ]);
    const enriched = attachSenderRuleActions(
      [
        { _id: '1', sender: { email: 'News@Vendor.io' } },
        { _id: '2', sender: { email: 'clean@nobody.com' } },
        { _id: '3', sender: null },
      ],
      map,
    );
    expect(enriched[0].senderRuleActions).toEqual(['markRead']);
    expect(enriched[1].senderRuleActions).toEqual([]);
    expect(enriched[2].senderRuleActions).toEqual([]);
  });

  it('preserves all original event fields', () => {
    const enriched = attachSenderRuleActions(
      [{ _id: '1', subject: 'hi', sender: { email: 'a@b.com' } }],
      new Map(),
    );
    expect(enriched[0]).toMatchObject({ _id: '1', subject: 'hi' });
  });
});
