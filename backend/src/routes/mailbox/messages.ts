import { Router, type Request, type Response } from 'express';
import { Mailbox } from '../../models/Mailbox.js';
import { EmailEvent } from '../../models/EmailEvent.js';
import { getAccessTokenForMailbox } from '../../auth/tokenManager.js';
import { getRedisClient } from '../../config/redis.js';
import { bodyCacheKey, BODY_CACHE_TTL } from '../../jobs/processors/bodyPrefetch.js';
import { graphFetch } from '../../services/graphClient.js';
import { NotFoundError, ValidationError } from '../../middleware/errorHandler.js';

const messagesRouter = Router();

// ---- Fetch individual message (body) ----

/**
 * GET /api/mailboxes/:id/messages/:messageId
 *
 * Fetches an individual message from Graph API including its body content.
 */
messagesRouter.get('/:id/messages/:messageId', async (req: Request, res: Response) => {
  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: req.user!.userId,
  });
  if (!mailbox) {
    throw new NotFoundError('Mailbox not found');
  }

  const mailboxId = mailbox._id.toString();
  const messageId = String(req.params.messageId);
  const redis = getRedisClient();
  const cacheKey = bodyCacheKey(mailboxId, messageId);

  // Serve from Redis cache when available — avoids a live Graph call entirely.
  const cached = await redis.get(cacheKey);
  if (cached) {
    res.json({ message: JSON.parse(cached) });
    return;
  }

  const accessToken = await getAccessTokenForMailbox(mailboxId);
  const response = await graphFetch(
    `/users/${mailbox.email}/messages/${messageId}?$select=id,subject,body,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,isRead,importance,hasAttachments,categories,flag`,
    accessToken,
  );

  const message = (await response.json()) as {
    id: string;
    subject?: string;
    body?: { contentType: string; content: string };
    bodyPreview?: string;
    from?: { emailAddress: { name?: string; address?: string } };
    toRecipients?: { emailAddress: { name?: string; address?: string } }[];
    ccRecipients?: { emailAddress: { name?: string; address?: string } }[];
    receivedDateTime?: string;
    isRead?: boolean;
    importance?: string;
    hasAttachments?: boolean;
    categories?: string[];
  };

  // If the HTML body has cid: image references, fetch inline attachments and
  // replace them with data: URIs so images render in the browser.
  if (message.body?.contentType === 'html' && message.body.content.includes('cid:')) {
    try {
      const attResponse = await graphFetch(
        `/users/${mailbox.email}/messages/${messageId}/attachments?$select=contentId,contentType,contentBytes,isInline`,
        accessToken,
      );
      const attData = (await attResponse.json()) as {
        value: { contentId?: string; contentType?: string; contentBytes?: string; isInline?: boolean }[];
      };
      if (attData.value?.length) {
        let html = message.body.content;
        for (const att of attData.value) {
          if (att.contentId && att.contentBytes && att.contentType && att.contentType.startsWith('image/')) {
            const cid = att.contentId.replace(/^<|>$/g, '');
            const dataUri = `data:${att.contentType};base64,${att.contentBytes}`;
            html = html.split(`cid:${cid}`).join(dataUri);
            html = html.split(`cid:<${cid}>`).join(dataUri);
          }
        }
        message.body.content = html;
      }
    } catch {
      // Non-fatal — return body as-is if attachment fetch fails
    }
  }

  // Write to cache for future previews (fire-and-forget, non-blocking)
  const serialized = JSON.stringify(message);
  if (serialized.length <= 250_000) {
    redis.set(cacheKey, serialized, 'EX', BODY_CACHE_TTL).catch(() => { /* non-fatal */ });
  }

  res.json({ message });
});

/**
 * PATCH /api/mailboxes/:id/messages/:messageId/categories
 * Updates categories assigned to a specific message.
 * Body: { categories: string[] }
 */
messagesRouter.patch('/:id/messages/:messageId/categories', async (req: Request, res: Response) => {
  const mailbox = await Mailbox.findOne({ _id: req.params.id, userId: req.user!.userId });
  if (!mailbox) throw new NotFoundError('Mailbox not found');

  const { categories } = req.body as { categories: string[] };
  if (!Array.isArray(categories)) throw new ValidationError('categories must be an array');

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
  await graphFetch(`/users/${mailbox.email}/messages/${req.params.messageId}`, accessToken, {
    method: 'PATCH',
    body: JSON.stringify({ categories }),
  });

  // Update local EmailEvent record too
  await EmailEvent.updateMany(
    { mailboxId: req.params.id, messageId: req.params.messageId },
    { $set: { categories } },
  );

  res.json({ categories });
});

export default messagesRouter;
