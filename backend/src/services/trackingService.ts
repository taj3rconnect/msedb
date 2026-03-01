import { randomUUID } from 'crypto';
import { UAParser } from 'ua-parser-js';
import geoip from 'geoip-lite';
import { TrackedEmail } from '../models/TrackedEmail.js';
import { config } from '../config/index.js';
import logger from '../config/logger.js';

/** 1x1 transparent PNG (43 bytes) */
export const TRACKING_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB' +
  'Nl7BcQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Build the public pixel URL using the tunnel hostname.
 * graphWebhookUrl is the base URL (e.g. https://msedb.aptask.com).
 */
export function buildPixelUrl(trackingId: string): string {
  const base = config.graphWebhookUrl.replace(/\/+$/, '');
  return `${base}/track/open/${trackingId}.png`;
}

/**
 * Create a tracked email record and return the pixel HTML to inject.
 */
export async function createTrackedEmail(params: {
  userId: string;
  mailboxId: string;
  subject?: string;
  recipients: string[];
}): Promise<{ trackingId: string; pixelHtml: string }> {
  const trackingId = randomUUID();
  const pixelUrl = buildPixelUrl(trackingId);

  await TrackedEmail.create({
    trackingId,
    userId: params.userId,
    mailboxId: params.mailboxId,
    subject: params.subject,
    recipients: params.recipients,
    sentAt: new Date(),
  });

  const pixelHtml = `<img src="${pixelUrl}" width="1" height="1" style="display:none;width:1px;height:1px;border:0;" alt="" />`;
  return { trackingId, pixelHtml };
}

/** Dedup window: skip duplicate opens from same IP+UA within this many ms. */
const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Record an open event for a tracked email. Fire-and-forget.
 * Deduplicates by IP + User-Agent within a 5-minute window.
 */
export async function recordOpen(
  trackingId: string,
  ip?: string,
  userAgent?: string,
): Promise<void> {
  try {
    // Dedup: check if same IP+UA opened this email within the window
    if (ip && userAgent) {
      const cutoff = new Date(Date.now() - DEDUP_WINDOW_MS);
      const duplicate = await TrackedEmail.findOne({
        trackingId,
        opens: {
          $elemMatch: {
            ip,
            userAgent,
            timestamp: { $gte: cutoff },
          },
        },
      });
      if (duplicate) {
        logger.debug('Skipping duplicate open', { trackingId, ip });
        return;
      }
    }

    const parser = new UAParser(userAgent || '');
    const result = parser.getResult();

    const openEntry: Record<string, unknown> = {
      timestamp: new Date(),
      ip,
      userAgent,
      device: result.device.type || 'desktop',
      browser: result.browser.name ? `${result.browser.name} ${result.browser.version || ''}`.trim() : undefined,
      os: result.os.name ? `${result.os.name} ${result.os.version || ''}`.trim() : undefined,
    };

    // Geoip lookup (IPv4 only for geoip-lite)
    if (ip) {
      const geo = geoip.lookup(ip);
      if (geo) {
        openEntry.country = geo.country;
        openEntry.city = geo.city;
      }
    }

    await TrackedEmail.updateOne(
      { trackingId },
      {
        $push: { opens: openEntry },
        $inc: { openCount: 1 },
        $set: { lastOpenedAt: new Date() },
        $min: { firstOpenedAt: new Date() },
      },
    );
  } catch (err) {
    logger.error('Failed to record open', {
      trackingId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
