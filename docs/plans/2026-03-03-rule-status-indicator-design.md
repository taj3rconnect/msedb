# Rule Status Indicator — Design

## Summary

Add a "Has Rule / No Rule" badge to pattern cards and a rule filter dropdown to the Patterns page.

## Approach

Backend enriches `GET /api/patterns` with a computed `hasRule: boolean` per pattern (single extra `Rule.find` on `sourcePatternId`). Frontend uses this field for both the badge and the filter.

## Changes

### backend/src/routes/patterns.ts
After fetching patterns, query `Rule.find({ sourcePatternId: { $in: patternIds } })`, build a Set of matched IDs, and annotate each pattern with `hasRule: boolean` before responding.

### frontend/src/api/patterns.ts
Add `hasRule?: boolean` to the `Pattern` interface.

### frontend/src/components/patterns/PatternCard.tsx
Add a badge in the header after the status badge: "Rule Active" (green) when `hasRule === true`, "No Rule" (muted) when `status === 'approved' && !hasRule`.

### frontend/src/components/patterns/PatternFilters.tsx
Add a third `<Select>` for rule filter: All / Has Rule / No Rule.

### frontend/src/pages/PatternsPage.tsx
Add `ruleFilter` state, pass to `PatternFilters`, apply client-side filter alongside existing type filter.
