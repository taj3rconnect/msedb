import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockGraphFetch = vi.fn().mockResolvedValue({ ok: true });
vi.mock('../graphClient.js', () => ({
  graphFetch: (...args: unknown[]) => mockGraphFetch(...args),
  GraphApiError: class GraphApiError extends Error {
    status: number;
    body: string;
    path: string;
    constructor(status: number, body: string, path: string) {
      super(`Graph API error ${status}`);
      this.status = status;
      this.body = body;
      this.path = path;
    }
  },
}));

const mockCreateStagedEmail = vi.fn().mockResolvedValue({});
const mockEnsureStagingFolder = vi.fn().mockResolvedValue('staging-folder-id');
vi.mock('../stagingManager.js', () => ({
  createStagedEmail: (...args: unknown[]) => mockCreateStagedEmail(...args),
  ensureStagingFolder: (...args: unknown[]) => mockEnsureStagingFolder(...args),
}));

const mockFindByIdAndUpdate = vi.fn().mockResolvedValue({});
vi.mock('../../models/Rule.js', () => ({
  Rule: { findByIdAndUpdate: (...args: unknown[]) => mockFindByIdAndUpdate(...args) },
}));

vi.mock('../../models/EmailEvent.js', () => ({
  EmailEvent: { updateMany: vi.fn().mockResolvedValue({}) },
}));

const mockAuditCreate = vi.fn().mockResolvedValue({});
vi.mock('../../models/AuditLog.js', () => ({
  AuditLog: { create: (...args: unknown[]) => mockAuditCreate(...args) },
}));

const { executeActions } = await import('../actionExecutor.js');

const baseParams = {
  mailboxEmail: 'test@example.com',
  messageId: 'msg-1',
  ruleId: new Types.ObjectId(),
  userId: new Types.ObjectId(),
  mailboxId: new Types.ObjectId(),
  originalFolder: 'Inbox',
  accessToken: 'token-123',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('executeActions', () => {
  it('executes a markRead action via PATCH', async () => {
    await executeActions({
      ...baseParams,
      actions: [{ actionType: 'markRead' }],
    });

    expect(mockGraphFetch).toHaveBeenCalledWith(
      expect.stringContaining('/messages/msg-1'),
      'token-123',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(mockFindByIdAndUpdate).toHaveBeenCalled();
    expect(mockAuditCreate).toHaveBeenCalled();
  });

  it('routes delete through staging by default', async () => {
    await executeActions({
      ...baseParams,
      actions: [{ actionType: 'delete' }],
    });

    expect(mockEnsureStagingFolder).toHaveBeenCalled();
    expect(mockCreateStagedEmail).toHaveBeenCalled();
  });

  it('skips staging when skipStaging is true', async () => {
    await executeActions({
      ...baseParams,
      actions: [{ actionType: 'delete' }],
      skipStaging: true,
    });

    expect(mockEnsureStagingFolder).not.toHaveBeenCalled();
    expect(mockCreateStagedEmail).not.toHaveBeenCalled();
    expect(mockGraphFetch).toHaveBeenCalledWith(
      expect.stringContaining('/move'),
      'token-123',
      expect.objectContaining({
        body: JSON.stringify({ destinationId: 'deleteditems' }),
      }),
    );
  });

  it('executes actions in order', async () => {
    await executeActions({
      ...baseParams,
      actions: [
        { actionType: 'markRead', order: 2 },
        { actionType: 'flag', order: 1 },
      ],
    });

    const calls = mockGraphFetch.mock.calls;
    expect(calls.length).toBe(2);
    // flag (order 1) should be first
    expect(JSON.parse(calls[0][2].body)).toHaveProperty('flag');
    // markRead (order 2) should be second
    expect(JSON.parse(calls[1][2].body)).toHaveProperty('isRead');
  });

  it('creates audit log after execution', async () => {
    await executeActions({
      ...baseParams,
      actions: [{ actionType: 'flag' }],
    });

    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'rule_executed',
        targetType: 'email',
        targetId: 'msg-1',
      }),
    );
  });
});
