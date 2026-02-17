---
phase: 04-frontend-shell-observation-ui
plan: 03
subsystem: email-activity-ui
tags: [frontend, backend, api, charts, data-table, recharts, tanstack-table]
dependency_graph:
  requires: [04-02]
  provides: [email-activity-page, events-api]
  affects: [patterns-page, rules-page]
tech_stack:
  added: []
  patterns: [TanStack Table server-side sorting, Recharts area/bar charts via shadcn ChartContainer, server-side pagination with Promise.all, MongoDB aggregation pipelines]
key_files:
  created:
    - backend/src/routes/events.ts
    - frontend/src/api/events.ts
    - frontend/src/hooks/useEvents.ts
    - frontend/src/components/events/EventsTable.tsx
    - frontend/src/components/events/EventFilters.tsx
    - frontend/src/components/events/EventTimeline.tsx
    - frontend/src/components/events/SenderBreakdown.tsx
    - frontend/src/pages/EmailActivityPage.tsx
  modified:
    - backend/src/server.ts
    - frontend/src/App.tsx
decisions:
  - TanStack Table with manualSorting and manualPagination for server-driven data table
  - shadcn ChartContainer wraps Recharts for consistent theming with OKLCH colors
  - Sender breakdown shows top 10 from 20 API results to keep chart readable
  - EventFilters combines event type Select, sender domain Input, and range toggle in one row
  - Timeline range toggle uses Button group (not tabs) for compactness
metrics:
  duration: 3min
  completed: 2026-02-17
---

# Phase 4 Plan 3: Email Activity Page Summary

Filterable paginated data table with event timeline area chart and sender domain breakdown bar chart, backed by three new MongoDB aggregation API endpoints.

## What Was Built

### Backend (Task 1)

Three new API endpoints in `backend/src/routes/events.ts`, all requiring authentication and filtering by userId from JWT:

1. **GET /api/events** -- Paginated event list with filtering by mailboxId, eventType, and sender.domain. Supports server-side sorting (sortBy/sortOrder) and pagination (page/limit). Uses `Promise.all` for parallel query + count.

2. **GET /api/events/sender-breakdown** -- MongoDB aggregation grouping by `sender.domain`, returning top 20 domains with count and latest event timestamp. Optional mailboxId filter.

3. **GET /api/events/timeline** -- MongoDB aggregation grouping events into hourly buckets (24h) or daily buckets (30d) using `$dateToString`. Optional mailboxId filter.

Router mounted in `server.ts` as `app.use('/api/events', eventsRouter)` before the global error handler.

### Frontend (Task 2)

**API Layer** (`frontend/src/api/events.ts`):
- `fetchEvents(params)` -- builds query string from filter/pagination params
- `fetchSenderBreakdown(mailboxId?)` -- sender domain aggregation
- `fetchEventTimeline(mailboxId?, range?)` -- timeline aggregation

**Hooks** (`frontend/src/hooks/useEvents.ts`):
- `useEvents(params)` -- query key `['events', 'list', params]`
- `useSenderBreakdown(mailboxId?)` -- query key `['events', 'sender-breakdown', mailboxId]`
- `useEventTimeline(mailboxId?, range?)` -- query key `['events', 'timeline', mailboxId, range]`
- All auto-refresh via Socket.IO invalidation of `['events']` prefix (wired in Plan 02)

**Components:**
- `EventsTable` -- TanStack Table with 6 columns (Type badge, Sender email+domain, Subject truncated, Folder from->to, Timestamp relative, Attachments icon). Server-side sorting, manual pagination with Previous/Next controls.
- `EventFilters` -- Event type Select dropdown, sender domain Input, 24h/30d Button group toggle.
- `EventTimeline` -- Recharts AreaChart in shadcn ChartContainer. X-axis formatted as "HH:00" (24h) or "MMM dd" (30d). Tooltip with full date.
- `SenderBreakdown` -- Recharts horizontal BarChart showing top 10 domains with count bars. Y-axis truncates long domains.

**Page** (`EmailActivityPage`):
- Manages local state for filters, pagination, and sorting
- Reads `selectedMailboxId` from Zustand uiStore for global mailbox filtering
- Layout: charts row (60/40 split on desktop, stacked on mobile), then filters, then data table
- Error/loading/empty states handled throughout

**Route** updated in `App.tsx`: `/activity` now renders `EmailActivityPage` instead of `ComingSoonPage`.

## Deviations from Plan

None -- plan executed exactly as written.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | d335a7c | Events API endpoints with pagination, filtering, aggregations |
| 2 | 4a55d1c | Email activity page with data table, charts, and filters |

## Verification

- `cd backend && npx tsc --noEmit` -- PASSED
- `cd frontend && npx tsc -b` -- PASSED
- `cd frontend && npx vite build` -- PASSED (dist/ output produced)
- `grep -r "eventsRouter" backend/src/server.ts` -- Route mounted
- `grep -r "EmailActivityPage" frontend/src/App.tsx` -- Route wired
- All 8 new files created and verified

## Self-Check: PASSED

All 8 created files confirmed on disk. Both task commits (d335a7c, 4a55d1c) verified in git log.
