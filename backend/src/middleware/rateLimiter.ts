import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { RedisReply } from 'rate-limit-redis';
import { getRedisClient } from '../config/redis.js';
import logger from '../config/logger.js';

/**
 * Create rate limiter for auth routes: 5 requests per minute.
 * Uses factory function because Redis client may not be available at import time.
 */
export function createAuthLimiter() {
  const redisClient = getRedisClient();

  return rateLimit({
    windowMs: 60 * 1000, // 1 minute
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
      sendCommand: (command: string, ...args: string[]) =>
        redisClient.call(command, ...args) as Promise<RedisReply>,
      prefix: 'rl:auth:',
    }),
    message: {
      error: {
        message: 'Too many requests, please try again later',
        status: 429,
      },
    },
  });
}

/**
 * Create rate limiter for the Graph webhook endpoint.
 *
 * Generous ceiling (default 600/min/IP, overridable via WEBHOOK_RATE_LIMIT) since
 * Microsoft Graph can burst hard on a busy mailbox -- throttling here means LOST
 * MAIL NOTIFICATIONS in production. Fails open (allows the request) if Redis is
 * unavailable, since a Redis blip must never take down mail ingestion.
 */
export function createWebhookLimiter() {
  const redisClient = getRedisClient();
  const limit = parseInt(process.env.WEBHOOK_RATE_LIMIT || '600', 10);

  return rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: true,
    store: new RedisStore({
      sendCommand: (command: string, ...args: string[]) =>
        redisClient.call(command, ...args) as Promise<RedisReply>,
      prefix: 'rl:webhooks:',
    }),
    handler: (_req, res) => {
      logger.warn('Webhook rate limit exceeded');
      res.status(429).json({
        error: { message: 'Too many requests, please try again later', status: 429 },
      });
    },
  });
}

/**
 * Create rate limiter for the tracking pixel endpoint.
 *
 * Generous ceiling (default 300/min/IP, overridable via TRACKING_RATE_LIMIT).
 * Fails open (allows the request) if Redis is unavailable.
 */
export function createTrackingLimiter() {
  const redisClient = getRedisClient();
  const limit = parseInt(process.env.TRACKING_RATE_LIMIT || '300', 10);

  return rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: true,
    store: new RedisStore({
      sendCommand: (command: string, ...args: string[]) =>
        redisClient.call(command, ...args) as Promise<RedisReply>,
      prefix: 'rl:track:',
    }),
    handler: (_req, res) => {
      logger.warn('Tracking rate limit exceeded');
      res.status(429).json({
        error: { message: 'Too many requests, please try again later', status: 429 },
      });
    },
  });
}

/**
 * Create rate limiter for API routes: 100 requests per minute.
 * Uses factory function because Redis client may not be available at import time.
 */
export function createApiLimiter() {
  const redisClient = getRedisClient();

  return rateLimit({
    windowMs: 60 * 1000, // 1 minute
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
      sendCommand: (command: string, ...args: string[]) =>
        redisClient.call(command, ...args) as Promise<RedisReply>,
      prefix: 'rl:api:',
    }),
    message: {
      error: {
        message: 'Too many requests, please try again later',
        status: 429,
      },
    },
  });
}
