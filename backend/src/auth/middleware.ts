import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import type { Request, Response, NextFunction } from 'express';
import { UnauthorizedError, ForbiddenError } from '../middleware/errorHandler.js';
import { config } from '../config/index.js';
import { User } from '../models/User.js';
import logger from '../config/logger.js';

/**
 * JWT payload structure for MSEDB session tokens.
 */
export interface JwtPayload {
  userId: string;
  email: string;
  role: 'admin' | 'user';
}

// Extend Express Request to include user from JWT
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * JWKS client for validating Azure AD Bearer tokens from the Outlook add-in.
 * Caches signing keys for 10 minutes to avoid repeated JWKS fetches.
 */
const azureJwks = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${config.azureAdTenantId}/discovery/v2.0/keys`,
  cache: true,
  cacheMaxAge: 600000, // 10 min
});

function getAzureSigningKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback): void {
  azureJwks.getSigningKey(header.kid, (err, key) => {
    if (err) {
      callback(err);
      return;
    }
    callback(null, key?.getPublicKey());
  });
}

/**
 * Validate an Azure AD access token and map it to a local user.
 * Returns the JwtPayload for the matched user, or null if invalid.
 */
async function validateAzureToken(token: string): Promise<JwtPayload | null> {
  return new Promise((resolve) => {
    jwt.verify(
      token,
      getAzureSigningKey,
      {
        audience: `api://172.16.219.222:3010/${config.azureAdClientId}`,
        issuer: `https://login.microsoftonline.com/${config.azureAdTenantId}/v2.0`,
        algorithms: ['RS256'],
      },
      async (err, decoded) => {
        if (err) {
          logger.debug('Azure AD token validation failed', {
            error: err.message,
          });
          resolve(null);
          return;
        }

        const payload = decoded as Record<string, unknown>;
        const email = (
          (payload.preferred_username as string) ||
          (payload.email as string) ||
          (payload.upn as string) ||
          ''
        ).toLowerCase();

        if (!email) {
          resolve(null);
          return;
        }

        // Find user by email
        const user = await User.findOne({ email }).select('_id email role');
        if (!user) {
          logger.warn('Azure AD token valid but no matching user', { email });
          resolve(null);
          return;
        }

        resolve({
          userId: user._id.toString(),
          email: user.email,
          role: user.role || 'user',
        });
      },
    );
  });
}

/**
 * Middleware that verifies authentication via:
 * 1. Session cookie (msedb_session) — standard web app flow
 * 2. Bearer token (Authorization header) — Outlook add-in flow (Azure AD NAA)
 *
 * Sets req.user with the decoded payload on success.
 * Throws UnauthorizedError if no valid token found.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  // Try session cookie first
  const cookieToken = req.cookies?.msedb_session;
  if (cookieToken) {
    try {
      const decoded = jwt.verify(cookieToken, config.jwtSecret) as JwtPayload;
      req.user = decoded;
      next();
      return;
    } catch {
      // Cookie invalid — fall through to check Bearer token
    }
  }

  // Try Bearer token (Azure AD)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const bearerToken = authHeader.slice(7);
    validateAzureToken(bearerToken)
      .then((payload) => {
        if (payload) {
          req.user = payload;
          next();
        } else {
          next(new UnauthorizedError('Invalid Bearer token'));
        }
      })
      .catch((err) => {
        logger.error('Bearer token validation error', {
          error: err instanceof Error ? err.message : String(err),
        });
        next(new UnauthorizedError('Token validation failed'));
      });
    return;
  }

  throw new UnauthorizedError('No session token');
}

/**
 * Middleware that requires admin role. Must be used AFTER requireAuth.
 * Throws ForbiddenError if user is not an admin.
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    throw new ForbiddenError('Admin access required');
  }
  next();
}
