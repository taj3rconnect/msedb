import { Router, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import logger from '../config/logger.js';
import { User } from '../models/User.js';
import { Mailbox } from '../models/Mailbox.js';
import { createLoginMsalClient, GRAPH_SCOPES } from './msalClient.js';
import { requireAuth } from './middleware.js';

const authRouter = Router();

/**
 * GET /auth/login
 *
 * Redirects user to Azure AD login page.
 * Creates a signed JWT state parameter to prevent CSRF and encode the action.
 */
authRouter.get('/auth/login', async (req: Request, res: Response) => {
  try {
    // Create a signed state parameter with 10 min expiry
    const stateToken = jwt.sign(
      { action: 'login', ts: Date.now() },
      config.jwtSecret,
      { expiresIn: '10m' }
    );

    const loginMsalClient = createLoginMsalClient();
    const authCodeUrl = await loginMsalClient.getAuthCodeUrl({
      scopes: GRAPH_SCOPES,
      redirectUri: `${config.apiUrl}/auth/callback`,
      state: stateToken,
      prompt: 'select_account',
    });

    res.redirect(authCodeUrl);
  } catch (error) {
    logger.error('Failed to generate auth URL', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.redirect(`${config.appUrl}/login?error=auth_url_failed`);
  }
});

/**
 * GET /auth/callback
 *
 * Handles the OAuth callback from Azure AD.
 * Exchanges the auth code for tokens, creates/finds User and Mailbox,
 * persists the MSAL cache, issues a JWT session cookie, and redirects to the frontend.
 */
authRouter.get('/auth/callback', async (req: Request, res: Response) => {
  const { code, state, error, error_description } = req.query;

  // Handle OAuth errors
  if (error) {
    logger.error('OAuth callback error', { error, error_description });
    res.redirect(`${config.appUrl}/login?error=${String(error)}`);
    return;
  }

  // Validate state parameter
  let stateData: { action: string; ts: number; userId?: string };
  try {
    stateData = jwt.verify(String(state), config.jwtSecret) as {
      action: string;
      ts: number;
      userId?: string;
    };
  } catch {
    logger.warn('Invalid or expired OAuth state parameter');
    res.redirect(`${config.appUrl}/login?error=invalid_state`);
    return;
  }

  try {
    // Exchange auth code for tokens
    const loginMsalClient = createLoginMsalClient();
    const tokenResponse = await loginMsalClient.acquireTokenByCode({
      code: String(code),
      scopes: GRAPH_SCOPES,
      redirectUri: `${config.apiUrl}/auth/callback`,
    });

    const account = tokenResponse.account;
    if (!account) {
      logger.error('No account in token response');
      res.redirect(`${config.appUrl}/login?error=no_account`);
      return;
    }

    if (stateData.action === 'login') {
      // Find or create User
      let user = await User.findOne({ microsoftId: account.localAccountId });
      if (!user) {
        user = await User.create({
          email: account.username.toLowerCase(),
          microsoftId: account.localAccountId,
          displayName: account.name,
          role:
            account.username.toLowerCase() === config.adminEmail.toLowerCase()
              ? 'admin'
              : 'user',
        });
        logger.info('New user created', {
          email: user.email,
          role: user.role,
        });
      }

      // Update last login
      user.lastLoginAt = new Date();
      await user.save();

      // Find or create initial Mailbox for this user+email
      let mailbox = await Mailbox.findOne({
        userId: user._id,
        email: account.username.toLowerCase(),
      });
      if (!mailbox) {
        mailbox = await Mailbox.create({
          userId: user._id,
          email: account.username.toLowerCase(),
          displayName: account.name,
          homeAccountId: account.homeAccountId,
          tenantId: account.tenantId,
          isConnected: true,
        });
        logger.info('Initial mailbox created', {
          email: mailbox.email,
          userId: user._id,
        });
      } else {
        // Update homeAccountId and tenantId in case they changed
        mailbox.homeAccountId = account.homeAccountId;
        mailbox.tenantId = account.tenantId;
        mailbox.isConnected = true;
        await mailbox.save();
      }

      // Persist MSAL token cache to the mailbox
      const serializedCache = loginMsalClient.getTokenCache().serialize();
      await Mailbox.findByIdAndUpdate(mailbox._id, {
        msalCache: serializedCache,
        'encryptedTokens.expiresAt': tokenResponse.expiresOn,
      });

      // Issue JWT session token
      const sessionToken = jwt.sign(
        {
          userId: user._id.toString(),
          email: user.email,
          role: user.role,
        },
        config.jwtSecret,
        { expiresIn: '24h' }
      );

      // Set httpOnly session cookie
      res.cookie('msedb_session', sessionToken, {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        path: '/',
      });

      res.redirect(config.appUrl);
    } else if (stateData.action === 'connect_mailbox') {
      // Multi-mailbox connect flow
      if (!stateData.userId) {
        logger.error('connect_mailbox state missing userId');
        res.redirect(`${config.appUrl}/settings?error=invalid_state`);
        return;
      }

      // Verify the user exists and is active
      const connectUser = await User.findById(stateData.userId);
      if (!connectUser || !connectUser.isActive) {
        logger.error('connect_mailbox user not found or inactive', {
          userId: stateData.userId,
        });
        res.redirect(`${config.appUrl}/settings?error=user_not_found`);
        return;
      }

      const connectEmail = account.username.toLowerCase();

      // Check if this mailbox already exists for this user
      const existingMailbox = await Mailbox.findOne({
        userId: stateData.userId,
        email: connectEmail,
      });

      if (existingMailbox && existingMailbox.isConnected) {
        // Already connected
        res.redirect(
          `${config.appUrl}/settings?error=mailbox_already_connected`,
        );
        return;
      }

      let mailboxId: string;

      if (existingMailbox) {
        // Reconnect a previously disconnected mailbox
        existingMailbox.isConnected = true;
        existingMailbox.homeAccountId = account.homeAccountId;
        existingMailbox.tenantId = account.tenantId;
        await existingMailbox.save();
        mailboxId = existingMailbox._id.toString();

        logger.info('Mailbox reconnected', {
          email: connectEmail,
          userId: stateData.userId,
        });
      } else {
        // Create a new mailbox
        const newMailbox = await Mailbox.create({
          userId: stateData.userId,
          email: connectEmail,
          displayName: account.name,
          homeAccountId: account.homeAccountId,
          tenantId: account.tenantId,
          isConnected: true,
        });
        mailboxId = newMailbox._id.toString();

        logger.info('New mailbox connected', {
          email: connectEmail,
          userId: stateData.userId,
        });
      }

      // Persist MSAL token cache to the mailbox
      const connectCache = loginMsalClient.getTokenCache().serialize();
      await Mailbox.findByIdAndUpdate(mailboxId, {
        msalCache: connectCache,
        'encryptedTokens.expiresAt': tokenResponse.expiresOn,
      });

      res.redirect(
        `${config.appUrl}/settings?connected=${encodeURIComponent(connectEmail)}`,
      );
    } else {
      res.redirect(`${config.appUrl}/login?error=unknown_action`);
    }
  } catch (error) {
    logger.error('OAuth callback failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.redirect(`${config.appUrl}/login?error=callback_failed`);
  }
});

/**
 * POST /auth/logout
 *
 * Clears the session cookie. Requires authentication.
 */
authRouter.post('/auth/logout', requireAuth, (req: Request, res: Response) => {
  res.clearCookie('msedb_session', {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/',
  });

  logger.info('User logged out', { userId: req.user?.userId });
  res.json({ message: 'Logged out' });
});

/**
 * GET /auth/me
 *
 * Returns the current user's info and connected mailboxes. Requires authentication.
 */
authRouter.get('/auth/me', requireAuth, async (req: Request, res: Response) => {
  const user = await User.findById(req.user!.userId).select(
    'email displayName role preferences'
  );

  if (!user) {
    res.status(404).json({ error: { message: 'User not found' } });
    return;
  }

  const mailboxes = await Mailbox.find({ userId: req.user!.userId }).select(
    'email displayName isConnected'
  );

  res.json({
    user: {
      id: user._id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      preferences: user.preferences,
    },
    mailboxes: mailboxes.map((mb) => ({
      id: mb._id,
      email: mb.email,
      displayName: mb.displayName,
      isConnected: mb.isConnected,
    })),
  });
});

export default authRouter;
