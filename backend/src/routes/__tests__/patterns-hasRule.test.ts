import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockPatterns = [
  { _id: { toString: () => 'p1' }, status: 'approved' },
  { _id: { toString: () => 'p2' }, status: 'detected' },
];

vi.mock('../../models/Pattern.js', () => ({
  Pattern: {
    find: vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(mockPatterns),
    }),
    countDocuments: vi.fn().mockResolvedValue(2),
  },
}));

vi.mock('../../models/Rule.js', () => ({
  Rule: {
    find: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([
        { sourcePatternId: { toString: () => 'p1' } },
      ]),
    }),
  },
}));

import { Rule } from '../../models/Rule.js';

describe('GET /api/patterns hasRule enrichment', () => {
  it('annotates patterns with hasRule based on Rule.sourcePatternId lookup', async () => {
    const { Rule: MockRule } = await import('../../models/Rule.js');

    const patternIds = mockPatterns.map((p) => p._id);
    const rules = await (MockRule.find({ sourcePatternId: { $in: patternIds } }) as any)
      .select('sourcePatternId')
      .lean();

    const rulePatternIds = new Set(rules.map((r: any) => r.sourcePatternId.toString()));

    const enriched = mockPatterns.map((p) => ({
      ...p,
      hasRule: rulePatternIds.has(p._id.toString()),
    }));

    expect(enriched[0].hasRule).toBe(true);
    expect(enriched[1].hasRule).toBe(false);
  });
});
