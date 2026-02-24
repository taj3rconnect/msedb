import { graphFetch, GraphApiError } from './graphClient.js';
import { getAccessTokenForMailbox } from '../auth/tokenManager.js';
import { generateEmbedding } from './ollamaClient.js';
import {
  upsertEmailVector,
  upsertEmailVectorsBatch,
  makePointId,
  type EmailVectorPoint,
} from './qdrantClient.js';
import { getRedisClient } from '../config/redis.js';
import { Mailbox } from '../models/Mailbox.js';
import { EmailEvent } from '../models/EmailEvent.js';
import logger from '../config/logger.js';

const EMBED_KEY_PREFIX = 'embed';
const EMBED_TTL_SECONDS = 90 * 24 * 3600; // 90 days

interface EmbedEmailParams {
  userId: string;
  mailboxId: string;
  mailboxEmail: string;
  messageId: string;
  senderEmail: string;
  senderName: string;
  subject: string;
  receivedAt: string;
  folder: string;
  importance: string;
  hasAttachments: boolean;
  categories: string[];
  isRead: boolean;
  accessToken?: string;
}

function embedKey(userId: string, mailboxId: string, messageId: string): string {
  return `${EMBED_KEY_PREFIX}:${userId}:${mailboxId}:${messageId}`;
}

/**
 * Check if an email has already been embedded (via Redis tracking key).
 */
export async function isEmailEmbedded(userId: string, mailboxId: string, messageId: string): Promise<boolean> {
  const exists = await getRedisClient().exists(embedKey(userId, mailboxId, messageId));
  return exists === 1;
}

/**
 * Strip HTML tags from a string to get plain text.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch the email body from Graph API.
 * Returns plain text body or null if not available.
 */
async function fetchEmailBody(
  mailboxEmail: string,
  messageId: string,
  accessToken: string,
): Promise<{ bodyText: string; bodyPreview: string } | null> {
  try {
    const path = `/users/${mailboxEmail}/messages/${messageId}?$select=id,body,bodyPreview`;
    const response = await graphFetch(path, accessToken);
    const data = (await response.json()) as {
      body?: { contentType: string; content: string };
      bodyPreview?: string;
    };

    let bodyText = '';
    if (data.body) {
      bodyText = data.body.contentType === 'html'
        ? stripHtml(data.body.content)
        : data.body.content;
    }

    return {
      bodyText: bodyText || '',
      bodyPreview: data.bodyPreview || '',
    };
  } catch (err) {
    if (err instanceof GraphApiError && err.status === 404) {
      logger.debug('Email body not found (message may have been deleted)', { messageId });
      return null;
    }
    throw err;
  }
}

/**
 * Embed a single email: fetch body → compose text → embed → store in Qdrant → track in Redis.
 */
export async function embedEmail(params: EmbedEmailParams): Promise<boolean> {
  const { userId, mailboxId, mailboxEmail, messageId, senderEmail, senderName, subject } = params;

  // Check if already embedded
  if (await isEmailEmbedded(userId, mailboxId, messageId)) {
    return false;
  }

  // Get access token if not provided
  const accessToken = params.accessToken || await getAccessTokenForMailbox(mailboxId);

  // Fetch email body
  const bodyResult = await fetchEmailBody(mailboxEmail, messageId, accessToken);
  if (!bodyResult) {
    logger.debug('Skipping embedding — email body not available', { messageId });
    return false;
  }

  const { bodyText, bodyPreview } = bodyResult;

  // Compose text for embedding (truncate to 8000 chars)
  const textParts = [
    `From: ${senderName} <${senderEmail}>`,
    `Subject: ${subject}`,
    '',
    bodyText || bodyPreview,
  ];
  const composedText = textParts.join('\n').substring(0, 8000);

  // Generate embedding
  const vector = await generateEmbedding(composedText);

  // Extract sender domain
  const senderDomain = senderEmail.includes('@')
    ? senderEmail.split('@')[1]!.toLowerCase()
    : '';

  // Build point
  const pointId = makePointId(userId, mailboxId, messageId);
  const point: EmailVectorPoint = {
    id: pointId,
    vector,
    payload: {
      userId,
      mailboxId,
      messageId,
      senderEmail: senderEmail.toLowerCase(),
      senderName,
      senderDomain,
      subject,
      bodySnippet: (bodyText || bodyPreview).substring(0, 500),
      receivedAt: params.receivedAt,
      folder: params.folder,
      importance: params.importance,
      hasAttachments: params.hasAttachments,
      categories: params.categories,
      isRead: params.isRead,
      embeddedAt: new Date().toISOString(),
    },
  };

  // Upsert to Qdrant
  await upsertEmailVector(point);

  // Track in Redis
  await getRedisClient().set(
    embedKey(userId, mailboxId, messageId),
    '1',
    'EX',
    EMBED_TTL_SECONDS,
  );

  return true;
}

/**
 * Embed a batch of emails. Returns counts of embedded, skipped, and failed.
 */
export async function embedEmailBatch(
  paramsList: EmbedEmailParams[],
): Promise<{ embedded: number; skipped: number; failed: number }> {
  let embedded = 0;
  let skipped = 0;
  let failed = 0;

  for (const params of paramsList) {
    try {
      const result = await embedEmail(params);
      if (result) {
        embedded++;
      } else {
        skipped++;
      }
    } catch (err) {
      failed++;
      logger.warn('Failed to embed email', {
        messageId: params.messageId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Small delay to avoid Graph API rate limiting during batch
    if (paramsList.length > 10) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return { embedded, skipped, failed };
}

/**
 * Backfill embeddings for all emails in a mailbox.
 * Fetches emails from MongoDB and embeds them in batches.
 */
export async function backfillMailboxEmbeddings(
  mailboxId: string,
  userId?: string,
): Promise<{ embedded: number; skipped: number; failed: number }> {
  const mailbox = await Mailbox.findById(mailboxId);
  if (!mailbox) {
    throw new Error(`Mailbox not found: ${mailboxId}`);
  }

  const effectiveUserId = userId || mailbox.userId.toString();
  const mailboxEmail = mailbox.email;

  let accessToken: string;
  try {
    accessToken = await getAccessTokenForMailbox(mailboxId);
  } catch (err) {
    throw new Error(`Failed to get access token for mailbox ${mailboxId}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Get all 'arrived' events for this mailbox
  const events = await EmailEvent.find({
    mailboxId,
    eventType: 'arrived',
  })
    .sort({ timestamp: -1 })
    .select('messageId sender subject receivedAt toFolder importance hasAttachments categories isRead userId')
    .lean();

  logger.info('Starting backfill for mailbox', {
    mailboxId,
    email: mailboxEmail,
    totalEvents: events.length,
  });

  const paramsList: EmbedEmailParams[] = events.map((event) => ({
    userId: effectiveUserId,
    mailboxId,
    mailboxEmail,
    messageId: event.messageId,
    senderEmail: event.sender?.email || '',
    senderName: event.sender?.name || '',
    subject: event.subject || '',
    receivedAt: event.receivedAt?.toISOString() || event.timestamp?.toISOString() || new Date().toISOString(),
    folder: event.toFolder || '',
    importance: event.importance || 'normal',
    hasAttachments: event.hasAttachments || false,
    categories: event.categories || [],
    isRead: event.isRead || false,
    accessToken,
  }));

  return embedEmailBatch(paramsList);
}
