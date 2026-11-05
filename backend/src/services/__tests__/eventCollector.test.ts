import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockGraphFetch = vi.fn();
vi.mock('../graphClient.js', () => ({
  graphFetch: (...args: unknown[]) => mockGraphFetch(...args),
  GraphApiError: class GraphApiError extends Error {
    status: number;
    body: string;
    path: string;
    constructor(status: number, body: string, path: string) {
      super(`Graph API error ${status}`);
      this.name = 'GraphApiError';
      this.status = status;
      this.body = body;
      this.path = path;
    }
  },
}));

vi.mock('../metadataExtractor.js', () => ({
  extractMetadata: vi.fn(() => ({})),
}));

vi.mock('../ruleEngine.js', () => ({
  evaluateRulesForMessage: vi.fn().mockResolvedValue({ matched: false }),
}));

vi.mock('../actionExecutor.js', () => ({
  executeActions: vi.fn().mockResolvedValue(undefined),
}));

const mailboxId = new Types.ObjectId();
const userId = new Types.ObjectId();

const mockSubscriptionFindOne = vi.fn();
vi.mock('../../models/WebhookSubscription.js', () => ({
  WebhookSubscription: {
    findOne: (...args: unknown[]) => mockSubscriptionFindOne(...args),
    findByIdAndUpdate: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../models/Mailbox.js', () => ({
  Mailbox: {
    findById: vi.fn(() => ({
      select: () => Promise.resolve({ email: 'user@example.com' }),
    })),
  },
}));

vi.mock('../../models/EmailEvent.js', () => ({
  EmailEvent: {
    create: vi.fn().mockResolvedValue({ _id: 'evt', userId, mailboxId }),
    findOne: vi.fn(() => ({ sort: () => ({ lean: () => Promise.resolve(null) }) })),
    updateMany: vi.fn().mockResolvedValue({}),
  },
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
const { GraphApiError } = await import('../graphClient.js');

const notification = {
  subscriptionId: 'sub-1',
  changeType: 'created',
  resource: 'users/u/messages/msg-1',
  resourceData: { id: 'msg-1' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSubscriptionFindOne.mockResolvedValue({
    _id: new Types.ObjectId(),
    userId,
    mailboxId,
    clientState: 'cs',
  });
});

describe('processChangeNotification error propagation', () => {
  it('rejects when the Graph fetch fails with a transient 5xx', async () => {
    mockGraphFetch.mockRejectedValue(new GraphApiError(503, 'unavailable', '/messages/msg-1'));

    await expect(processChangeNotification(notification)).rejects.toBeInstanceOf(GraphApiError);
  });

  it('rejects when the Graph fetch fails with a 429 throttle', async () => {
    mockGraphFetch.mockRejectedValue(new GraphApiError(429, 'throttled', '/messages/msg-1'));

    await expect(processChangeNotification(notification)).rejects.toBeInstanceOf(GraphApiError);
  });

  it('rejects on an unexpected non-Graph error (e.g. DB blip)', async () => {
    mockSubscriptionFindOne.mockRejectedValue(new Error('mongo connection lost'));

    await expect(processChangeNotification(notification)).rejects.toThrow('mongo connection lost');
  });

  it('resolves for the terminal 404 case (message already deleted)', async () => {
    mockGraphFetch.mockRejectedValue(new GraphApiError(404, 'not found', '/messages/msg-1'));

    await expect(processChangeNotification(notification)).resolves.toBeUndefined();
  });

  it('resolves for the terminal 403 case (access revoked)', async () => {
    mockGraphFetch.mockRejectedValue(new GraphApiError(403, 'forbidden', '/messages/msg-1'));

    await expect(processChangeNotification(notification)).resolves.toBeUndefined();
  });
});
