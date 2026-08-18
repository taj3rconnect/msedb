import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'net';

/**
 * Integration coverage for the REAL health router.
 *
 * The router is mounted on a live Express listener so the assertions exercise
 * the actual route registration and payload shape, not a re-description of it.
 */

const TEST_JWT_SECRET = 'health-test-secret';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../config/index.js', () => ({
  config: { jwtSecret: TEST_JWT_SECRET },
}));

vi.mock('mongoose', () => ({
  default: {
    connection: { readyState: 1, host: 'mongo-test', port: 27017 },
  },
}));

vi.mock('../../jobs/queues.js', () => ({
  queues: { 'webhook-events': {}, 'delta-sync': {} },
}));

vi.mock('../../models/index.js', () => ({
  WebhookSubscription: { countDocuments: vi.fn().mockResolvedValue(3) },
  User: {
    countDocuments: vi.fn().mockResolvedValue(2),
    findById: (...args: unknown[]) => mockUserFindById(...args),
  },
}));

const getCollectionInfo = vi.fn();
const checkOllamaHealth = vi.fn();
const mockUserFindById = vi.fn();
mockUserFindById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ isActive: true }) }) });

vi.mock('../../services/qdrantClient.js', () => ({
  getCollectionInfo: (...args: unknown[]) => getCollectionInfo(...args),
}));

vi.mock('../../services/ollamaClient.js', () => ({
  checkOllamaHealth: (...args: unknown[]) => checkOllamaHealth(...args),
}));

let baseUrl: string;
let server: import('http').Server;

beforeAll(async () => {
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  const healthRouter = (await import('../health.js')).default;

  const app = express();
  app.use(cookieParser());
  app.set('redis', { ping: async () => 'PONG' });
  app.use(healthRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function signedCookie(): Promise<string> {
  const jwt = (await import('jsonwebtoken')).default;
  const token = jwt.sign(
    { userId: 'u1', email: 'test@example.com', role: 'admin' },
    TEST_JWT_SECRET,
    { expiresIn: '5m' },
  );
  return `msedb_session=${token}`;
}

describe('GET /api/health services block (REL-03)', () => {
  it('reports qdrant and ollama status alongside mongodb and redis', async () => {
    getCollectionInfo.mockResolvedValueOnce({ pointCount: 42 });
    checkOllamaHealth.mockResolvedValueOnce({ embed: true, instruct: true });

    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { cookie: await signedCookie() },
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.services).toBeDefined();
    expect(body.services).toHaveProperty('qdrant');
    expect(body.services).toHaveProperty('ollama');
    expect(body.services.qdrant).toBe('connected');
    expect(body.services.ollama).toBe('connected');
    expect(body.services.mongodb).toBe('connected');
    expect(body.services.redis).toBe('connected');
    expect(body.qdrant.pointCount).toBe(42);
  });

  it('reports qdrant/ollama as unavailable when their probes throw, without failing the route', async () => {
    getCollectionInfo.mockRejectedValueOnce(new Error('qdrant down'));
    checkOllamaHealth.mockRejectedValueOnce(new Error('ollama down'));

    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { cookie: await signedCookie() },
    });

    // Qdrant/Ollama are informational — they must NOT gate healthy/degraded.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('healthy');
    expect(body.services.qdrant).toBe('unavailable');
    expect(body.services.ollama).toBe('unavailable');
  });
});

describe('GET /api/health extended diagnostics gating (SEC-05)', () => {
  it('withholds diagnostics from an unverified session cookie', async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { cookie: 'msedb_session=not-a-real-jwt' },
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('healthy');
    expect(body.mongoHost).toBeUndefined();
    expect(body.queues).toBeUndefined();
    expect(body.subscriptions).toBeUndefined();
    expect(body.tokens).toBeUndefined();
  });

  it('withholds diagnostics from a token signed with the wrong secret', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const forged = jwt.sign({ userId: 'u1', role: 'admin' }, 'wrong-secret');

    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { cookie: `msedb_session=${forged}` },
    });

    const body = await res.json();
    expect(body.mongoHost).toBeUndefined();
  });

  it('stays publicly reachable and returns the basic payload unauthenticated', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('healthy');
    expect(body.version).toBeDefined();
  });

  // L3-HEALTH-01: JWT signature validity alone must not unlock diagnostics
  // -- a deleted/deactivated user's still-valid token must be rejected too,
  // same as requireAuth (backend/src/auth/middleware.ts).
  it('withholds diagnostics from a validly-signed token whose user no longer exists', async () => {
    mockUserFindById.mockReturnValueOnce({ select: () => ({ lean: () => Promise.resolve(null) }) });

    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { cookie: await signedCookie() },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('healthy'); // still publicly healthy
    expect(body.mongoHost).toBeUndefined();
    expect(body.queues).toBeUndefined();
  });

  it('withholds diagnostics from a validly-signed token for a deactivated user', async () => {
    mockUserFindById.mockReturnValueOnce({ select: () => ({ lean: () => Promise.resolve({ isActive: false }) }) });

    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { cookie: await signedCookie() },
    });

    const body = await res.json();
    expect(body.mongoHost).toBeUndefined();
  });

  it('grants diagnostics to a verified session JWT', async () => {
    getCollectionInfo.mockResolvedValueOnce({ pointCount: 1 });
    checkOllamaHealth.mockResolvedValueOnce({ embed: true, instruct: true });

    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { cookie: await signedCookie() },
    });

    const body = await res.json();
    expect(body.mongoHost).toBe('mongo-test:27017');
    expect(body.queues.count).toBe(2);
    expect(body.subscriptions.active).toBe(3);
    expect(body.tokens.healthy).toBe(2);
  });
});

describe('health route aliases (UI-08)', () => {
  it('serves the standard /api/v1/health path with the same payload shape', async () => {
    getCollectionInfo.mockResolvedValueOnce({ pointCount: 7 });
    checkOllamaHealth.mockResolvedValueOnce({ embed: true, instruct: true });

    const res = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { cookie: await signedCookie() },
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('healthy');
    expect(body.services).toHaveProperty('qdrant');
    expect(body.services).toHaveProperty('ollama');
  });

  it('keeps the legacy /api/health path working for smoke tests and the watchdog', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('healthy');
  });
});
