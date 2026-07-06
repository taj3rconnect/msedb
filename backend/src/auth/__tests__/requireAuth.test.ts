import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware.js';
import { UnauthorizedError } from '../../middleware/errorHandler.js';

describe('requireAuth', () => {
  // Regression: requireAuth used to `throw` on missing token; ssoMiddleware
  // calls it un-awaited, so the rejected promise crashed the process.
  it('fails via next(UnauthorizedError) and never rejects when no token is present', async () => {
    const next = vi.fn() as NextFunction;
    const req = { cookies: {}, headers: {} } as unknown as Request;

    await expect(
      requireAuth(req, {} as Response, next),
    ).resolves.toBeUndefined();

    expect(next).toHaveBeenCalledTimes(1);
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(UnauthorizedError);
  });
});
