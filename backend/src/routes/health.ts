import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { type Redis } from 'ioredis';
import { queues } from '../jobs/queues.js';
import { WebhookSubscription, User } from '../models/index.js';
import logger from '../config/logger.js';

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

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: '1.0.0',
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
