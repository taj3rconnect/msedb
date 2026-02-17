import { Router, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { Mailbox } from '../models/Mailbox.js';
import { requireAuth } from '../auth/middleware.js';
import { createLoginMsalClient, GRAPH_SCOPES } from '../auth/msalClient.js';
import { config } from '../config/index.js';
import logger from '../config/logger.js';
import { NotFoundError } from '../middleware/errorHandler.js';

const mailboxRouter = Router();

// All mailbox routes require authentication
mailboxRouter.use(requireAuth);

/**
 * POST /api/mailboxes/connect
 *
 * Initiates an OAuth flow to connect an additional Microsoft 365 mailbox.
 * Returns an auth URL that the frontend should redirect the user to.
 */
mailboxRouter.post('/connect', async (req: Request, res: Response) => {
  const { loginHint } = req.body as { loginHint?: string };

  // Create a signed JWT state parameter with userId and connect_mailbox action
  const stateToken = jwt.sign(
    {
      action: 'connect_mailbox',
      userId: req.user!.userId,
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
    userId: req.user!.userId,
    loginHint: loginHint || 'none',
  });

  res.json({ authUrl });
});

/**
 * GET /api/mailboxes
 *
 * List all mailboxes connected by the current user.
 */
mailboxRouter.get('/', async (req: Request, res: Response) => {
  const mailboxes = await Mailbox.find({ userId: req.user!.userId })
    .select(
      'email displayName isConnected homeAccountId tenantId lastSyncAt settings createdAt',
    )
    .sort({ createdAt: 1 });

  res.json(mailboxes);
});

/**
 * DELETE /api/mailboxes/:id/disconnect
 *
 * Disconnect a mailbox and clear its tokens and MSAL cache.
 * User can only disconnect their own mailboxes.
 */
mailboxRouter.delete(
  '/:id/disconnect',
  async (req: Request, res: Response) => {
    const mailbox = await Mailbox.findOne({
      _id: req.params.id,
      userId: req.user!.userId,
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
      userId: req.user!.userId,
    });

    res.json({ message: 'Mailbox disconnected', mailboxId: req.params.id });
  },
);

export default mailboxRouter;
