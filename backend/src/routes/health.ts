import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { type Redis } from 'ioredis';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { queues } from '../jobs/queues.js';
import { WebhookSubscription, User } from '../models/index.js';
import logger from '../config/logger.js';

// Read version info once at startup (try multiple paths for local dev vs Docker)
let versionInfo = { version: 'v1.01', buildDate: '' };
const __dirname = dirname(fileURLToPath(import.meta.url));
const versionPaths = [
  resolve(__dirname, '../../../version.json'),  // local dev (from backend/src/routes/)
  resolve(__dirname, '../../version.json'),      // Docker (from dist/routes/)
];
for (const vp of versionPaths) {
  try {
    versionInfo = JSON.parse(readFileSync(vp, 'utf-8'));
    break;
  } catch { /* try next */ }
}

const router = Router();

/**
 * GET /api/health
 *
 * Comprehensive health check reporting all subsystem status.
 * Returns 200 if healthy, 503 if degraded.
 *
 * MongoDB and Redis are gates for healthy/degraded status.
 * Subscriptions and tokens are informational only (not gates).
 */
router.get('/api/health', async (req: Request, res: Response) => {
  // Check MongoDB
  const mongoStatus =
    mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';

  // Check Redis
  let redisStatus = 'disconnected';
  try {
    const redis = req.app.get('redis') as Redis;
    if (redis) {
      const pong = await redis.ping();
      redisStatus = pong === 'PONG' ? 'connected' : 'error';
    }
  } catch (error) {
    redisStatus = 'error';
    logger.warn('Redis health check failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Check BullMQ queues
  const activeQueueNames = Object.keys(queues);
  const queueCount = activeQueueNames.length;

  // Check webhook subscriptions (returns 0 in Phase 1, real data in Phase 3+)
  let activeSubscriptions = 0;
  try {
    activeSubscriptions = await WebhookSubscription.countDocuments({
      status: 'active',
    });
  } catch (error) {
    logger.warn('Webhook subscription count failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Check token health (returns 0 in Phase 1, real data in Phase 2+)
  let healthyTokens = 0;
  try {
    healthyTokens = await User.countDocuments({
      'encryptedTokens.accessToken': { $exists: true },
      'encryptedTokens.expiresAt': { $gt: new Date() },
    });
  } catch (error) {
    logger.warn('Token health count failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Compute overall health (only MongoDB and Redis are gates)
  const healthy = mongoStatus === 'connected' && redisStatus === 'connected';

  // Extract MongoDB host (sanitized — no credentials)
  let mongoHost = 'unknown';
  try {
    const uri = mongoose.connection.host;
    const port = mongoose.connection.port;
    mongoHost = uri ? `${uri}:${port}` : 'unknown';
  } catch {
    // ignore
  }

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: versionInfo.version,
    buildDate: versionInfo.buildDate,
    mongoHost,
    services: {
      mongodb: mongoStatus,
      redis: redisStatus,
    },
    queues: {
      count: queueCount,
    },
    subscriptions: {
      active: activeSubscriptions,
    },
    tokens: {
      healthy: healthyTokens,
    },
  });
});

export default router;
