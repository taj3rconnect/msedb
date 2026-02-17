import { Redis } from 'ioredis';
import { config } from './index.js';
import logger from './logger.js';

/**
 * Redis connection config for BullMQ Queue instances.
 * Passed as plain object to avoid ioredis version mismatch with BullMQ's bundled ioredis.
 * enableOfflineQueue: false -- fail fast when Redis is unreachable.
 */
export function getQueueConnectionConfig() {
  return {
    host: config.redisHost,
    port: config.redisPort,
    enableOfflineQueue: false,
  };
}

/**
 * Redis connection config for BullMQ Worker instances.
 * maxRetriesPerRequest: null -- REQUIRED for BullMQ workers (blocking operations).
 */
export function getWorkerConnectionConfig() {
  return {
    host: config.redisHost,
    port: config.redisPort,
    maxRetriesPerRequest: null as null,
  };
}

let generalClient: Redis | null = null;

/**
 * Get a general-purpose Redis client (for health checks, rate limiting, etc.).
 * Returns a singleton instance using the project's ioredis.
 */
export function getRedisClient(): Redis {
  if (!generalClient) {
    generalClient = new Redis({
      host: config.redisHost,
      port: config.redisPort,
    });

    generalClient.on('connect', () => {
      logger.info('Redis general client connected');
    });

    generalClient.on('error', (err: Error) => {
      logger.error('Redis general client error', { error: err.message });
    });
  }

  return generalClient;
}
