import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from './errorHandler.js';
import logger from '../config/logger.js';

/**
 * CSRF protection using the double-submit cookie pattern.
 *
 * How it works:
 * 1. GET /auth/csrf-token sets a random token in both:
 *    - An httpOnly cookie (msedb_csrf)
 *    - The JSON response body (so the SPA can read it)
 * 2. On every state-changing request (POST/PUT/PATCH/DELETE), middleware
 *    compares the X-CSRF-Token header value against the cookie value.
 *    If they don't match → 403.
 *
 * This works because an attacker on a different origin cannot read the
 * cookie value (httpOnly + SameSite=lax) to set the matching header.
 */

const CSRF_COOKIE = 'msedb_csrf';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Generate a new CSRF token (32 random bytes, hex-encoded).
 */
function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Endpoint handler: GET /auth/csrf-token
 * Issues a new CSRF token via cookie + JSON response.
 */
export function issueCsrfToken(req: Request, res: Response): void {
  const token = generateCsrfToken();

  res.cookie(CSRF_COOKIE, token, {
    httpOnly: true,
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    sameSite: 'lax',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours — aligned with session cookie
  });

  res.json({ csrfToken: token });
}

/**
 * Middleware: validate CSRF token on state-changing requests.
 *
 * Skips validation for:
 * - Safe methods (GET, HEAD, OPTIONS)
 * - Paths that don't need it (/auth/callback — OAuth redirect, /webhooks — Microsoft Graph)
 * - Requests with Bearer token auth (add-in SSO — no cookies, so no CSRF risk)
 */
export function validateCsrf(req: Request, _res: Response, next: NextFunction): void {
  // Safe methods don't mutate — skip
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  // Bearer token requests (add-in) are not cookie-based — no CSRF risk
  if (req.headers.authorization?.startsWith('Bearer ')) {
    next();
    return;
  }

  // Webhook endpoints are called by Microsoft, not browsers
  if (req.path.startsWith('/webhooks')) {
    next();
    return;
  }

  // Tracking pixel POST callbacks
  if (req.path.startsWith('/track')) {
    next();
    return;
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER] as string | undefined;

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    logger.warn('CSRF validation failed', {
      path: req.path,
      method: req.method,
      hasCookie: !!cookieToken,
      hasHeader: !!headerToken,
    });
    next(new ForbiddenError('CSRF token mismatch'));
    return;
  }

  next();
}
