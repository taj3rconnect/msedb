import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { Mailbox } from '../../models/Mailbox.js';
import { EmailEvent } from '../../models/EmailEvent.js';
import { getAccessTokenForMailbox } from '../../auth/tokenManager.js';
import { graphFetch } from '../../services/graphClient.js';
import logger from '../../config/logger.js';
import { NotFoundError, ValidationError } from '../../middleware/errorHandler.js';

const actionsRouter = Router();

// ---- Apply actions to messages ----

/**
 * POST /api/mailboxes/:id/apply-actions
 *
 * Immediately apply actions (delete, move, markRead) to specific messages via Graph API.
 * Body: { messageIds: string[], actions: { actionType: string, toFolder?: string }[] }
 */
actionsRouter.post(
  '/:id/apply-actions',
  async (req: Request, res: Response) => {
    const { messageIds, actions } = req.body as {
      messageIds?: string[];
      actions?: { actionType: string; toFolder?: string }[];
    };

    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      throw new ValidationError('messageIds is required and must be a non-empty array');
    }
    if (!actions || !Array.isArray(actions) || actions.length === 0) {
      throw new ValidationError('actions is required and must be a non-empty array');
    }

    const mailbox = await Mailbox.findOne({
      _id: req.params.id,
      userId: req.user!.userId,
    });

    if (!mailbox) {
      throw new NotFoundError('Mailbox not found');
    }

    const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
    const email = mailbox.email;

    let applied = 0;
    let failed = 0;

    for (const msgId of messageIds) {
      try {
        for (const action of actions) {
          switch (action.actionType) {
            case 'delete':
              await graphFetch(
                `/users/${email}/messages/${msgId}/move`,
                accessToken,
                {
                  method: 'POST',
                  body: JSON.stringify({ destinationId: 'deleteditems' }),
                },
              );
              break;
            case 'move':
              if (action.toFolder) {
                await graphFetch(
                  `/users/${email}/messages/${msgId}/move`,
                  accessToken,
                  {
                    method: 'POST',
                    body: JSON.stringify({ destinationId: action.toFolder }),
                  },
                );
              }
              break;
            case 'markRead':
              await graphFetch(
                `/users/${email}/messages/${msgId}`,
                accessToken,
                {
                  method: 'PATCH',
                  body: JSON.stringify({ isRead: true }),
                },
              );
              break;
          }
        }
        applied++;
      } catch (err) {
        failed++;
        logger.warn('Failed to apply action to message', {
          mailboxId: req.params.id,
          messageId: msgId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Record 'deleted' EmailEvent records so excludeDeleted filter works
    const hasDeleteAction = actions.some((a) => a.actionType === 'delete');
    if (hasDeleteAction && applied > 0) {
      const successMsgIds = messageIds.slice(0, applied);
      const bulkOps = successMsgIds.map((msgId) => ({
        updateOne: {
          filter: {
            userId: new Types.ObjectId(req.user!.userId),
            mailboxId: mailbox._id,
            messageId: msgId,
            eventType: 'deleted' as const,
          },
          update: {
            $setOnInsert: {
              userId: new Types.ObjectId(req.user!.userId),
              mailboxId: mailbox._id,
              messageId: msgId,
              eventType: 'deleted' as const,
              timestamp: new Date(),
              sender: {},
              importance: 'normal' as const,
              hasAttachments: false,
              categories: [],
              isRead: false,
              metadata: {},
            },
          },
          upsert: true,
        },
      }));
      try {
        await EmailEvent.bulkWrite(bulkOps);
      } catch {
        // Non-critical, log and continue
      }
    }

    logger.info('Applied actions to messages', {
      mailboxId: req.params.id,
      applied,
      failed,
      total: messageIds.length,
    });

    res.json({ applied, failed, total: messageIds.length });
  },
);

/**
 * GET /api/mailboxes/deleted-count-all
 *
 * Returns the total number of messages in Deleted Items across all connected mailboxes.
 */
actionsRouter.get('/deleted-count-all', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const mailboxes = await Mailbox.find({ userId, isConnected: true }).select('email').lean();

  let total = 0;
  const results = await Promise.allSettled(
    mailboxes.map(async (mb) => {
      const accessToken = await getAccessTokenForMailbox(mb._id.toString());
      const response = await graphFetch(
        `/users/${mb.email}/mailFolders/deleteditems?$select=totalItemCount`,
        accessToken,
      );
      const data = (await response.json()) as { totalItemCount?: number };
      return data.totalItemCount ?? 0;
    }),
  );

  for (const r of results) {
    if (r.status === 'fulfilled') {
      total += r.value;
    }
  }

  res.json({ count: total });
});

/**
 * GET /api/mailboxes/:id/deleted-count
 *
 * Returns the number of messages in the Deleted Items folder.
 */
actionsRouter.get('/:id/deleted-count', async (req: Request, res: Response) => {
  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: req.user!.userId,
  });
  if (!mailbox) {
    throw new NotFoundError('Mailbox not found');
  }

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
  const response = await graphFetch(
    `/users/${mailbox.email}/mailFolders/deleteditems?$select=totalItemCount`,
    accessToken,
  );
  const data = (await response.json()) as { totalItemCount?: number };

  res.json({ count: data.totalItemCount ?? 0 });
});

/**
 * POST /api/mailboxes/:id/empty-deleted
 *
 * Permanently deletes all messages in the Deleted Items folder.
 */
actionsRouter.post('/:id/empty-deleted', async (req: Request, res: Response) => {
  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: req.user!.userId,
  });
  if (!mailbox) {
    throw new NotFoundError('Mailbox not found');
  }

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
  const email = mailbox.email;

  let deleted = 0;
  let failed = 0;
  const CONCURRENCY = 20;
  const FETCH_SIZE = 200;

  // Fetch and permanently delete in parallel batches
  let hasMore = true;
  while (hasMore) {
    const response = await graphFetch(
      `/users/${email}/mailFolders/deleteditems/messages?$select=id&$top=${FETCH_SIZE}`,
      accessToken,
    );
    const data = (await response.json()) as {
      value: { id: string }[];
    };

    if (data.value.length === 0) break;

    // Delete in parallel batches of CONCURRENCY
    for (let i = 0; i < data.value.length; i += CONCURRENCY) {
      const batch = data.value.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((msg) =>
          graphFetch(`/users/${email}/messages/${msg.id}`, accessToken, {
            method: 'DELETE',
          }),
        ),
      );
      for (const r of results) {
        if (r.status === 'fulfilled') deleted++;
        else failed++;
      }
    }

    // If all failed this round, stop
    if (failed > 0 && deleted === 0) break;

    hasMore = data.value.length === FETCH_SIZE;
  }

  logger.info('Emptied deleted items', {
    mailboxId: req.params.id,
    deleted,
    failed,
  });

  res.json({ deleted, failed });
});

export default actionsRouter;
