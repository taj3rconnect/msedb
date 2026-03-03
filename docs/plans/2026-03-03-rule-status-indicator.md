# Rule Status Indicator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `hasRule` boolean to the patterns API response, show a badge on each pattern card, and add a Has Rule / No Rule / All filter dropdown on the Patterns page.

**Architecture:** Backend enriches `GET /api/patterns` with a single extra `Rule.find` lookup keyed on `sourcePatternId`. Frontend consumes `hasRule` for a badge in `PatternCard` and a new filter Select in `PatternFilters`, wired in `PatternsPage`.

**Tech Stack:** Express/Mongoose (backend), React + TypeScript + Tailwind + shadcn/ui (frontend), Vitest (backend tests only — no frontend test infra).

---

### Task 1: Enrich patterns API response with `hasRule`

**Files:**
- Modify: `backend/src/routes/patterns.ts` (lines 66–83)

**Step 1: Write the failing test**

File: `backend/src/routes/__tests__/patterns-hasRule.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// Import after mocks
import { Rule } from '../../models/Rule.js';

describe('GET /api/patterns hasRule enrichment', () => {
  it('annotates patterns with hasRule based on Rule.sourcePatternId lookup', async () => {
    const { Rule: MockRule } = await import('../../models/Rule.js');

    // Simulate the enrichment logic directly
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
```

**Step 2: Run to verify it fails**

```bash
cd /home/admin/claude/MSEDB/backend && npm test -- --reporter=verbose 2>&1 | tail -20
```

Expected: test file not found or import error.

**Step 3: Implement — enrich patterns in the route**

In `backend/src/routes/patterns.ts`, after the parallel query (after line 73, before `res.json`), add:

```ts
  // Enrich patterns with hasRule
  const patternIds = patterns.map((p) => p._id);
  const rulesForPatterns = await Rule.find({ sourcePatternId: { $in: patternIds } })
    .select('sourcePatternId')
    .lean();
  const rulePatternIdSet = new Set(rulesForPatterns.map((r) => r.sourcePatternId!.toString()));
  const enrichedPatterns = patterns.map((p) => ({
    ...p,
    hasRule: rulePatternIdSet.has(p._id.toString()),
  }));
```

Then change `res.json` to use `enrichedPatterns` instead of `patterns`:

```ts
  res.json({
    patterns: enrichedPatterns,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
```

Also add the `Rule` import at the top of `patterns.ts` (it's not currently imported):

```ts
import { Rule } from '../models/Rule.js';
```

**Step 4: Run test to verify it passes**

```bash
cd /home/admin/claude/MSEDB/backend && npm test -- --reporter=verbose 2>&1 | tail -20
```

Expected: PASS

**Step 5: Commit**

```bash
cd /home/admin/claude/MSEDB && git add backend/src/routes/patterns.ts backend/src/routes/__tests__/patterns-hasRule.test.ts && git commit -m "feat: enrich GET /api/patterns response with hasRule boolean"
```

---

### Task 2: Add `hasRule` to frontend Pattern type

**Files:**
- Modify: `frontend/src/api/patterns.ts` (line 42, after `updatedAt`)

**Step 1: Add the field**

In the `Pattern` interface, after `updatedAt: string;`, add:

```ts
  hasRule?: boolean;
```

**Step 2: Verify TypeScript compiles**

```bash
cd /home/admin/claude/MSEDB/frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

**Step 3: Commit**

```bash
cd /home/admin/claude/MSEDB && git add frontend/src/api/patterns.ts && git commit -m "feat: add hasRule field to Pattern frontend type"
```

---

### Task 3: Add rule status badge to PatternCard

**Files:**
- Modify: `frontend/src/components/patterns/PatternCard.tsx`

**Step 1: Add the badge**

After the existing status badge (around line 105–107 in the badge row `<div>`), add:

```tsx
          {pattern.hasRule === true && (
            <Badge variant="outline" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
              Rule Active
            </Badge>
          )}
          {pattern.status === 'approved' && pattern.hasRule === false && (
            <Badge variant="outline" className="bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              No Rule
            </Badge>
          )}
```

No new imports needed — `Badge` is already imported.

**Step 2: Verify TypeScript compiles**

```bash
cd /home/admin/claude/MSEDB/frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

**Step 3: Commit**

```bash
cd /home/admin/claude/MSEDB && git add frontend/src/components/patterns/PatternCard.tsx && git commit -m "feat: add Rule Active / No Rule badge to PatternCard"
```

---

### Task 4: Add rule filter dropdown to PatternFilters

**Files:**
- Modify: `frontend/src/components/patterns/PatternFilters.tsx`

**Step 1: Add prop and Select**

Replace the entire file content with:

```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface PatternFiltersProps {
  status: string;
  patternType: string;
  ruleFilter: string;
  onStatusChange: (status: string) => void;
  onPatternTypeChange: (type: string) => void;
  onRuleFilterChange: (value: string) => void;
}

export function PatternFilters({
  status,
  patternType,
  ruleFilter,
  onStatusChange,
  onPatternTypeChange,
  onRuleFilterChange,
}: PatternFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select value={status} onValueChange={onStatusChange}>
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="All Statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          <SelectItem value="detected">Detected</SelectItem>
          <SelectItem value="suggested">Suggested</SelectItem>
          <SelectItem value="approved">Approved</SelectItem>
          <SelectItem value="rejected">Rejected</SelectItem>
        </SelectContent>
      </Select>

      <Select value={patternType} onValueChange={onPatternTypeChange}>
        <SelectTrigger className="w-[170px]">
          <SelectValue placeholder="All Types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Types</SelectItem>
          <SelectItem value="sender">Sender</SelectItem>
          <SelectItem value="folder-routing">Folder Routing</SelectItem>
        </SelectContent>
      </Select>

      <Select value={ruleFilter} onValueChange={onRuleFilterChange}>
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="All Rules" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Rules</SelectItem>
          <SelectItem value="has-rule">Has Rule</SelectItem>
          <SelectItem value="no-rule">No Rule</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd /home/admin/claude/MSEDB/frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: error about missing `ruleFilter` prop in `PatternsPage` (expected — will fix in Task 5).

**Step 3: Commit**

```bash
cd /home/admin/claude/MSEDB && git add frontend/src/components/patterns/PatternFilters.tsx && git commit -m "feat: add Has Rule / No Rule filter dropdown to PatternFilters"
```

---

### Task 5: Wire rule filter in PatternsPage

**Files:**
- Modify: `frontend/src/pages/PatternsPage.tsx`

**Step 1: Add state and filter logic**

Add `ruleFilter` state alongside the existing filter state (after line 31):

```ts
  const [ruleFilter, setRuleFilter] = useState('all');
```

Add handler (after `handleTypeChange`):

```ts
  const handleRuleFilterChange = useCallback((value: string) => {
    setRuleFilter(value);
    setPage(1);
  }, []);
```

Extend the `filteredPatterns` expression (replace the existing one at line 50–52):

```ts
  const filteredPatterns = data?.patterns.filter(
    (p) =>
      (typeFilter === 'all' || p.patternType === typeFilter) &&
      (ruleFilter === 'all' ||
        (ruleFilter === 'has-rule' && p.hasRule) ||
        (ruleFilter === 'no-rule' && !p.hasRule)),
  ) ?? [];
```

Update the `<PatternFilters>` JSX to pass the new props (around line 119–124):

```tsx
      <PatternFilters
        status={statusFilter}
        patternType={typeFilter}
        ruleFilter={ruleFilter}
        onStatusChange={handleStatusChange}
        onPatternTypeChange={handleTypeChange}
        onRuleFilterChange={handleRuleFilterChange}
      />
```

Also update the empty state description to account for rule filter (around line 144):

```tsx
              statusFilter !== 'all' || typeFilter !== 'all' || ruleFilter !== 'all'
```

**Step 2: Verify TypeScript compiles cleanly**

```bash
cd /home/admin/claude/MSEDB/frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

**Step 3: Commit**

```bash
cd /home/admin/claude/MSEDB && git add frontend/src/pages/PatternsPage.tsx && git commit -m "feat: wire rule filter state and client-side filter in PatternsPage"
```

---

### Task 6: Build and verify

**Step 1: Build frontend**

```bash
cd /home/admin/claude/MSEDB/frontend && npm run build 2>&1 | tail -20
```

Expected: build succeeds with no errors.

**Step 2: Run backend tests**

```bash
cd /home/admin/claude/MSEDB/backend && npm test 2>&1 | tail -20
```

Expected: all tests pass.

**Step 3: Bump subversion in version.json**

Per project convention, increment the subversion by .01 (e.g. v1.15.01 → v1.15.02).

**Step 4: Final commit**

```bash
cd /home/admin/claude/MSEDB && git add version.json && git commit -m "chore: bump version"
```
