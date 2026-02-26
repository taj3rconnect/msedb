import { Router, type Request, type Response } from 'express';
import { TrackedEmail } from '../models/TrackedEmail.js';
import { requireAuth } from '../auth/middleware.js';

const trackingApiRouter = Router();

trackingApiRouter.use(requireAuth);

/**
 * GET /api/tracking/sent
 *
 * List tracked emails for the authenticated user, sorted by sentAt descending.
 * Query: ?page=1&limit=50&mailboxId=xxx
 */
trackingApiRouter.get('/sent', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = { userId };
  if (req.query.mailboxId) {
    filter.mailboxId = req.query.mailboxId;
  }

  const [items, total] = await Promise.all([
    TrackedEmail.find(filter)
      .sort({ sentAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('trackingId mailboxId subject recipients sentAt openCount firstOpenedAt lastOpenedAt')
      .lean(),
    TrackedEmail.countDocuments(filter),
  ]);

  res.json({
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

/**
 * GET /api/tracking/:trackingId
 *
 * Detailed open data for a single tracked email.
 */
trackingApiRouter.get('/:trackingId', async (req: Request, res: Response) => {
  const doc = await TrackedEmail.findOne({
    trackingId: req.params.trackingId,
    userId: req.user!.userId,
  }).lean();

  if (!doc) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  res.json(doc);
});

/**
 * POST /api/tracking/batch
 *
 * Batch lookup tracking data for sent items. Matches by mailboxId + subject + sentAt (±2 min).
 * Body: { items: [{ mailboxId, subject, sentAt }] }
 */
trackingApiRouter.post('/batch', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { items } = req.body as {
    items?: Array<{ mailboxId: string; subject?: string; sentAt: string }>;
  };

  if (!items || !Array.isArray(items) || items.length === 0) {
    res.json({ results: {} });
    return;
  }

  // Build $or conditions for batch lookup
  const TWO_MIN = 2 * 60 * 1000;
  const orConditions = items.map((item) => {
    const sentDate = new Date(item.sentAt);
    return {
      userId,
      mailboxId: item.mailboxId,
      subject: item.subject || '',
      sentAt: {
        $gte: new Date(sentDate.getTime() - TWO_MIN),
        $lte: new Date(sentDate.getTime() + TWO_MIN),
      },
    };
  });

  const docs = await TrackedEmail.find({ $or: orConditions })
    .select('trackingId mailboxId subject sentAt openCount firstOpenedAt lastOpenedAt')
    .lean();

  // Build result map keyed by "mailboxId:subject:sentAt" for frontend matching
  const results: Record<string, {
    trackingId: string;
    openCount: number;
    firstOpenedAt?: string;
    lastOpenedAt?: string;
  }> = {};

  for (const doc of docs) {
    // Match back to the closest input item
    for (const item of items) {
      const sentDate = new Date(item.sentAt);
      const docSentAt = new Date(doc.sentAt);
      if (
        doc.mailboxId.toString() === item.mailboxId &&
        doc.subject === (item.subject || '') &&
        Math.abs(docSentAt.getTime() - sentDate.getTime()) <= TWO_MIN
      ) {
        const key = `${item.mailboxId}:${item.subject || ''}:${item.sentAt}`;
        results[key] = {
          trackingId: doc.trackingId,
          openCount: doc.openCount,
          firstOpenedAt: doc.firstOpenedAt?.toISOString(),
          lastOpenedAt: doc.lastOpenedAt?.toISOString(),
        };
        break;
      }
    }
  }

  res.json({ results });
});

export { trackingApiRouter };
