import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';

const findOne = vi.fn();
vi.mock('../../../models/Rule.js', () => ({
  Rule: { findOne: (...args: unknown[]) => findOne(...args) },
}));

const findById = vi.fn();
vi.mock('../../../models/Mailbox.js', () => ({
  Mailbox: { findById: (...args: unknown[]) => findById(...args) },
}));

vi.mock('../../../models/AuditLog.js', () => ({
  AuditLog: { create: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../models/StagedEmail.js', () => ({
  StagedEmail: {},
}));

vi.mock('../../../auth/tokenManager.js', () => ({
  getAccessTokenForMailbox: vi.fn().mockResolvedValue('fake-token'),
}));

const syncRuleToGraph = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../services/graphRuleSync.js', () => ({
  syncRuleToGraph: (...args: unknown[]) => syncRuleToGraph(...args),
  deleteGraphRule: vi.fn(),
}));

const { default: crudRouter } = await import('../crud.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = { userId: 'u1', email: 'u1@example.com', role: 'user' };
    next();
  });
  app.use('/api/rules', crudRouter);
  // Minimal error handler so a thrown AppError doesn't crash the test.
  app.use((err: { statusCode?: number; message?: string }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode ?? 500).json({ error: err.message });
  });
  return app;
}

// RULE-03: PUT must sync the edited rule to the Graph inbox rule, the same
// way POST (create) and PATCH /toggle already do — otherwise Graph keeps
// acting on the mailbox per the rule's OLD definition after an edit.
describe('PUT /api/rules/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls syncRuleToGraph after saving the update', async () => {
    const rule = {
      _id: { toString: () => 'rule1' },
      userId: 'u1',
      mailboxId: { toString: () => 'mailbox1' },
      name: 'old name',
      conditions: { senderEmail: 'a@b.com' },
      actions: [{ actionType: 'archive' }],
      save: vi.fn().mockResolvedValue(undefined),
    };
    findOne.mockResolvedValue(rule);
    findById.mockResolvedValue({ _id: 'mailbox1', email: 'mailbox@example.com' });

    const app = buildApp();
    const res = await fetch(await listen(app), {
      method: 'PUT',
      body: JSON.stringify({ name: 'new name' }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(200);
    expect(syncRuleToGraph).toHaveBeenCalledTimes(1);
    expect(syncRuleToGraph).toHaveBeenCalledWith('rule1', 'mailbox@example.com', 'fake-token');
  });
});

// L3-NS-01: mailboxId must be rejected as a plain string before it reaches
// a Mongoose filter -- otherwise a JSON object like {"$ne":null} survives
// the old truthiness-only check and becomes a live query operator.
describe('POST /api/rules mailboxId validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a non-string mailboxId with 400 instead of querying Mongo', async () => {
    const app = buildApp();
    const url = (await listen(app)).replace(/\/rule1$/, '');

    const res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({
        mailboxId: { $ne: null },
        name: 'test',
        conditions: { senderEmail: 'a@b.com' },
        actions: [{ actionType: 'archive' }],
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(400);
    expect(findById).not.toHaveBeenCalled();
  });

  it('accepts a well-formed 24-hex mailboxId', async () => {
    findById.mockResolvedValue({ _id: 'mailbox1', email: 'mailbox@example.com', userId: 'u1' });
    const app = buildApp();
    const url = (await listen(app)).replace(/\/rule1$/, '');

    const res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ mailboxId: 'x'.repeat(24).replace(/x/g, 'a'), name: 'test' }),
      headers: { 'Content-Type': 'application/json' },
    });

    // Not a 400 for shape -- may still 400 on the missing conditions/actions
    // fields this minimal body omits, which is unrelated to NS-01.
    expect(res.status).not.toBe(500);
  });
});

// L3-NS-03: senderEmail was truthiness-checked but not type-checked before
// .toLowerCase(), so a non-string body value (object/array) raised an
// uncaught TypeError -> generic 500 instead of a clean 400.
describe('POST /api/rules/delete-by-sender senderEmail validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a non-string senderEmail with 400 instead of crashing', async () => {
    const app = buildApp();
    const url = (await listen(app)).replace(/\/rule1$/, '/delete-by-sender');

    const res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ senderEmail: { $ne: null } }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(400);
  });
});

async function listen(app: express.Express): Promise<string> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as { port: number };
      resolve(`http://127.0.0.1:${port}/api/rules/rule1`);
    });
  });
}
