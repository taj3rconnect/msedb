import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { type Redis } from 'ioredis';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import { queues } from '../jobs/queues.js';
import { WebhookSubscription, User } from '../models/index.js';
import logger from '../config/logger.js';
import { config } from '../config/index.js';
import { checkOllamaHealth } from '../services/ollamaClient.js';
import { getCollectionInfo } from '../services/qdrantClient.js';

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
 * Qdrant, Ollama, subscriptions and tokens are informational only (not gates).
 *
 * Publicly reachable: unauthenticated callers get the minimal payload.
 * Extended diagnostics require a verified session JWT.
 */
const healthHandler = async (req: Request, res: Response): Promise<void> => {
  // Extended diagnostics require a VERIFIED session JWT — mere presence of a
  // cookie or Authorization header proves nothing and must not unlock recon.
  // Resolved first so the public path stays cheap: the outbound Qdrant/Ollama
  // probes below only run for authenticated callers, keeping the watchdog's
  // basic check fast and free of third-party latency.
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : undefined;
  const sessionToken = req.cookies?.msedb_session || bearer;
  let hasAuth = false;
  if (sessionToken) {
    try {
      jwt.verify(sessionToken, config.jwtSecret);
      hasAuth = true;
    } catch {
      // Invalid/expired token — fall back to the minimal public payload
      hasAuth = false;
    }
  }

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

  // Check Qdrant (documented hard dependency) and Ollama. Both are
  // INFORMATIONAL ONLY — they never gate healthy/degraded. Each is guarded in
  // its own try/catch so a failing probe reports "unavailable" rather than
  // throwing the whole health route.
  let qdrantStatus = 'unavailable';
  let qdrantPointCount: number | undefined;
  let ollamaStatus = 'unavailable';
  let ollamaModels: { embed: boolean; instruct: boolean } | undefined;
  if (hasAuth) {
    try {
      const info = await getCollectionInfo();
      if (info) {
        qdrantStatus = 'connected';
        qdrantPointCount = info.pointCount;
      }
    } catch (error) {
      logger.warn('Qdrant health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const models = await checkOllamaHealth();
      ollamaModels = models;
      ollamaStatus =
        models.embed && models.instruct
          ? 'connected'
          : models.embed || models.instruct
            ? 'degraded'
            : 'unavailable';
    } catch (error) {
      logger.warn('Ollama health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
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

  if (!hasAuth) {
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'degraded',
      version: versionInfo.version,
    });
    return;
  }

  // Informational subsystem status. MongoDB and Redis are the only gates;
  // qdrant and ollama are surfaced here for visibility without affecting
  // healthy/degraded semantics.
  const services = {
    mongodb: mongoStatus,
    redis: redisStatus,
    qdrant: qdrantStatus,
    ollama: ollamaStatus,
  };

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: versionInfo.version,
    buildDate: versionInfo.buildDate,
    mongoHost,
    services,
    qdrant: {
      status: qdrantStatus,
      pointCount: qdrantPointCount,
    },
    ollama: {
      status: ollamaStatus,
      models: ollamaModels,
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
};

router.get('/api/health', healthHandler);

// Additive alias for the Per-App Standard path. `/api/health` MUST stay — the
// smoke tests, deploy agents, DEPLOY.md and RUNBOOK.md all consume it.
router.get('/api/v1/health', healthHandler);

export default router;
