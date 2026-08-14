import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * DB-04: deleting a Rule must not leave StagedEmail documents whose required
 * `ruleId` ref points at a rule that no longer exists.
 *
 * Both delete paths (`POST /api/rules/delete-by-sender` and `DELETE /api/rules/:id`)
 * are driven against an in-memory StagedEmail/Rule store, and the assertion is the
 * real invariant: after the handler runs, querying the store for
 * `{ ruleId: <deleted rule>, status: 'staged' }` returns nothing.
 *
 * Staged emails are RETIRED (status -> 'expired'), never deleted — no stored data
 * is destroyed. 'expired' is a declared value of the StagedEmail status enum
 * (see src/models/StagedEmail.ts).
 */

const USER_ID = 'user-1';

type StagedDoc = { _id: string; ruleId: string; status: string };
type RuleDoc = {
  _id: { toString: () => string };
  userId: string;
  name: string;
  mailboxId: null;
  graphRuleId: null;
  conditions: { senderEmail: string };
  actions: unknown[];
  priority: number;
};

// ---- in-memory stores -------------------------------------------------------

let ruleStore: RuleDoc[] = [];
let stagedStore: StagedDoc[] = [];

const makeRule = (id: string, senderEmail: string): RuleDoc => ({
  _id: { toString: () => id },
  userId: USER_ID,
  name: `rule-${id}`,
  mailboxId: null,
  graphRuleId: null,
  conditions: { senderEmail },
  actions: [],
  priority: 1,
});

/** Matches a store doc against a (flat) mongo-ish filter. */
const matches = (doc: Record<string, unknown>, filter: Record<string, unknown>) =>
  Object.entries(filter).every(([k, v]) => {
    const actual = doc[k];
    const expected =
      v && typeof v === 'object' && 'toString' in (v as object) ? String(v) : v;
    return (typeof actual === 'object' && actual !== null ? String(actual) : actual) === expected;
  });

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../middleware/errorHandler.js', () => {
  class AppError extends Error {}
  return {
    AppError,
    NotFoundError: class NotFoundError extends AppError {},
    ValidationError: class ValidationError extends AppError {},
  };
});

vi.mock('../../auth/middleware.js', () => ({
  getUserId: () => USER_ID,
}));

vi.mock('../../auth/tokenManager.js', () => ({
  getAccessTokenForMailbox: vi.fn().mockResolvedValue('token'),
}));

vi.mock('../../services/graphRuleSync.js', () => ({
  syncRuleToGraph: vi.fn(),
  deleteGraphRule: vi.fn(),
}));

vi.mock('../../models/Mailbox.js', () => ({
  Mailbox: { findById: vi.fn().mockResolvedValue(null) },
}));

vi.mock('../../models/AuditLog.js', () => ({
  AuditLog: { create: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../../models/Rule.js', () => ({
  Rule: {
    find: vi.fn(async (filter: Record<string, unknown>) =>
      ruleStore.filter((r) => r.userId === filter.userId)
    ),
    findOne: vi.fn(async (filter: Record<string, unknown>) =>
      ruleStore.find(
        (r) => r._id.toString() === String(filter._id) && r.userId === filter.userId
      ) ?? null
    ),
    deleteOne: vi.fn(async (filter: Record<string, unknown>) => {
      ruleStore = ruleStore.filter((r) => r._id.toString() !== String(filter._id));
      return { deletedCount: 1 };
    }),
  },
}));

vi.mock('../../models/StagedEmail.js', () => ({
  StagedEmail: {
    find: vi.fn(async (filter: Record<string, unknown>) =>
      stagedStore.filter((s) => matches(s as unknown as Record<string, unknown>, filter))
    ),
    updateMany: vi.fn(
      async (
        filter: Record<string, unknown>,
        update: { $set: Record<string, unknown> }
      ) => {
        let modified = 0;
        for (const doc of stagedStore) {
          if (matches(doc as unknown as Record<string, unknown>, filter)) {
            Object.assign(doc, update.$set);
            modified++;
          }
        }
        return { modifiedCount: modified };
      }
    ),
  },
}));

import crudRouter from '../rules/crud.js';
import { StagedEmail } from '../../models/StagedEmail.js';

/** Pulls the real handler for a given method+path out of the express router. */
function handlerFor(method: string, path: string) {
  const layer = (crudRouter as unknown as { stack: any[] }).stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method]
  );
  if (!layer) throw new Error(`No ${method.toUpperCase()} ${path} route on crudRouter`);
  const handlers = layer.route.stack.map((s: any) => s.handle);
  return handlers[handlers.length - 1];
}

async function invoke(handler: any, req: any) {
  const res = { json: vi.fn().mockReturnThis(), status: vi.fn().mockReturnThis() };
  await handler(req, res, (err?: unknown) => {
    if (err) throw err;
  });
  return res;
}

/** The invariant under test, asked of the store the same way a repair script would. */
async function orphanedStagedCount(ruleId: string) {
  const orphans = await StagedEmail.find({ ruleId, status: 'staged' } as never);
  return (orphans as unknown as StagedDoc[]).length;
}

beforeEach(() => {
  ruleStore = [makeRule('rule-a', 'spam@example.com')];
  stagedStore = [
    { _id: 'staged-1', ruleId: 'rule-a', status: 'staged' },
    { _id: 'staged-2', ruleId: 'rule-a', status: 'staged' },
    { _id: 'staged-3', ruleId: 'rule-a', status: 'executed' },
    { _id: 'staged-4', ruleId: 'rule-b', status: 'staged' },
  ];
});

describe('DELETE /api/rules/:id leaves no orphaned staged emails', () => {
  it('retires pending staged emails for the deleted rule', async () => {
    expect(await orphanedStagedCount('rule-a')).toBe(2);

    await invoke(handlerFor('delete', '/:id'), { params: { id: 'rule-a' }, body: {} });

    expect(ruleStore.find((r) => r._id.toString() === 'rule-a')).toBeUndefined();
    expect(await orphanedStagedCount('rule-a')).toBe(0);
  });

  it('expires rather than deletes them, and leaves other rules alone', async () => {
    await invoke(handlerFor('delete', '/:id'), { params: { id: 'rule-a' }, body: {} });

    expect(stagedStore).toHaveLength(4); // nothing destroyed
    expect(stagedStore.find((s) => s._id === 'staged-1')!.status).toBe('expired');
    expect(stagedStore.find((s) => s._id === 'staged-2')!.status).toBe('expired');
    expect(stagedStore.find((s) => s._id === 'staged-3')!.status).toBe('executed');
    expect(stagedStore.find((s) => s._id === 'staged-4')!.status).toBe('staged');
  });
});

describe('POST /api/rules/delete-by-sender leaves no orphaned staged emails', () => {
  it('retires pending staged emails for every rule it deletes', async () => {
    expect(await orphanedStagedCount('rule-a')).toBe(2);

    const res = await invoke(handlerFor('post', '/delete-by-sender'), {
      params: {},
      body: { senderEmail: 'Spam@Example.com' },
    });

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ deleted: 1, failed: 0 })
    );
    expect(ruleStore.find((r) => r._id.toString() === 'rule-a')).toBeUndefined();
    expect(await orphanedStagedCount('rule-a')).toBe(0);
    expect(stagedStore).toHaveLength(4); // nothing destroyed
  });
});
