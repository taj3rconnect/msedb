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

async function listen(app: express.Express): Promise<string> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as { port: number };
      resolve(`http://127.0.0.1:${port}/api/rules/rule1`);
    });
  });
}
