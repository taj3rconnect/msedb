import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { validateCsrf } from '../csrf.js';
import { ForbiddenError } from '../errorHandler.js';

function makeReq(overrides: Partial<Request>): Request {
  return { method: 'POST', path: '/api/rules', cookies: {}, headers: {}, ...overrides } as Request;
}

describe('validateCsrf', () => {
  it('requires a matching CSRF header/cookie pair on a plain state-changing request', () => {
    const next = vi.fn() as NextFunction;
    validateCsrf(makeReq({}), {} as Response, next);
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ForbiddenError);
  });

  it('passes when the CSRF cookie and header match', () => {
    const next = vi.fn() as NextFunction;
    const req = makeReq({
      cookies: { msedb_csrf: 'token-1' },
      headers: { 'x-csrf-token': 'token-1' },
    });
    validateCsrf(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('skips CSRF for a Bearer request with no session cookie (add-in flow)', () => {
    const next = vi.fn() as NextFunction;
    const req = makeReq({ headers: { authorization: 'Bearer real-azure-token' } });
    validateCsrf(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  // L3-CSRF-01: requireAuth tries the session cookie FIRST, so a request
  // carrying both a valid cookie and an attacker-controlled (or plain
  // garbage) Authorization header still authenticates via the cookie --
  // CSRF must not be skipped just because a Bearer-shaped header is present.
  it('still enforces CSRF when a session cookie is present, even with a Bearer header', () => {
    const next = vi.fn() as NextFunction;
    const req = makeReq({
      cookies: { msedb_session: 'real-session-jwt' },
      headers: { authorization: 'Bearer notarealtoken' },
    });
    validateCsrf(req, {} as Response, next);
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ForbiddenError);
  });

  it('still passes safe methods through unconditionally', () => {
    const next = vi.fn() as NextFunction;
    validateCsrf(makeReq({ method: 'GET' }), {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });
});
