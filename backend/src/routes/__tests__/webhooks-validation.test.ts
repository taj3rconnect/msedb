import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('../../config/logger.js', () => ({ default: mockLogger }));

const mockFindOne = vi.fn();
vi.mock('../../models/WebhookSubscription.js', () => ({
  WebhookSubscription: { findOne: (...args: unknown[]) => mockFindOne(...args) },
}));

const mockEventsAdd = vi.fn().mockResolvedValue({ id: 'job-1' });
const mockRenewalAdd = vi.fn().mockResolvedValue({ id: 'job-2' });
vi.mock('../../jobs/queues.js', () => ({
  queues: {
    'webhook-events': { add: (...args: unknown[]) => mockEventsAdd(...args) },
    'webhook-renewal': { add: (...args: unknown[]) => mockRenewalAdd(...args) },
  },
}));

const router = (await import('../webhooks.js')).default;
const { isGraphNotification } = await import('../../utils/graphNotification.js');

/** Pull the POST /webhooks/graph handler straight off the router stack. */
type Handler = (req: unknown, res: unknown) => void;
function getHandler(): Handler {
  const layers = (router as unknown as {
    stack: Array<{ route?: { path: string; stack: Array<{ handle: Handler }> } }>;
  }).stack;
  const layer = layers.find((l) => l.route?.path === '/webhooks/graph');
  if (!layer?.route) throw new Error('POST /webhooks/graph route not found');
  return layer.route.stack[0].handle;
}

function makeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    set: vi.fn(() => res),
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
    send(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

/** Invoke the route and wait for its fire-and-forget enqueue loop to settle. */
async function post(body: unknown) {
  const res = makeRes();
  getHandler()({ query: {}, body }, res);
  // The handler responds 202 synchronously, then enqueues asynchronously.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindOne.mockResolvedValue({ _id: 'sub', clientState: 'secret-state' });
});

describe('isGraphNotification', () => {
  it('accepts a well-formed notification', () => {
    expect(
      isGraphNotification({
        subscriptionId: 'sub-1',
        changeType: 'created',
        resource: 'users/u/messages/m',
        clientState: 'secret-state',
        resourceData: { id: 'msg-1' },
      }),
    ).toBe(true);
  });

  it('rejects a non-string subscriptionId', () => {
    expect(isGraphNotification({ subscriptionId: 123 })).toBe(false);
  });

  it('rejects a Mongo operator object as subscriptionId', () => {
    expect(isGraphNotification({ subscriptionId: { $ne: null } })).toBe(false);
  });

  it('rejects an empty subscriptionId, arrays, null and primitives', () => {
    expect(isGraphNotification({ subscriptionId: '' })).toBe(false);
    expect(isGraphNotification([])).toBe(false);
    expect(isGraphNotification(null)).toBe(false);
    expect(isGraphNotification('sub-1')).toBe(false);
  });

  it('rejects a non-string resourceData.id', () => {
    expect(
      isGraphNotification({ subscriptionId: 'sub-1', resourceData: { id: { $gt: '' } } }),
    ).toBe(false);
  });
});

describe('POST /webhooks/graph validation boundary', () => {
  it('still answers 202 immediately', async () => {
    const res = await post({ value: [] });
    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({ status: 'accepted' });
  });

  it('skips a malformed notification without throwing and without touching Mongo', async () => {
    const res = await post({ value: [{ subscriptionId: 123, changeType: 'created' }] });

    expect(res.statusCode).toBe(202);
    expect(mockFindOne).not.toHaveBeenCalled();
    expect(mockEventsAdd).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('skips a Mongo-operator injection attempt before the subscription lookup', async () => {
    await post({ value: [{ subscriptionId: { $ne: null }, clientState: 'secret-state' }] });

    expect(mockFindOne).not.toHaveBeenCalled();
    expect(mockEventsAdd).not.toHaveBeenCalled();
  });

  it('accepts and enqueues a well-formed change notification', async () => {
    await post({
      value: [
        {
          subscriptionId: 'sub-1',
          changeType: 'created',
          resource: 'users/u/messages/msg-1',
          clientState: 'secret-state',
          resourceData: { id: 'msg-1' },
        },
      ],
    });

    expect(mockFindOne).toHaveBeenCalledWith({ subscriptionId: 'sub-1' });
    expect(mockEventsAdd).toHaveBeenCalledTimes(1);
  });

  it('processes valid notifications even when a malformed one precedes them', async () => {
    await post({
      value: [
        null,
        {
          subscriptionId: 'sub-1',
          changeType: 'created',
          resource: 'users/u/messages/msg-1',
          clientState: 'secret-state',
          resourceData: { id: 'msg-1' },
        },
      ],
    });

    expect(mockEventsAdd).toHaveBeenCalledTimes(1);
  });

  // L2-001 / L3-WH-01: an oversized batch must not turn into one Mongo
  // findOne() per item -- the handler caps the batch before the loop.
  it('caps an oversized notification batch instead of querying Mongo once per item', async () => {
    const oversizedBatch = Array.from({ length: 250 }, (_, i) => ({
      subscriptionId: `sub-${i}`,
      changeType: 'created',
      resource: `users/u/messages/msg-${i}`,
      clientState: 'secret-state',
      resourceData: { id: `msg-${i}` },
    }));

    const res = await post({ value: oversizedBatch });

    expect(res.statusCode).toBe(202);
    expect(mockFindOne.mock.calls.length).toBeLessThanOrEqual(100);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Graph webhook batch exceeds cap -- truncating',
      expect.objectContaining({ received: 250 }),
    );
  });
});
