import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth, requireAdmin } from '../auth/middleware.js';
import { parseSearchQuery, generateEmbedding, checkOllamaHealth } from '../services/ollamaClient.js';
import { searchEmailVectors, getCollectionInfo } from '../services/qdrantClient.js';
import { backfillMailboxEmbeddings } from '../services/embeddingService.js';
import { queues } from '../jobs/queues.js';
import logger from '../config/logger.js';

const router = Router();

// All routes require auth
router.use(requireAuth);

/**
 * POST /api/ai-search — Main semantic search endpoint
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { query, mailboxId, limit = 20 } = req.body as {
      query: string;
      mailboxId?: string;
      limit?: number;
    };

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      res.status(400).json({ error: 'Query is required' });
      return;
    }

    const userId = req.user!.userId;
    const totalStart = Date.now();

    // Step 1: Parse the natural language query
    const parseStart = Date.now();
    const parsed = await parseSearchQuery(query.trim());
    const parseMs = Date.now() - parseStart;

    // Step 2: Generate embedding for the semantic query
    const embedStart = Date.now();
    const queryVector = await generateEmbedding(parsed.semanticQuery);
    const embedMs = Date.now() - embedStart;

    // Step 3: Build Qdrant filter from parsed query
    const mustConditions: Record<string, unknown>[] = [
      { key: 'userId', match: { value: userId } },
    ];

    if (mailboxId) {
      mustConditions.push({ key: 'mailboxId', match: { value: mailboxId } });
    }

    if (parsed.senderFilter) {
      // Use senderEmail or senderName as a keyword filter
      // For partial matches, we rely on vector similarity
      const senderLower = parsed.senderFilter.toLowerCase();
      if (senderLower.includes('@')) {
        mustConditions.push({ key: 'senderEmail', match: { value: senderLower } });
      } else {
        // For name-based sender filters, we add it to the semantic query
        // since Qdrant keyword filters are exact match only
      }
    }

    if (parsed.senderDomainFilter) {
      mustConditions.push({ key: 'senderDomain', match: { value: parsed.senderDomainFilter.toLowerCase() } });
    }

    if (parsed.importanceFilter) {
      mustConditions.push({ key: 'importance', match: { value: parsed.importanceFilter } });
    }

    if (parsed.hasAttachments !== undefined) {
      mustConditions.push({ key: 'hasAttachments', match: { value: parsed.hasAttachments } });
    }

    if (parsed.dateFrom || parsed.dateTo) {
      const rangeFilter: Record<string, string> = {};
      if (parsed.dateFrom) rangeFilter.gte = new Date(parsed.dateFrom).toISOString();
      if (parsed.dateTo) rangeFilter.lte = new Date(parsed.dateTo + 'T23:59:59.999Z').toISOString();
      mustConditions.push({ key: 'receivedAt', range: rangeFilter });
    }

    const filter = mustConditions.length > 0
      ? { must: mustConditions }
      : undefined;

    // Step 4: Search Qdrant
    const searchStart = Date.now();
    const results = await searchEmailVectors(queryVector, filter, Math.min(limit, 50));
    const searchMs = Date.now() - searchStart;

    const totalMs = Date.now() - totalStart;

    res.json({
      results: results.map((r) => ({
        id: r.id,
        score: Math.round(r.score * 1000) / 1000,
        messageId: r.payload.messageId,
        mailboxId: r.payload.mailboxId,
        senderEmail: r.payload.senderEmail,
        senderName: r.payload.senderName,
        subject: r.payload.subject,
        bodySnippet: r.payload.bodySnippet,
        receivedAt: r.payload.receivedAt,
        folder: r.payload.folder,
        importance: r.payload.importance,
        hasAttachments: r.payload.hasAttachments,
        categories: r.payload.categories,
        isRead: r.payload.isRead,
      })),
      parsedQuery: parsed,
      timing: { parseMs, embedMs, searchMs, totalMs },
    });
  } catch (err) {
    logger.error('AI search failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    next(err);
  }
});

/**
 * GET /api/ai-search/status — Health check + stats
 */
router.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [ollamaHealth, collectionInfo] = await Promise.all([
      checkOllamaHealth(),
      getCollectionInfo(),
    ]);

    res.json({
      qdrant: {
        healthy: collectionInfo !== null,
        pointCount: collectionInfo?.pointCount ?? 0,
      },
      ollama: ollamaHealth,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/ai-search/backfill — Trigger backfill job for a mailbox (admin only)
 */
router.post('/backfill', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mailboxId } = req.body as { mailboxId?: string };
    const userId = req.user!.userId;

    if (!mailboxId) {
      res.status(400).json({ error: 'mailboxId is required' });
      return;
    }

    const job = await queues['email-embedding'].add('backfill-embeddings', {
      mailboxId,
      userId,
    }, {
      attempts: 1,
      removeOnComplete: { age: 3600 },
    });

    res.json({ jobId: job.id, message: 'Backfill job queued' });
  } catch (err) {
    next(err);
  }
});

export { router as aiSearchRouter };
