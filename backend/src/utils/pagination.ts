import type { Request } from 'express';

export interface PaginationOptions {
  defaultLimit: number;
  maxLimit: number;
}

export interface Pagination {
  page: number;
  limit: number;
}

/**
 * Parse and clamp `page`/`limit` query params.
 *
 * `page` defaults to 1 (any non-positive/non-numeric value falls back to the default).
 * `limit` defaults to `opts.defaultLimit` and is capped at `opts.maxLimit`.
 */
export function parsePagination(query: Request['query'], opts: PaginationOptions): Pagination {
  let page = 1;
  if (query.page) {
    const parsed = parseInt(query.page as string, 10);
    if (!isNaN(parsed) && parsed > 0) {
      page = parsed;
    }
  }

  let limit = opts.defaultLimit;
  if (query.limit) {
    const parsed = parseInt(query.limit as string, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, opts.maxLimit);
    }
  }

  return { page, limit };
}
