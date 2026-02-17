import { queues } from './queues.js';
import logger from '../config/logger.js';

const schedulerJobOpts = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
};

/**
 * Initialize all 5 job schedulers using BullMQ's upsertJobScheduler API.
 * This replaces the deprecated `repeat` option and is idempotent (safe to call on every startup).
 */
export async function initializeSchedulers(): Promise<void> {
  // 1. Webhook renewal -- every 2 hours (cron)
  await queues['webhook-renewal'].upsertJobScheduler(
    'webhook-renewal-schedule',
    { pattern: '0 */2 * * *' },
    {
      name: 'renew-webhooks',
      data: {},
      opts: schedulerJobOpts,
    }
  );
  logger.info('Scheduler registered: webhook-renewal (every 2 hours)');

  // 2. Delta sync -- every 15 minutes (interval)
  await queues['delta-sync'].upsertJobScheduler(
    'delta-sync-schedule',
    { every: 15 * 60 * 1000 },
    {
      name: 'run-delta-sync',
      data: {},
      opts: schedulerJobOpts,
    }
  );
  logger.info('Scheduler registered: delta-sync (every 15 minutes)');

  // 3. Pattern analysis -- daily at 2 AM (cron)
  await queues['pattern-analysis'].upsertJobScheduler(
    'pattern-analysis-schedule',
    { pattern: '0 2 * * *' },
    {
      name: 'analyze-patterns',
      data: {},
      opts: schedulerJobOpts,
    }
  );
  logger.info('Scheduler registered: pattern-analysis (daily at 2 AM)');

  // 4. Staging processor -- every 30 minutes (interval)
  await queues['staging-processor'].upsertJobScheduler(
    'staging-processor-schedule',
    { every: 30 * 60 * 1000 },
    {
      name: 'process-staging',
      data: {},
      opts: schedulerJobOpts,
    }
  );
  logger.info('Scheduler registered: staging-processor (every 30 minutes)');

  // 5. Token refresh -- every 45 minutes (interval)
  await queues['token-refresh'].upsertJobScheduler(
    'token-refresh-schedule',
    { every: 45 * 60 * 1000 },
    {
      name: 'refresh-tokens',
      data: {},
      opts: schedulerJobOpts,
    }
  );
  logger.info('Scheduler registered: token-refresh (every 45 minutes)');

  logger.info('All 5 job schedulers initialized');
}
