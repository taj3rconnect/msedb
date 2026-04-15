import { queues } from './queues.js';
import logger from '../config/logger.js';

const schedulerJobOpts = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
};

/**
 * Initialize all 8 job schedulers using BullMQ's upsertJobScheduler API.
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

  // 6. Scheduled email sender -- every 1 minute (interval)
  await queues['scheduled-email'].upsertJobScheduler(
    'scheduled-email-schedule',
    { every: 60 * 1000 },
    {
      name: 'send-scheduled-emails',
      data: {},
      opts: schedulerJobOpts,
    }
  );
  logger.info('Scheduler registered: scheduled-email (every 1 minute)');

  // 7. Contacts sync -- daily at 1 AM EST (6 AM UTC)
  await queues['contacts-sync'].upsertJobScheduler(
    'contacts-sync-schedule',
    { pattern: '0 6 * * *' },
    {
      name: 'sync-contacts',
      data: {},
      opts: schedulerJobOpts,
    }
  );
  logger.info('Scheduler registered: contacts-sync (daily at 1 AM EST)');

  // 8. Daily activity report -- daily at 9 AM EST (14:00 UTC)
  await queues['daily-report'].upsertJobScheduler(
    'daily-report-schedule',
    { pattern: '0 14 * * *' },
    {
      name: 'send-daily-report',
      data: {},
      opts: schedulerJobOpts,
    }
  );
  logger.info('Scheduler registered: daily-report (daily at 9 AM EST)');

  // 9. Scheduled email cleanup -- daily at 3 AM UTC
  await queues['scheduled-email-cleanup'].upsertJobScheduler(
    'scheduled-email-cleanup-schedule',
    { pattern: '0 3 * * *' },
    {
      name: 'cleanup-scheduled-emails',
      data: {},
      opts: schedulerJobOpts,
    }
  );
  logger.info('Scheduler registered: scheduled-email-cleanup (daily at 3 AM UTC)');

  logger.info('All 9 job schedulers initialized');
}
