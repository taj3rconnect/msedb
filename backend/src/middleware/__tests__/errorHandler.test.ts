import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { globalErrorHandler, ValidationError } from '../errorHandler.js';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res as unknown as Response;
}

function makeReq(): Request {
  return { method: 'POST', path: '/api/rules' } as Request;
}

describe('globalErrorHandler', () => {
  it('still maps a known AppError to its own status code', () => {
    const res = makeRes();
    globalErrorHandler(new ValidationError('bad input'), makeReq(), res, vi.fn() as NextFunction);
    expect(res.status).not.toBeUndefined();
    expect((res as unknown as { statusCode: number }).statusCode).toBe(400);
  });

  // L3-ERR-01: express.json()'s own SyntaxError on malformed JSON carries
  // status 400 -- it must not fall through to a generic 500.
  it('maps a body-parser JSON SyntaxError to 400, not 500', () => {
    const err = Object.assign(new SyntaxError('Unexpected token o in JSON at position 1'), {
      status: 400,
      type: 'entity.parse.failed',
    });
    const res = makeRes();
    globalErrorHandler(err, makeReq(), res, vi.fn() as NextFunction);

    const r = res as unknown as { statusCode: number; body: { error: { message: string } } };
    expect(r.statusCode).toBe(400);
    expect(r.body.error.message).not.toContain('Unexpected token');
  });

  // L3-ERR-01: an oversized body (PayloadTooLargeError from raw-body) must
  // map to 413, not 500.
  it('maps a body-parser PayloadTooLargeError to 413, not 500', () => {
    const err = Object.assign(new Error('request entity too large'), {
      status: 413,
      type: 'entity.too.large',
    });
    const res = makeRes();
    globalErrorHandler(err, makeReq(), res, vi.fn() as NextFunction);

    const r = res as unknown as { statusCode: number; body: { error: { message: string } } };
    expect(r.statusCode).toBe(413);
    expect(r.body.error.message).toBe('Request body too large');
  });

  it('still defaults an unrecognized error to 500 with a generic message', () => {
    const res = makeRes();
    globalErrorHandler(new TypeError('cannot read property of undefined'), makeReq(), res, vi.fn() as NextFunction);

    const r = res as unknown as { statusCode: number; body: { error: { message: string } } };
    expect(r.statusCode).toBe(500);
    expect(r.body.error.message).toBe('Internal server error');
  });
});
