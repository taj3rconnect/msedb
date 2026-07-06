import { Queue, Worker, type Job } from 'bullmq';
import { getQueueConnectionConfig, getWorkerConnectionConfig } from '../config/redis.js';
import logger from '../config/logger.js';
import { processTokenRefresh } from './processors/tokenRefresh.js';
import { processWebhookRenewal } from './processors/webhookRenewal.js';
import { processWebhookEvent } from './processors/webhookEvents.js';
import { processDeltaSync } from './processors/deltaSync.js';
import { processPatternAnalysis } from './processors/patternAnalysis.js';
import { processStagingItems } from './processors/stagingProcessor.js';
import { processEmailEmbedding } from './processors/emailEmbedding.js';
import { processScheduledEmail } from './processors/scheduledEmail.js';
import { processContactsSync } from './processors/contactsSync.js';
import { processDailyReport } from './processors/dailyReport.js';
import { processScheduledEmailCleanup } from './processors/scheduledEmailCleanup.js';
import { processBodyPrefetch } from './processors/bodyPrefetch.js';
import { processEmbeddingReconcile } from './processors/embeddingReconcile.js';

// Connection configs (plain objects avoid ioredis version conflicts with BullMQ)
const queueConnectionConfig = getQueueConnectionConfig();
const workerConnectionConfig = getWorkerConnectionConfig();

// Default job options: retries with exponential backoff, plus auto-remove
// completed/failed jobs by age and count. Every queues[...].add() call
// inherits these unless it passes its own opts (per-site override wins).
const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 } as const,
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
  'email-embedding',
  'scheduled-email',
  'contacts-sync',
  'daily-report',
  'scheduled-email-cleanup',
  'body-prefetch',
  'embedding-reconcile',
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

// Create all queues
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
  'email-embedding': new Queue('email-embedding', {
    connection: queueConnectionConfig,
    defaultJobOptions,
  }),
  'scheduled-email': new Queue('scheduled-email', {
    connection: queueConnectionConfig,
    defaultJobOptions,
  }),
  'contacts-sync': new Queue('contacts-sync', {
    connection: queueConnectionConfig,
    defaultJobOptions,
  }),
  'daily-report': new Queue('daily-report', {
    connection: queueConnectionConfig,
    defaultJobOptions,
  }),
  'scheduled-email-cleanup': new Queue('scheduled-email-cleanup', {
    connection: queueConnectionConfig,
    defaultJobOptions,
  }),
  'body-prefetch': new Queue('body-prefetch', {
    connection: queueConnectionConfig,
    defaultJobOptions,
  }),
  'embedding-reconcile': new Queue('embedding-reconcile', {
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
  'email-embedding': processEmailEmbedding,
  'scheduled-email': processScheduledEmail,
  'contacts-sync': processContactsSync,
  'daily-report': processDailyReport,
  'scheduled-email-cleanup': processScheduledEmailCleanup,
  'body-prefetch': processBodyPrefetch,
  'embedding-reconcile': processEmbeddingReconcile,
};

// Per-queue worker concurrency. Anything not listed here defaults to
// BullMQ's concurrency: 1 (strictly serial) — that's deliberate, not an
// oversight, for queues that are order-sensitive or low-volume.
const CONCURRENCY: Partial<Record<QueueName, number>> = {
  // Duplicate-event rule-execution guard now lives in eventCollector, so
  // running several Graph-fetch-bound notifications in parallel is safe.
  'webhook-events': 4,
  // Daily job over many mailboxes; independent per-mailbox work, no shared state.
  'pattern-analysis': 2,
  // Daily job over many mailboxes; independent per-mailbox Graph paging.
  'contacts-sync': 2,
  // 'delta-sync' intentionally left at 1: per-mailbox delta tokens race if
  // two jobs for the same mailbox (e.g. scheduled + lifecycle-triggered) run concurrently.
};

// Create all workers (each with its own Redis connection via config object)
const workers: Worker[] = QUEUE_NAMES.map((name) => {
  const worker = new Worker(name, processorMap[name], {
    connection: workerConnectionConfig,
    concurrency: CONCURRENCY[name] ?? 1,
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
