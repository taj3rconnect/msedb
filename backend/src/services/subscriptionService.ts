import { v4 as uuidv4 } from 'uuid';
import { graphFetch, GraphApiError } from './graphClient.js';
import { getAccessTokenForMailbox } from '../auth/tokenManager.js';
import { WebhookSubscription } from '../models/WebhookSubscription.js';
import { Mailbox } from '../models/Mailbox.js';
import { queues } from '../jobs/queues.js';
import { config } from '../config/index.js';
import logger from '../config/logger.js';

/**
 * Create a Graph API webhook subscription for a mailbox.
 *
 * Subscribes to created, updated, and deleted message events using the
 * user's email (not /me/) since background jobs have no user context.
 * The subscription expires in 2 hours and includes a lifecycleNotificationUrl
 * for Graph to send lifecycle events (subscriptionRemoved, missed, reauthorizationRequired).
 */
export async function createSubscription(mailboxId: string) {
  const accessToken = await getAccessTokenForMailbox(mailboxId);

  const mailbox = await Mailbox.findById(mailboxId);
  if (!mailbox) {
    throw new Error(`Mailbox not found: ${mailboxId}`);
  }

  const clientState = uuidv4();

  const subscriptionBody = {
    changeType: 'created,updated,deleted',
    notificationUrl: `${config.graphWebhookUrl}/webhooks/graph`,
    lifecycleNotificationUrl: `${config.graphWebhookUrl}/webhooks/graph`,
    resource: `users/${mailbox.email}/messages`,
    expirationDateTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    clientState,
  };

  const response = await graphFetch('/subscriptions', accessToken, {
    method: 'POST',
    body: JSON.stringify(subscriptionBody),
  });

  const data = await response.json() as {
    id: string;
    resource: string;
    changeType: string;
    expirationDateTime: string;
    notificationUrl: string;
    lifecycleNotificationUrl?: string;
  };

  const webhookSub = await WebhookSubscription.create({
    userId: mailbox.userId,
    mailboxId: mailbox._id,
    subscriptionId: data.id,
    resource: data.resource,
    changeType: data.changeType,
    expiresAt: new Date(data.expirationDateTime),
    notificationUrl: data.notificationUrl,
    lifecycleNotificationUrl: data.lifecycleNotificationUrl,
    clientState,
    status: 'active',
  });

  logger.info('Webhook subscription created', {
    subscriptionId: data.id,
    mailboxId,
    email: mailbox.email,
    expiresAt: data.expirationDateTime,
  });

  return webhookSub;
}

/**
 * Renew an existing Graph API webhook subscription by extending its expiration.
 *
 * PATCHes the subscription with a new expirationDateTime (2 hours from now)
 * and updates the local MongoDB record.
 */
export async function renewSubscription(subscriptionId: string) {
  const sub = await WebhookSubscription.findOne({ subscriptionId });
  if (!sub) {
    throw new Error(`WebhookSubscription not found: ${subscriptionId}`);
  }

  const accessToken = await getAccessTokenForMailbox(sub.mailboxId.toString());

  const newExpiration = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

  await graphFetch(`/subscriptions/${subscriptionId}`, accessToken, {
    method: 'PATCH',
    body: JSON.stringify({ expirationDateTime: newExpiration }),
  });

  sub.expiresAt = new Date(newExpiration);
  sub.status = 'active';
  await sub.save();

  logger.info('Webhook subscription renewed', {
    subscriptionId,
    mailboxId: sub.mailboxId.toString(),
    newExpiresAt: newExpiration,
  });

  return sub;
}

/**
 * Delete a Graph API webhook subscription.
 *
 * Sends DELETE to Graph API and removes (or marks expired) the local record.
 * Silently ignores 404 errors (subscription already gone on Graph side).
 */
export async function deleteSubscription(subscriptionId: string) {
  const sub = await WebhookSubscription.findOne({ subscriptionId });

  try {
    if (sub) {
      const accessToken = await getAccessTokenForMailbox(sub.mailboxId.toString());
      await graphFetch(`/subscriptions/${subscriptionId}`, accessToken, {
        method: 'DELETE',
      });
    }
  } catch (err) {
    // 404 = subscription already removed by Graph, safe to ignore
    if (err instanceof GraphApiError && err.status === 404) {
      logger.info('Subscription already removed from Graph', { subscriptionId });
    } else {
      throw err;
    }
  }

  if (sub) {
    sub.status = 'expired';
    await sub.save();
    logger.info('Webhook subscription deleted', { subscriptionId });
  }
}

/**
 * Sync all mailbox webhook subscriptions on server startup.
 *
 * For each connected mailbox:
 * - If no subscription exists or existing one is expired, create a new one.
 * - If a subscription exists and is not expired, try to renew it.
 *   On failure (e.g., 404 from Graph), delete the local record and create a new one.
 *
 * This runs on server startup and is also called by the periodic webhook-renewal scheduler.
 */
export async function syncSubscriptionsOnStartup() {
  const mailboxes = await Mailbox.find({ isConnected: true });

  let created = 0;
  let renewed = 0;
  let failed = 0;

  for (const mailbox of mailboxes) {
    const mailboxId = mailbox._id.toString();
    try {
      const existingSub = await WebhookSubscription.findOne({
        mailboxId: mailbox._id,
        status: 'active',
      });

      if (!existingSub || existingSub.expiresAt < new Date()) {
        // No subscription or expired -- delete stale record and create new
        if (existingSub) {
          existingSub.status = 'expired';
          await existingSub.save();
        }
        await createSubscription(mailboxId);
        created++;
      } else {
        // Subscription exists and is not expired -- try to renew
        try {
          await renewSubscription(existingSub.subscriptionId);
          renewed++;
        } catch (renewErr) {
          // Renewal failed (e.g., subscription removed by Graph) -- recreate
          if (renewErr instanceof GraphApiError && renewErr.status === 404) {
            logger.warn('Subscription removed by Graph, recreating', {
              subscriptionId: existingSub.subscriptionId,
              mailboxId,
            });
            existingSub.status = 'expired';
            await existingSub.save();
            await createSubscription(mailboxId);
            created++;
          } else {
            throw renewErr;
          }
        }
      }
    } catch (err) {
      failed++;
      logger.error('Failed to sync subscription for mailbox', {
        mailboxId,
        email: mailbox.email,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const result = { total: mailboxes.length, created, renewed, failed };
  logger.info('Subscription sync completed', result);
  return result;
}

/**
 * Handle a lifecycle notification from Microsoft Graph.
 *
 * Lifecycle events:
 * - subscriptionRemoved: Subscription was removed by Graph. Delete local record, recreate,
 *   and trigger an immediate delta sync to catch any missed events.
 * - missed: Some notifications were missed. Trigger an immediate delta sync.
 * - reauthorizationRequired: Try to renew the subscription. If that fails, delete and recreate.
 */
export async function handleLifecycleEvent(event: {
  lifecycleEvent: string;
  subscriptionId: string;
}) {
  const { lifecycleEvent, subscriptionId } = event;

  logger.info('Handling lifecycle event', { lifecycleEvent, subscriptionId });

  const sub = await WebhookSubscription.findOne({ subscriptionId });
  if (!sub) {
    logger.warn('Lifecycle event for unknown subscription', { subscriptionId, lifecycleEvent });
    return;
  }

  const mailboxId = sub.mailboxId.toString();

  switch (lifecycleEvent) {
    case 'subscriptionRemoved': {
      // Delete local record and recreate
      sub.status = 'expired';
      await sub.save();
      try {
        await createSubscription(mailboxId);
      } catch (err) {
        logger.error('Failed to recreate subscription after removal', {
          subscriptionId,
          mailboxId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      // Trigger immediate delta sync to catch missed events
      await queues['delta-sync'].add('lifecycle-delta-sync', { mailboxId });
      logger.info('Delta sync triggered after subscriptionRemoved', { mailboxId });
      break;
    }

    case 'missed': {
      // Trigger immediate delta sync to catch missed notifications
      await queues['delta-sync'].add('lifecycle-delta-sync', { mailboxId });
      logger.info('Delta sync triggered after missed notification', { mailboxId });
      break;
    }

    case 'reauthorizationRequired': {
      try {
        await renewSubscription(subscriptionId);
        logger.info('Subscription renewed after reauthorization request', { subscriptionId });
      } catch (err) {
        // Renewal failed -- delete and recreate
        logger.warn('Renewal failed after reauthorization, recreating', {
          subscriptionId,
          error: err instanceof Error ? err.message : String(err),
        });
        sub.status = 'expired';
        await sub.save();
        try {
          await createSubscription(mailboxId);
        } catch (createErr) {
          logger.error('Failed to recreate subscription after reauthorization', {
            subscriptionId,
            mailboxId,
            error: createErr instanceof Error ? createErr.message : String(createErr),
          });
        }
      }
      break;
    }

    default:
      logger.warn('Unknown lifecycle event type', { lifecycleEvent, subscriptionId });
  }
}
