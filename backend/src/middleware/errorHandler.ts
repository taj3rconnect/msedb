import type { Request, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import logger from '../config/logger.js';
import { GraphApiError } from '../services/graphClient.js';

/**
 * Custom error classes for structured error handling.
 */
export class AppError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.name = this.constructor.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string = 'Validation failed') {
    super(message, 400);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Not found') {
    super(message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Conflict') {
    super(message, 409);
  }
}

/**
 * Global Express 5 error handler.
 * Must be registered LAST -- Express identifies error handlers by their 4-argument signature.
 */
export function globalErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Determine status code
  let statusCode = 500;
  if (err instanceof AppError) {
    statusCode = err.statusCode;
  }

  // Sanitize error message — never leak Graph API response bodies (may contain credentials/keys)
  let safeMessage = err.message;
  if (err instanceof GraphApiError) {
    safeMessage = `Graph API error ${err.status} on ${err.path}`;
  }

  // Log the error with context (full details in logs only)
  logger.error('Request error', {
    error: err.message,
    stack: err.stack,
    method: req.method,
    path: req.path,
    statusCode,
    userId: (req as unknown as Record<string, unknown>).userId ?? undefined,
  });

  // Build response — never leak internal details to client
  const timestamp = new Date().toISOString();
  const clientMessage = statusCode === 500 ? 'Internal server error' : safeMessage;

  res.status(statusCode).json({
    error: {
      message: clientMessage,
      status: statusCode,
      timestamp,
    },
  });
}
