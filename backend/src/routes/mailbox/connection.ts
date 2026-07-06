import { Router, type Request, type Response } from 'express';
import { getUserId } from '../../auth/middleware.js';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { Mailbox } from '../../models/Mailbox.js';
import { EmailEvent } from '../../models/EmailEvent.js';
import { createLoginMsalClient, GRAPH_SCOPES } from '../../auth/msalClient.js';
import { getRedisClient } from '../../config/redis.js';
import { config } from '../../config/index.js';
import logger from '../../config/logger.js';
import { NotFoundError } from '../../middleware/errorHandler.js';

const connectionRouter = Router();

// ---- Mailbox connection routes ----

/**
 * POST /api/mailboxes/connect
 *
 * Initiates an OAuth flow to connect an additional Microsoft 365 mailbox.
 * Returns an auth URL that the frontend should redirect the user to.
 */
connectionRouter.post('/connect', async (req: Request, res: Response) => {
  const { loginHint } = req.body as { loginHint?: string };

  // Create a signed JWT state parameter with userId and connect_mailbox action
  const stateToken = jwt.sign(
    {
      action: 'connect_mailbox',
      userId: getUserId(req),
      ts: Date.now(),
    },
    config.jwtSecret,
    { expiresIn: '10m' },
  );

  const msalClient = createLoginMsalClient();

  const authCodeUrlParams: {
    scopes: string[];
    redirectUri: string;
    state: string;
    prompt: string;
    loginHint?: string;
  } = {
    scopes: GRAPH_SCOPES,
    redirectUri: `${config.apiUrl}/auth/callback`,
    state: stateToken,
    prompt: 'select_account',
  };

  if (loginHint) {
    authCodeUrlParams.loginHint = loginHint;
  }

  const authUrl = await msalClient.getAuthCodeUrl(authCodeUrlParams);

  logger.info('Mailbox connect flow initiated', {
    userId: getUserId(req),
    loginHint: loginHint || 'none',
  });

  res.json({ authUrl });
});

/**
 * GET /api/mailboxes
 *
 * List all mailboxes connected by the current user.
 */
connectionRouter.get('/', async (req: Request, res: Response) => {
  const mailboxes = await Mailbox.find({ userId: getUserId(req) })
    .select(
      'email displayName isConnected homeAccountId tenantId lastSyncAt settings createdAt',
    )
    .sort({ createdAt: 1 });

  res.json(mailboxes);
});

/**
 * GET /api/mailboxes/autocomplete?q=xxx
 *
 * Email autocomplete suggestions from contacts cache + recent senders.
 * Searches across ALL connected mailboxes for the user.
 */
connectionRouter.get('/autocomplete', async (req: Request, res: Response) => {
  const q = (req.query.q as string || '').trim().toLowerCase();
  if (q.length < 2) {
    res.json({ suggestions: [] });
    return;
  }

  const userId = getUserId(req);
  const mailboxes = await Mailbox.find({ userId, isConnected: true }).select('_id email');

  const seen = new Map<string, { email: string; name?: string; score: number }>();

  // Source 1: Contacts from Redis cache
  const redis = getRedisClient();
  for (const mb of mailboxes) {
    const cached = await redis.get(`contacts:${mb._id.toString()}:all`);
    if (!cached) continue;
    const contacts = JSON.parse(cached) as Array<{
      displayName?: string;
      emailAddresses?: Array<{ address?: string; name?: string }>;
    }>;
    for (const c of contacts) {
      if (!c.emailAddresses) continue;
      for (const ea of c.emailAddresses) {
        if (!ea.address) continue;
        const email = ea.address.toLowerCase();
        const name = c.displayName || ea.name || '';
        if (email.includes(q) || name.toLowerCase().includes(q)) {
          const existing = seen.get(email);
          if (!existing || existing.score < 100) {
            seen.set(email, { email: ea.address, name: name || undefined, score: 100 });
          }
        }
      }
    }
  }

  // Source 2: Recent senders from EmailEvent (aggregate by frequency)
  const mailboxIds = mailboxes.map((m) => m._id);
  const recentSenders = await EmailEvent.aggregate([
    {
      $match: {
        userId: new Types.ObjectId(userId),
        mailboxId: { $in: mailboxIds },
        'sender.email': { $exists: true, $ne: null },
        $or: [
          { 'sender.email': { $regex: q, $options: 'i' } },
          { 'sender.name': { $regex: q, $options: 'i' } },
        ],
      },
    },
    {
      $group: {
        _id: { $toLower: '$sender.email' },
        name: { $first: '$sender.name' },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 20 },
  ]);

  for (const s of recentSenders) {
    const email = s._id as string;
    const existing = seen.get(email);
    const score = Math.min(s.count, 99); // contacts always rank higher
    if (!existing || existing.score < score) {
      seen.set(email, { email: s.name ? email : email, name: s.name || undefined, score });
    }
    // If contact already there, keep it (higher score)
  }

  // Sort by score descending, then alphabetically
  const suggestions = [...seen.values()]
    .sort((a, b) => b.score - a.score || (a.email).localeCompare(b.email))
    .slice(0, 10)
    .map(({ email, name }) => ({ email, ...(name && { name }) }));

  res.json({ suggestions });
});

/**
 * DELETE /api/mailboxes/:id/disconnect
 *
 * Disconnect a mailbox and clear its tokens and MSAL cache.
 * User can only disconnect their own mailboxes.
 */
connectionRouter.delete(
  '/:id/disconnect',
  async (req: Request, res: Response) => {
    const mailbox = await Mailbox.findOne({
      _id: req.params.id,
      userId: getUserId(req),
    });

    if (!mailbox) {
      throw new NotFoundError('Mailbox not found');
    }

    await Mailbox.findByIdAndUpdate(mailbox._id, {
      isConnected: false,
      msalCache: null,
      encryptedTokens: {},
    });

    logger.info('Mailbox disconnected', {
      mailboxId: req.params.id,
      email: mailbox.email,
      userId: getUserId(req),
    });

    res.json({ message: 'Mailbox disconnected', mailboxId: req.params.id });
  },
);

export default connectionRouter;
