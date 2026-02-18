import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import jwksClient from 'jwks-rsa';
import { config } from '../config/index.js';
import { User } from '../models/User.js';
import { UnauthorizedError } from '../middleware/errorHandler.js';
import { requireAuth } from './middleware.js';

/**
 * JWKS client for validating Azure AD SSO tokens.
 * Uses key rotation and caching for production reliability.
 */
const client = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${config.azureAdTenantId}/discovery/v2.0/keys`,
  cache: true,
  rateLimit: true,
});

/**
 * Retrieve the signing key from the JWKS endpoint for JWT verification.
 */
function getSigningKey(
  header: jwt.JwtHeader,
  callback: jwt.SigningKeyCallback
): void {
  client.getSigningKey(header.kid!, (err, key) => {
    if (err) {
      callback(err);
      return;
    }
    callback(null, key?.getPublicKey());
  });
}

/**
 * SSO token payload structure from Azure AD v2.0.
 */
interface SsoTokenPayload {
  preferred_username: string;
  oid: string;
  scp: string;
  aud: string;
  iss: string;
}

/**
 * Middleware that validates Azure AD SSO Bearer tokens from the Outlook add-in.
 *
 * Flow:
 * 1. Extract Bearer token from Authorization header
 * 2. Verify JWT signature via JWKS (Azure AD key rotation)
 * 3. Validate audience, issuer, and algorithm
 * 4. Check scope includes 'access_as_user'
 * 5. Map preferred_username to existing MSEDB User
 * 6. Set req.user for downstream handlers
 */
export function requireSsoAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedError('No Bearer token');
  }

  const token = authHeader.substring(7);

  jwt.verify(
    token,
    getSigningKey,
    {
      audience: config.azureAdClientId,
      issuer: `https://login.microsoftonline.com/${config.azureAdTenantId}/v2.0`,
      algorithms: ['RS256'],
    },
    async (err, decoded) => {
      try {
        if (err) {
          next(new UnauthorizedError('Invalid SSO token'));
          return;
        }

        const payload = decoded as SsoTokenPayload;

        // Verify scope includes access_as_user
        if (!payload.scp?.includes('access_as_user')) {
          next(new UnauthorizedError('Invalid scope: access_as_user required'));
          return;
        }

        // Map SSO user to MSEDB user by email
        const user = await User.findOne({
          email: payload.preferred_username.toLowerCase(),
        });

        if (!user) {
          next(new UnauthorizedError('User not found in MSEDB'));
          return;
        }

        req.user = {
          userId: user._id.toString(),
          email: user.email,
          role: user.role,
        };

        next();
      } catch (error) {
        next(error);
      }
    }
  );
}

/**
 * Composite middleware that accepts either SSO Bearer token (add-in) or
 * cookie-based JWT session (dashboard).
 *
 * - If Authorization: Bearer header is present, delegates to requireSsoAuth
 * - Otherwise, delegates to requireAuth (cookie-based)
 *
 * This allows shared routes like /auth/me to serve both the web dashboard
 * and the Outlook add-in.
 */
export function requireSsoOrCookieAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.headers.authorization?.startsWith('Bearer ')) {
    requireSsoAuth(req, res, next);
  } else {
    requireAuth(req, res, next);
  }
}
