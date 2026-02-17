---
phase: 02-authentication-token-management
plan: 02
subsystem: auth
tags: [msal, bullmq, token-refresh, admin-api, multi-mailbox, oauth, express]

# Dependency graph
requires:
  - phase: 02-authentication-token-management/01
    provides: MSAL client factories, auth middleware (requireAuth/requireAdmin), JWT session cookies, OAuth callback skeleton
  - phase: 01-infrastructure-foundation
    provides: BullMQ queues/workers, Mongoose models (User, Mailbox, Notification), error handler classes
provides:
  - Token refresh BullMQ processor that proactively refreshes MSAL tokens for all connected mailboxes
  - Admin user management API (invite, list, role change, deactivate)
  - Multi-mailbox connection flow (connect, list, disconnect)
  - OAuth callback handler for connect_mailbox action
  - ConflictError (409) error class
affects: [03-graph-api-mail-observation, 04-frontend-dashboard, 06-automation-rule-management]

# Tech tracking
tech-stack:
  added: []
  patterns: [processorMap for BullMQ workers, per-route auth middleware, signed JWT state for multi-step OAuth flows]

key-files:
  created:
    - backend/src/jobs/processors/tokenRefresh.ts
    - backend/src/routes/admin.ts
    - backend/src/routes/mailbox.ts
  modified:
    - backend/src/jobs/queues.ts
    - backend/src/auth/routes.ts
    - backend/src/server.ts
    - backend/src/middleware/errorHandler.ts

key-decisions:
  - "Token refresh queries ALL connected mailboxes (no expiry filter) -- MSAL acquireTokenSilent returns cached tokens immediately for still-valid tokens, avoiding risk of missed narrow expiry windows"
  - "ProcessorMap pattern in queues.ts maps queue names to processor functions (real or placeholder) for clean worker creation"
  - "ConflictError (409) added to error handler for admin invite duplicate detection"
  - "Multi-mailbox connect uses signed JWT state with userId and action for CSRF-safe cross-request context"

patterns-established:
  - "processorMap: Record<QueueName, (job: Job) => Promise<void>> for mapping real processors to BullMQ workers"
  - "Self-protection guards: admin routes prevent self-demotion and self-deactivation"
  - "Reconnect pattern: existing-but-disconnected mailboxes are reconnected rather than duplicated"

requirements-completed: [AUTH-03, AUTH-05, AUTH-06]

# Metrics
duration: 3min
completed: 2026-02-17
---

# Phase 2 Plan 2: Token Refresh, Admin Management & Multi-Mailbox Summary

**BullMQ token refresh processor with MSAL silent acquisition, admin invite/role/deactivate API, and multi-mailbox connect/disconnect/list flow with OAuth callback integration**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-17T16:13:58Z
- **Completed:** 2026-02-17T16:16:59Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Token refresh BullMQ worker proactively refreshes MSAL tokens for all connected mailboxes, marking them disconnected with high-priority notification on interaction_required errors
- Admin user management API with invite, list, role change, and deactivate endpoints (all protected by requireAdmin)
- Multi-mailbox connect flow initiates new OAuth with prompt:select_account, callback creates/reconnects Mailbox with per-mailbox MSAL cache
- Self-protection guards prevent admins from demoting or deactivating themselves

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement token refresh BullMQ worker processor** - `f47653e` (feat)
2. **Task 2: Create admin routes, mailbox routes, and extend callback for multi-mailbox** - `217dd99` (feat)

## Files Created/Modified
- `backend/src/jobs/processors/tokenRefresh.ts` - BullMQ processor that refreshes MSAL tokens for all connected mailboxes
- `backend/src/jobs/queues.ts` - ProcessorMap wires real token-refresh processor, placeholders for other 4 queues
- `backend/src/routes/admin.ts` - Admin user management: invite, list, role change, deactivate
- `backend/src/routes/mailbox.ts` - Multi-mailbox: connect (OAuth initiation), list, disconnect
- `backend/src/auth/routes.ts` - OAuth callback extended with connect_mailbox action handler
- `backend/src/server.ts` - Mounted adminRouter and mailboxRouter
- `backend/src/middleware/errorHandler.ts` - Added ConflictError (409)

## Decisions Made
- Token refresh queries ALL connected mailboxes without expiry filter -- MSAL's acquireTokenSilent handles cache hits for still-valid tokens, avoiding risk of delayed cycle missing narrow expiry window
- ProcessorMap pattern for clean mapping of real vs placeholder processors to BullMQ workers
- Added ConflictError (409) to error handler for admin invite duplicate user detection
- Multi-mailbox connect uses signed JWT state parameter with userId and action for CSRF-safe cross-request context

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added ConflictError class to error handler**
- **Found during:** Task 2 (Admin routes)
- **Issue:** Admin invite endpoint needs 409 Conflict response for duplicate emails, but no ConflictError class existed
- **Fix:** Added ConflictError class extending AppError with status 409, following existing pattern (ValidationError, NotFoundError, etc.)
- **Files modified:** backend/src/middleware/errorHandler.ts
- **Verification:** TypeScript compiles, class follows existing error class pattern
- **Committed in:** 217dd99 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary for correctness. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Authentication and token management stack is complete (Phase 2 done)
- Token refresh worker ensures Graph API access persists across container restarts without re-authentication
- Admin can invite users and manage roles
- Users can connect/disconnect multiple mailboxes with independent token caches
- Ready for Phase 3 (Graph API mail observation) which will use getAccessTokenForMailbox() and the connected mailbox infrastructure
- Cloudflare Tunnel still needed before Phase 3 webhook testing (existing blocker)

## Self-Check: PASSED

All 4 created files verified on disk. All 2 task commits verified in git log.

---
*Phase: 02-authentication-token-management*
*Completed: 2026-02-17*
