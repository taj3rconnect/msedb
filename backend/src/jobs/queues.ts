import { Queue, Worker, type Job } from 'bullmq';
import { getQueueConnectionConfig, getWorkerConnectionConfig } from '../config/redis.js';
import logger from '../config/logger.js';

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
  'webhook-renewal',
  'delta-sync',
  'pattern-analysis',
  'staging-processor',
  'token-refresh',
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

// Create all 5 queues
export const queues: Record<QueueName, Queue> = {
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

// Placeholder processor -- logs job start/completion
function createProcessor(queueName: string) {
  return async (job: Job): Promise<void> => {
    logger.info('Processing job', { queue: queueName, jobId: job.id, jobName: job.name });
    // Actual job logic will be implemented in later phases
    logger.info('Job completed', { queue: queueName, jobId: job.id, jobName: job.name });
  };
}

// Create all 5 workers (each with its own Redis connection via config object)
const workers: Worker[] = QUEUE_NAMES.map((name) => {
  const worker = new Worker(name, createProcessor(name), {
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
