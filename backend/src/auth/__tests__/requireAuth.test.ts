import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from '../../middleware/errorHandler.js';

const TEST_JWT_SECRET = 'require-auth-test-secret';

vi.mock('../../config/index.js', () => ({
  config: { jwtSecret: 'require-auth-test-secret' },
}));

const findById = vi.fn();
vi.mock('../../models/User.js', () => ({
  User: { findById: (...args: unknown[]) => findById(...args) },
}));

const { requireAuth, requireAdmin } = await import('../middleware.js');

function signSessionCookie(payload: { userId: string; email: string; role: 'admin' | 'user' }): string {
  return jwt.sign(payload, TEST_JWT_SECRET, { algorithm: 'HS256', expiresIn: '24h' });
}

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

  // AUTH-01: a still-valid session JWT for a user record that no longer
  // exists must not be accepted just because `activeUser?.isActive === false`
  // is vacuously false when activeUser is null.
  it('rejects a session JWT whose user no longer exists in the DB', async () => {
    findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(null) }) });
    const token = signSessionCookie({ userId: 'deleted-user', email: 'gone@example.com', role: 'admin' });
    const next = vi.fn() as NextFunction;
    const req = { cookies: { msedb_session: token }, headers: {} } as unknown as Request;

    await requireAuth(req, {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(UnauthorizedError);
  });

  // AUTH-02: role must come from a fresh DB read, not the JWT payload — a
  // token minted while the user was admin must lose admin access the moment
  // the DB record is demoted, not 24h later when the token expires.
  it('re-derives role from the DB, not the JWT payload, so a demoted admin loses requireAdmin access', async () => {
    findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ isActive: true, role: 'user' }) }) });
    const token = signSessionCookie({ userId: 'demoted-admin', email: 'demoted@example.com', role: 'admin' });
    const next = vi.fn() as NextFunction;
    const req = { cookies: { msedb_session: token }, headers: {} } as unknown as Request;

    await requireAuth(req, {} as Response, next);

    expect(req.user?.role).toBe('user');
    expect(() => requireAdmin(req, {} as Response, vi.fn())).toThrow(ForbiddenError);
  });
});
