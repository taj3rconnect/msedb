---
phase: 06-automation-safety
plan: 01
subsystem: api
tags: [rule-engine, whitelist, staging, graph-api, redis, socket.io, automation-safety]

# Dependency graph
requires:
  - phase: 01-infrastructure-foundation
    provides: "Redis config (getRedisClient), Socket.IO (getIO), logger, error handler"
  - phase: 03-email-observation-pipeline
    provides: "graphFetch, GraphApiError, GraphMessage type, metadataExtractor"
provides:
  - "Rule engine: evaluateRulesForMessage with kill switch + whitelist + first-match-wins"
  - "Whitelist service: per-mailbox (Mongo) and org-wide (Redis) sender/domain protection"
  - "Action executor: Graph API action execution with staging for destructive actions"
  - "Staging manager: staging folder CRUD, staged email lifecycle, batch rescue"
  - "StagedEmail TTL fix: cleanupAt field for safe TTL (expiresAt + 7 days buffer)"
affects: [06-automation-safety, 07-polish-hardening]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Kill switch -> whitelist -> priority rules evaluation order"
    - "Staging pattern: destructive actions routed through staging folder, never permanentDelete"
    - "Module-level Map cache for Graph API folder IDs"
    - "Org-wide whitelist via Redis Sets (org:whitelist:senders, org:whitelist:domains)"

key-files:
  created:
    - backend/src/services/ruleEngine.ts
    - backend/src/services/whitelistService.ts
    - backend/src/services/actionExecutor.ts
    - backend/src/services/stagingManager.ts
  modified:
    - backend/src/models/StagedEmail.ts

key-decisions:
  - "Org-wide whitelist stored in Redis Sets for fast O(1) lookup without extra Mongo queries"
  - "StagedEmail TTL uses cleanupAt = expiresAt + 7 days to prevent premature auto-deletion"
  - "Action executor breaks on 404 (message gone) rather than continuing to next action"
  - "Socket.IO staging notifications wrapped in try/catch for worker process compatibility"

patterns-established:
  - "Safety evaluation chain: kill switch -> whitelist -> rules (never skip steps)"
  - "All delete actions go through staging folder, never permanentDelete"
  - "Audit logging for every state change (staged, rescued, executed)"

requirements-completed: [AUTO-01, AUTO-03, SAFE-01, SAFE-02, SAFE-04]

# Metrics
duration: 2min
completed: 2026-02-17
---

# Phase 6 Plan 1: Core Automation Engine Summary

**Rule engine with kill switch + whitelist + first-match-wins evaluation, action executor routing deletes through staging folder, and org-wide whitelist via Redis Sets**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-17T20:26:10Z
- **Completed:** 2026-02-17T20:28:41Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Rule engine evaluates kill switch -> whitelist -> priority-sorted rules with first-match-wins semantics
- Whitelist service protects senders/domains at both per-mailbox (Mongo) and org-wide (Redis) levels
- Action executor translates rule actions to Graph API calls, routing all deletes through staging folder
- Staging manager handles folder creation, staged email CRUD, batch rescue, and real-time Socket.IO notifications
- StagedEmail TTL index fixed to use cleanupAt (expiresAt + 7 days) preventing premature document deletion

## Task Commits

Each task was committed atomically:

1. **Task 1: Rule engine, whitelist service, and StagedEmail TTL fix** - `16905cc` (feat)
2. **Task 2: Action executor and staging manager** - `92a4354` (feat)

## Files Created/Modified
- `backend/src/services/ruleEngine.ts` - Core rule evaluation with kill switch, whitelist, and first-match-wins logic
- `backend/src/services/whitelistService.ts` - Per-mailbox and org-wide sender/domain whitelist checks
- `backend/src/services/actionExecutor.ts` - Graph API action execution with staging for destructive actions
- `backend/src/services/stagingManager.ts` - Staging folder creation, staged email CRUD, rescue, Socket.IO events
- `backend/src/models/StagedEmail.ts` - Added cleanupAt field and moved TTL index from expiresAt to cleanupAt

## Decisions Made
- Org-wide whitelist stored in Redis Sets (`org:whitelist:senders` / `org:whitelist:domains`) for O(1) membership checks without Mongo queries
- StagedEmail cleanupAt set to expiresAt + 7 days, giving the staging processor ample time to execute before TTL auto-deletion
- Action executor breaks on 404 rather than continuing -- if message is gone, further actions on it are meaningless
- Socket.IO notifications wrapped in try/catch since staging manager may run in BullMQ worker processes where Socket.IO is not initialized

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Rule engine, action executor, whitelist service, and staging manager are ready for the automation pipeline
- Next plans can build rule CRUD API routes, the staging processor job, and the automation API endpoints
- All services compile cleanly with no type errors

## Self-Check: PASSED

- All 5 files verified present on disk
- Both task commits (16905cc, 92a4354) verified in git log

---
*Phase: 06-automation-safety*
*Completed: 2026-02-17*
