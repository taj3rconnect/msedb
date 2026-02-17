import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { UnauthorizedError, ForbiddenError } from '../middleware/errorHandler.js';
import { config } from '../config/index.js';

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
 * Middleware that verifies the JWT session token from the httpOnly cookie.
 * Sets req.user with the decoded payload on success.
 * Throws UnauthorizedError if no token or invalid/expired token.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.msedb_session;
  if (!token) {
    throw new UnauthorizedError('No session token');
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload;
    req.user = decoded;
    next();
  } catch {
    throw new UnauthorizedError('Invalid or expired session');
  }
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
