import type { Job } from 'bullmq';
import { graphFetch } from '../../services/graphClient.js';
import { getAccessTokenForMailbox } from '../../auth/tokenManager.js';
import { getRedisClient } from '../../config/redis.js';
import logger from '../../config/logger.js';

export const BODY_CACHE_TTL = 4 * 60 * 60; // 4 hours
export const BODY_CACHE_PREFIX = 'email-body';
// Skip caching bodies larger than this to avoid filling Redis with huge HTML.
const MAX_CACHE_BYTES = 250_000;

export function bodyCacheKey(mailboxId: string, messageId: string): string {
  return `${BODY_CACHE_PREFIX}:${mailboxId}:${messageId}`;
}

export async function processBodyPrefetch(job: Job): Promise<void> {
  const { mailboxId, mailboxEmail, messageId } = job.data as {
    mailboxId: string;
    mailboxEmail: string;
    messageId: string;
  };

  const redis = getRedisClient();
  const cacheKey = bodyCacheKey(mailboxId, messageId);

  // Skip if already cached
  if (await redis.exists(cacheKey)) return;

  const accessToken = await getAccessTokenForMailbox(mailboxId);

  const response = await graphFetch(
    `/users/${mailboxEmail}/messages/${messageId}?$select=id,subject,body,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,isRead,importance,hasAttachments,categories,flag`,
    accessToken,
  );

  const message = await response.json() as Record<string, unknown>;

  // Inline CID image substitution (same logic as the live route)
  const body = message.body as { contentType?: string; content?: string } | undefined;
  if (body?.contentType === 'html' && body.content?.includes('cid:')) {
    try {
      const attRes = await graphFetch(
        `/users/${mailboxEmail}/messages/${messageId}/attachments?$select=contentId,contentType,contentBytes,isInline`,
        accessToken,
      );
      const attData = (await attRes.json()) as {
        value: { contentId?: string; contentType?: string; contentBytes?: string; isInline?: boolean }[];
      };
      if (attData.value?.length) {
        let html = body.content;
        for (const att of attData.value) {
          if (att.contentId && att.contentBytes && att.contentType?.startsWith('image/')) {
            const cid = att.contentId.replace(/^<|>$/g, '');
            const dataUri = `data:${att.contentType};base64,${att.contentBytes}`;
            html = html.split(`cid:${cid}`).join(dataUri);
            html = html.split(`cid:<${cid}>`).join(dataUri);
          }
        }
        body.content = html;
      }
    } catch { /* non-fatal — cache body as-is */ }
  }

  const serialized = JSON.stringify(message);
  if (serialized.length > MAX_CACHE_BYTES) {
    logger.debug('Body prefetch: skipping cache, body too large', {
      mailboxId,
      messageId,
      bytes: serialized.length,
    });
    return;
  }

  await redis.set(cacheKey, serialized, 'EX', BODY_CACHE_TTL);
}
