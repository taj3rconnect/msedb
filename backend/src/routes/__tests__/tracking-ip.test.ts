import { describe, it, expect, vi, beforeEach } from 'vitest';

const recordOpen = vi.fn();
vi.mock('../../services/trackingService.js', () => ({
  TRACKING_PIXEL: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  recordOpen: (...args: unknown[]) => recordOpen(...args),
}));

const router = (await import('../tracking.js')).default;

/** Pull the GET /track/open/:trackingId.png handler straight off the router stack. */
type Handler = (req: unknown, res: unknown) => void;
function getHandler(): Handler {
  const layers = (router as unknown as {
    stack: Array<{ route?: { path: string; stack: Array<{ handle: Handler }> } }>;
  }).stack;
  const layer = layers.find((l) => l.route?.path === '/open/:trackingId.png');
  if (!layer?.route) throw new Error('GET /open/:trackingId.png route not found');
  return layer.route.stack[0].handle;
}

function makeRes() {
  return {
    set: vi.fn(),
    end: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// L2-002: the dedup key and stored IP must come from Express's own resolved
// req.ip (trust-proxy aware), never from raw request headers a pixel-URL
// holder can forge to rotate past the open-dedup window.
describe('GET /track/open/:trackingId.png', () => {
  it('uses req.ip and ignores a forged X-Forwarded-For / X-Real-IP header', () => {
    const req = {
      params: { trackingId: 'tid-1' },
      headers: {
        'x-forwarded-for': '203.0.113.9',
        'x-real-ip': '198.51.100.9',
        'user-agent': 'test-agent',
      },
      ip: '10.0.0.5',
    };

    getHandler()(req, makeRes());

    expect(recordOpen).toHaveBeenCalledWith('tid-1', '10.0.0.5', 'test-agent');
  });
});
