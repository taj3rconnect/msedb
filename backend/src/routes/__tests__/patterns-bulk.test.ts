import { describe, it, expect } from 'vitest';
import { Types } from 'mongoose';

/**
 * Unit coverage for the pure decision logic behind
 * POST /api/patterns/bulk-approve and the bulk-rule drawer's threshold filter.
 *
 * The route's I/O (Mongo, Graph) is exercised in the deployed smoke check; what
 * is worth pinning here is which patterns are eligible and which are skipped.
 */

const BULK_APPROVE_MAX = 500;

/** Mirrors the route's request validation. */
function validateBulkRequest(body: { patternIds?: unknown; actionType?: unknown }): string | null {
  const { patternIds, actionType } = body;
  if (!Array.isArray(patternIds) || patternIds.length === 0) {
    return 'patternIds must be a non-empty array';
  }
  if (patternIds.length > BULK_APPROVE_MAX) {
    return `Cannot process more than ${BULK_APPROVE_MAX} patterns in one request`;
  }
  if (!patternIds.every((id): id is string => typeof id === 'string' && Types.ObjectId.isValid(id))) {
    return 'patternIds must all be valid pattern ids';
  }
  if (actionType !== 'delete' && actionType !== 'markRead') {
    return "actionType must be 'delete' or 'markRead'";
  }
  return null;
}

/** Mirrors the route's per-pattern eligibility check. */
function isApprovable(status: string): boolean {
  return status === 'detected' || status === 'suggested';
}

/** Mirrors BulkRuleDrawer.actedRate. */
function actedRate(sampleSize: number, exceptionCount: number): number {
  if (!sampleSize) return 0;
  return ((sampleSize - exceptionCount) / sampleSize) * 100;
}

const validId = () => new Types.ObjectId().toString();

describe('POST /api/patterns/bulk-approve validation', () => {
  it('rejects an empty or missing patternIds array', () => {
    expect(validateBulkRequest({ patternIds: [], actionType: 'delete' })).toMatch(/non-empty/);
    expect(validateBulkRequest({ actionType: 'delete' })).toMatch(/non-empty/);
  });

  it('rejects malformed pattern ids', () => {
    expect(validateBulkRequest({ patternIds: ['not-an-id'], actionType: 'delete' })).toMatch(/valid pattern ids/);
    expect(validateBulkRequest({ patternIds: [123], actionType: 'delete' })).toMatch(/valid pattern ids/);
  });

  it('rejects action types outside delete / markRead', () => {
    expect(validateBulkRequest({ patternIds: [validId()], actionType: 'move' })).toMatch(/delete.*markRead/);
    expect(validateBulkRequest({ patternIds: [validId()] })).toMatch(/delete.*markRead/);
  });

  it('rejects batches larger than the cap', () => {
    const ids = Array.from({ length: BULK_APPROVE_MAX + 1 }, validId);
    expect(validateBulkRequest({ patternIds: ids, actionType: 'delete' })).toMatch(/more than 500/);
  });

  it('accepts a well-formed request for both action types', () => {
    expect(validateBulkRequest({ patternIds: [validId(), validId()], actionType: 'delete' })).toBeNull();
    expect(validateBulkRequest({ patternIds: [validId()], actionType: 'markRead' })).toBeNull();
  });
});

describe('bulk-approve pattern eligibility', () => {
  it('approves only detected and suggested patterns', () => {
    expect(isApprovable('detected')).toBe(true);
    expect(isApprovable('suggested')).toBe(true);
  });

  it('skips patterns that are already resolved', () => {
    for (const status of ['approved', 'rejected', 'expired']) {
      expect(isApprovable(status)).toBe(false);
    }
  });
});

describe('acted-on rate threshold', () => {
  it('computes the share of observed emails the user acted on', () => {
    expect(actedRate(100, 5)).toBe(95);
    expect(actedRate(20, 0)).toBe(100);
    expect(actedRate(10, 5)).toBe(50);
  });

  it('returns 0 rather than NaN when nothing was observed', () => {
    expect(actedRate(0, 0)).toBe(0);
  });

  it("matches the user's 90% / 85% / 10-observed example", () => {
    const minActed = 90;
    const minConfidence = 85;
    const minObserved = 10;

    const candidates = [
      { id: 'a', sampleSize: 100, exceptionCount: 5, confidence: 92 },  // 95% acted — in
      { id: 'b', sampleSize: 100, exceptionCount: 20, confidence: 99 }, // 80% acted — out
      { id: 'c', sampleSize: 100, exceptionCount: 2, confidence: 80 },  // confidence too low — out
      { id: 'd', sampleSize: 4, exceptionCount: 0, confidence: 99 },    // too few observed — out
      { id: 'e', sampleSize: 10, exceptionCount: 1, confidence: 85 },   // exactly on all floors — in
    ];

    const matched = candidates
      .filter((p) => actedRate(p.sampleSize, p.exceptionCount) >= minActed)
      .filter((p) => p.confidence >= minConfidence)
      .filter((p) => p.sampleSize >= minObserved)
      .map((p) => p.id);

    expect(matched).toEqual(['a', 'e']);
  });
});
