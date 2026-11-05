import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockGraphFetch = vi.fn();
vi.mock('../graphClient.js', () => ({
  graphFetch: (...args: unknown[]) => mockGraphFetch(...args),
  GraphApiError: class GraphApiError extends Error {},
}));

vi.mock('../metadataExtractor.js', () => ({ extractMetadata: vi.fn(() => ({})) }));

const mockEvaluate = vi.fn();
vi.mock('../ruleEngine.js', () => ({
  evaluateRulesForMessage: (...args: unknown[]) => mockEvaluate(...args),
}));

const mockExecute = vi.fn();
vi.mock('../actionExecutor.js', () => ({
  executeActions: (...args: unknown[]) => mockExecute(...args),
}));

const mockIsExempt = vi.fn();
vi.mock('../stagingManager.js', () => ({
  isRuleExemptFolder: (...args: unknown[]) => mockIsExempt(...args),
}));

const mailboxId = new Types.ObjectId();
const userId = new Types.ObjectId();

vi.mock('../../models/WebhookSubscription.js', () => ({
  WebhookSubscription: {
    findOne: vi.fn(() => Promise.resolve({ _id: new Types.ObjectId(), userId, mailboxId })),
    findByIdAndUpdate: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../models/Mailbox.js', () => ({
  Mailbox: { findById: vi.fn(() => ({ select: () => Promise.resolve({ email: 'user@example.com' }) })) },
}));

vi.mock('../../models/EmailEvent.js', () => ({
  EmailEvent: { create: vi.fn().mockResolvedValue({ _id: 'evt', userId, mailboxId }) },
}));

vi.mock('../../config/socket.js', () => ({
  getIO: () => {
    throw new Error('socket not initialised');
  },
}));

vi.mock('../../auth/tokenManager.js', () => ({
  getAccessTokenForMailbox: vi.fn().mockResolvedValue('token-123'),
}));

vi.mock('../../jobs/queues.js', () => ({
  queues: {
    'email-embedding': { add: vi.fn().mockResolvedValue({}) },
    'body-prefetch': { add: vi.fn().mockResolvedValue({}) },
  },
}));

const { processChangeNotification } = await import('../eventCollector.js');

const created = {
  subscriptionId: 'sub-1',
  changeType: 'created',
  resource: 'users/u/messages/msg-1',
  resourceData: { id: 'msg-1' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGraphFetch.mockResolvedValue({
    json: () => Promise.resolve({ id: 'msg-1', parentFolderId: 'folder-x' }),
  });
  mockEvaluate.mockResolvedValue({
    matched: true,
    ruleId: 'rule-1',
    actions: [{ actionType: 'delete' }],
  });
});

describe('rules on a newly created message', () => {
  it('does not act on mail landing in a rule-exempt folder', async () => {
    mockIsExempt.mockResolvedValue(true);

    await processChangeNotification(created);

    expect(mockIsExempt).toHaveBeenCalledWith('user@example.com', 'folder-x', 'token-123');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('still acts on mail landing anywhere else', async () => {
    mockIsExempt.mockResolvedValue(false);

    await processChangeNotification(created);

    expect(mockExecute).toHaveBeenCalledTimes(1);
  });
});
