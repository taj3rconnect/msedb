import { Queue, Worker, type Job } from 'bullmq';
import { getQueueConnectionConfig, getWorkerConnectionConfig } from '../config/redis.js';
import logger from '../config/logger.js';
import { processTokenRefresh } from './processors/tokenRefresh.js';
import { processWebhookRenewal } from './processors/webhookRenewal.js';
import { processWebhookEvent } from './processors/webhookEvents.js';
import { processDeltaSync } from './processors/deltaSync.js';
import { processPatternAnalysis } from './processors/patternAnalysis.js';
import { processStagingItems } from './processors/stagingProcessor.js';

// Connection configs (plain objects avoid ioredis version conflicts with BullMQ)
const queueConnectionConfig = getQueueConnectionConfig();
const workerConnectionConfig = getWorkerConnectionConfig();

// Default job options: auto-remove completed/failed jobs by age and count
const defaultJobOptions = {
  removeOnComplete: { age: 3600, count: 200 } as const,
  removeOnFail: { age: 86400, count: 1000 } as const,
};

// Queue names
const QUEUE_NAMES = [
  'webhook-events',
  'webhook-renewal',
  'delta-sync',
  'pattern-analysis',
  'staging-processor',
  'token-refresh',
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

// Create all 6 queues
export const queues: Record<QueueName, Queue> = {
  'webhook-events': new Queue('webhook-events', {
    connection: queueConnectionConfig,
    defaultJobOptions,
  }),
  'webhook-renewal': new Queue('webhook-renewal', {
    connection: queueConnectionConfig,
    defaultJobOptions,
  }),
  'delta-sync': new Queue('delta-sync', {
    connection: queueConnectionConfig,
    defaultJobOptions,
  }),
  'pattern-analysis': new Queue('pattern-analysis', {
    connection: queueConnectionConfig,
    defaultJobOptions,
  }),
  'staging-processor': new Queue('staging-processor', {
    connection: queueConnectionConfig,
    defaultJobOptions,
  }),
  'token-refresh': new Queue('token-refresh', {
    connection: queueConnectionConfig,
    defaultJobOptions,
  }),
};

// Map queue names to their processor functions
const processorMap: Record<QueueName, (job: Job) => Promise<void>> = {
  'webhook-events': processWebhookEvent,
  'webhook-renewal': processWebhookRenewal,
  'delta-sync': processDeltaSync,
  'pattern-analysis': processPatternAnalysis,
  'staging-processor': processStagingItems,
  'token-refresh': processTokenRefresh,
};

// Create all 6 workers (each with its own Redis connection via config object)
const workers: Worker[] = QUEUE_NAMES.map((name) => {
  const worker = new Worker(name, processorMap[name], {
    connection: workerConnectionConfig,
  });

  worker.on('completed', (job: Job) => {
    logger.info('Worker job completed', { queue: name, jobId: job.id, jobName: job.name });
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error('Worker job failed', {
      queue: name,
      jobId: job?.id,
      jobName: job?.name,
      error: err.message,
    });
  });

  return worker;
});

/**
 * Gracefully close all workers.
 */
export async function closeAllWorkers(): Promise<void> {
  logger.info('Closing all BullMQ workers...');
  await Promise.all(workers.map((worker) => worker.close()));
  logger.info('All BullMQ workers closed');
}

/**
 * Gracefully close all queues.
 */
export async function closeAllQueues(): Promise<void> {
  logger.info('Closing all BullMQ queues...');
  await Promise.all(Object.values(queues).map((queue) => queue.close()));
  logger.info('All BullMQ queues closed');
}
