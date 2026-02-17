import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { RedisReply } from 'rate-limit-redis';
import { getRedisClient } from '../config/redis.js';

/**
 * Create rate limiter for auth routes: 5 requests per minute.
 * Uses factory function because Redis client may not be available at import time.
 */
export function createAuthLimiter() {
  const redisClient = getRedisClient();

  return rateLimit({
    windowMs: 60 * 1000, // 1 minute
    limit: 5,
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
