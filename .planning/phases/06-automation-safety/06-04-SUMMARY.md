---
phase: 06-automation-safety
plan: 04
subsystem: api
tags: [bullmq, staging, rule-engine, webhook, graph-api, automation-pipeline]

# Dependency graph
requires:
  - phase: 06-automation-safety
    provides: "Rule engine (evaluateRulesForMessage), action executor (executeActions), staging manager"
  - phase: 03-email-observation-pipeline
    provides: "eventCollector (processChangeNotification, handleCreated), graphFetch, GraphApiError"
  - phase: 01-infrastructure-foundation
    provides: "BullMQ queues, Redis config, logger"
provides:
  - "Staging processor: BullMQ job processing expired staged items every 30 minutes"
  - "Rule engine integration: evaluateRulesForMessage wired into handleCreated in eventCollector"
  - "All 6 BullMQ queues now have production processors (no more placeholders)"
affects: [06-automation-safety, 07-polish-hardening]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Chunked Promise.allSettled for batch processing with concurrency control (5 items per chunk)"
    - "Error isolation: rule evaluation wrapped in try-catch so observation pipeline is unaffected"
    - "Soft-delete pattern in staging processor: move to deleteditems, never permanentDelete"

key-files:
  created:
    - backend/src/jobs/processors/stagingProcessor.ts
  modified:
    - backend/src/jobs/queues.ts
    - backend/src/services/eventCollector.ts

key-decisions:
  - "Staging processor uses chunked Promise.allSettled (batches of 5) for concurrency control"
  - "Rule evaluation runs inline with webhook processing (not in separate queue) for low latency"
  - "Rule evaluation errors are isolated -- email event recording continues even if automation fails"
  - "Removed createProcessor placeholder from queues.ts since all 6 queues now have real processors"

patterns-established:
  - "Inline rule evaluation in event pipeline with error isolation"
  - "Graceful handling of 404 (message gone) and 429 (rate limit) in staging processor"
  - "All BullMQ queues use production processors with no placeholders remaining"

requirements-completed: [SAFE-01, SAFE-02]

# Metrics
duration: 3min
completed: 2026-02-17
---

# Phase 6 Plan 4: Automation Pipeline Wiring Summary

**Staging processor BullMQ job with 404/429 handling, and rule engine integrated into webhook event pipeline with error isolation**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-17T20:31:33Z
- **Completed:** 2026-02-17T20:34:21Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Staging processor replaces placeholder, processes expired staged items with batched concurrency (chunks of 5)
- Handles 404 (message gone) gracefully by marking as expired, and 429 (rate limit) by skipping for next run
- Rule engine wired into handleCreated in eventCollector, evaluating incoming emails inline
- Error isolation ensures observation pipeline works even if rule evaluation or action execution fails
- All 6 BullMQ queues now have production processors -- createProcessor placeholder removed

## Task Commits

Each task was committed atomically:

1. **Task 1: Staging processor BullMQ job** - `aec4cc1` (feat)
2. **Task 2: Integrate rule engine into webhook event pipeline** - `5a30eba` (feat)

## Files Created/Modified
- `backend/src/jobs/processors/stagingProcessor.ts` - BullMQ processor for expired staged items with 404/429 handling and AuditLog creation
- `backend/src/jobs/queues.ts` - Replaced placeholder with processStagingItems, removed unused createProcessor function
- `backend/src/services/eventCollector.ts` - Added evaluateRulesForMessage and executeActions integration in handleCreated

## Decisions Made
- Staging processor processes items in batches of 5 using Promise.allSettled for concurrency control without overwhelming Graph API
- Rule evaluation runs inline with webhook event processing (not deferred to a separate queue) to keep automation latency low
- Rule evaluation failures are caught and logged but never block email event recording -- the observation pipeline must remain reliable
- 404 in staging processor marks item as 'expired' (message already gone), 429 skips item for next run
- Removed createProcessor placeholder entirely since all 6 BullMQ queues now use real processor functions

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed parentFolderId type mismatch in eventCollector**
- **Found during:** Task 2 (rule engine integration)
- **Issue:** `graphMessage.parentFolderId` is `string | undefined` but `executeActions` expects `string` for `originalFolder`
- **Fix:** Added nullish coalescing fallback: `graphMessage.parentFolderId ?? ''`
- **Files modified:** backend/src/services/eventCollector.ts
- **Verification:** `npx tsc --noEmit` passes
- **Committed in:** 5a30eba (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor type safety fix required for correctness. No scope creep.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- End-to-end automation flow is now wired: email arrives -> event saved -> rules evaluated -> actions executed (or staged)
- Staging processor runs every 30 minutes to execute expired staged items
- All services compile cleanly with no type errors
- Next plans can build automation API endpoints and staging UI components

## Self-Check: PASSED

- All 3 files verified present on disk
- Both task commits (aec4cc1, 5a30eba) verified in git log

---
*Phase: 06-automation-safety*
*Completed: 2026-02-17*
