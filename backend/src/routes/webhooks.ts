import { Router, type Request, type Response } from 'express';
import logger from '../config/logger.js';
import { queues } from '../jobs/queues.js';
import { WebhookSubscription } from '../models/WebhookSubscription.js';

const router = Router();

/**
 * POST /webhooks/graph
 *
 * Handles Microsoft Graph API webhook notifications.
 *
 * Two modes:
 * 1. Validation handshake: Graph sends ?validationToken=xxx during subscription creation.
 *    Must return the token as text/plain with 200.
 * 2. Actual notifications: Return 202 IMMEDIATELY, then validate clientState and enqueue
 *    change/lifecycle notifications into separate BullMQ queues asynchronously.
 *    CRITICAL: Must respond within 3 seconds. No blocking operations before the response.
 */
router.post('/webhooks/graph', (req: Request, res: Response) => {
  // Handle Graph API validation handshake
  const validationToken = req.query.validationToken as string | undefined;
  if (validationToken) {
    logger.info('Graph webhook validation handshake', {
      validationToken: validationToken.substring(0, 20) + '...',
    });
    res.set('Content-Type', 'text/plain');
    res.status(200).send(validationToken);
    return;
  }

  // Handle actual notifications -- respond 202 FIRST, then enqueue
  logger.info('Graph webhook notification received', {
    bodyKeys: Object.keys(req.body || {}),
    valueCount: Array.isArray(req.body?.value) ? req.body.value.length : 0,
  });

  // CRITICAL: Send 202 before any async work
  res.status(202).json({ status: 'accepted' });

  // Fire-and-forget: validate clientState and enqueue notifications after response is sent
  const notifications = req.body?.value ?? [];
  (async () => {
    for (const notification of notifications) {
      try {
        // Look up subscription to validate clientState
        const sub = await WebhookSubscription.findOne({
          subscriptionId: notification.subscriptionId,
        });

        if (!sub) {
          logger.warn('Webhook notification for unknown subscription', {
            subscriptionId: notification.subscriptionId,
          });
          continue;
        }

        if (sub.clientState !== notification.clientState) {
          logger.warn('Webhook notification clientState mismatch -- skipping', {
            subscriptionId: notification.subscriptionId,
          });
          continue;
        }

        // Route lifecycle vs change notifications to separate queues
        if (notification.lifecycleEvent) {
          await queues['webhook-renewal'].add('lifecycle-event', {
            notification,
            subscriptionId: notification.subscriptionId,
          }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
          logger.info('Lifecycle notification enqueued', {
            subscriptionId: notification.subscriptionId,
            lifecycleEvent: notification.lifecycleEvent,
          });
        } else {
          await queues['webhook-events'].add('change-notification', {
            notification,
            subscriptionId: notification.subscriptionId,
          }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
          logger.debug('Change notification enqueued', {
            subscriptionId: notification.subscriptionId,
            resource: notification.resource,
            changeType: notification.changeType,
          });
        }
      } catch (err) {
        logger.error('Failed to enqueue notification', {
          subscriptionId: notification.subscriptionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  })().catch((err) => {
    logger.error('Notification enqueue batch failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
});

export default router;
