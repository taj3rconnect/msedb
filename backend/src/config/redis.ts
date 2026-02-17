import { Redis } from 'ioredis';
import { config } from './index.js';
import logger from './logger.js';

/**
 * Create a Redis connection for BullMQ Queue instances.
 * enableOfflineQueue: false -- fail fast when Redis is unreachable.
 */
export function createQueueConnection(): Redis {
  const connection = new Redis({
    host: config.redisHost,
    port: config.redisPort,
    enableOfflineQueue: false,
  });

  connection.on('connect', () => {
    logger.info('Redis queue connection established');
  });

  connection.on('error', (err: Error) => {
    logger.error('Redis queue connection error', { error: err.message });
  });

  return connection;
}

/**
 * Create a Redis connection for BullMQ Worker instances.
 * maxRetriesPerRequest: null -- REQUIRED for BullMQ workers (blocking operations).
 */
export function createWorkerConnection(): Redis {
  const connection = new Redis({
    host: config.redisHost,
    port: config.redisPort,
    maxRetriesPerRequest: null,
  });

  connection.on('connect', () => {
    logger.info('Redis worker connection established');
  });

  connection.on('error', (err: Error) => {
    logger.error('Redis worker connection error', { error: err.message });
  });

  return connection;
}

let generalClient: Redis | null = null;

/**
 * Get a general-purpose Redis client (for health checks, rate limiting, etc.).
 * Returns a singleton instance.
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
