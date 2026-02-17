---
phase: 01-infrastructure-foundation
plan: 02
subsystem: infra
tags: [mongoose, mongodb, ioredis, redis, bullmq, job-schedulers, models, queues, workers]

# Dependency graph
requires:
  - phase: 01-01
    provides: "Docker Compose stack with backend, MongoDB 7, Redis 7 containers"
provides:
  - "MongoDB connection with exponential backoff retry (max 10 retries, 1s-30s delays)"
  - "Redis connection factories for BullMQ (plain config objects) and general-purpose ioredis client"
  - "9 Mongoose models: User, Mailbox, EmailEvent, Pattern, Rule, StagedEmail, AuditLog, Notification, WebhookSubscription"
  - "Compound indexes, TTL indexes (90-day EmailEvent, 30-day Notification), unique/sparse constraints"
  - "5 BullMQ queues with removeOnComplete/removeOnFail age limits"
  - "5 job schedulers via upsertJobScheduler (webhook-renewal 2h, delta-sync 15m, pattern-analysis daily 2AM, staging-processor 30m, token-refresh 45m)"
  - "5 workers with placeholder processors"
  - "Graceful shutdown handler (SIGTERM/SIGINT) closing workers, queues, Mongoose, Redis"
  - "Health endpoint reporting MongoDB and Redis connection status"
affects: [01-03, 02-auth, 03-observation, 04-frontend, 05-patterns, 06-automation]

# Tech tracking
tech-stack:
  added: [mongoose@8, ioredis@5, bullmq@5]
  patterns: [exponential-backoff-retry, plain-config-objects-for-bullmq, upsertJobScheduler, graceful-shutdown, barrel-export-models]

key-files:
  created:
    - backend/src/config/database.ts
    - backend/src/config/redis.ts
    - backend/src/models/User.ts
    - backend/src/models/Mailbox.ts
    - backend/src/models/EmailEvent.ts
    - backend/src/models/Pattern.ts
    - backend/src/models/Rule.ts
    - backend/src/models/StagedEmail.ts
    - backend/src/models/AuditLog.ts
    - backend/src/models/Notification.ts
    - backend/src/models/WebhookSubscription.ts
    - backend/src/models/index.ts
    - backend/src/jobs/queues.ts
    - backend/src/jobs/schedulers.ts
  modified:
    - backend/package.json
    - backend/src/server.ts

key-decisions:
  - "Use plain connection config objects for BullMQ instead of ioredis instances to avoid version mismatch between project ioredis and BullMQ's bundled ioredis"
  - "Named import { Redis } from ioredis for ESM compatibility with NodeNext module resolution"
  - "Server startup sequence: connectDatabase -> Redis ping -> initializeSchedulers -> listen"

patterns-established:
  - "Exponential backoff retry: base 1s, max 30s, max 10 attempts for database connections"
  - "Plain config objects for BullMQ connections (avoids ioredis version conflicts)"
  - "Barrel export pattern for models (import models/index.ts triggers all model registrations)"
  - "upsertJobScheduler for recurring jobs (idempotent, replaces deprecated repeat API)"
  - "Graceful shutdown: close workers -> close queues -> disconnect Mongoose -> close Redis"

requirements-completed: [INFR-03]

# Metrics
duration: 5min
completed: 2026-02-17
---

# Phase 1 Plan 2: Database, Models, and Job Queues Summary

**MongoDB/Redis connections with 9 Mongoose models (compound indexes + TTL), 5 BullMQ queues with upsertJobScheduler, and graceful shutdown wiring**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-17T13:48:34Z
- **Completed:** 2026-02-17T13:54:18Z
- **Tasks:** 2
- **Files modified:** 16

## Accomplishments
- MongoDB connection with exponential backoff retry established and verified (reconnects after container restart)
- Redis connection verified with PONG, noeviction policy confirmed
- All 9 Mongoose models registered with TypeScript interfaces, compound indexes, TTL indexes, and unique constraints
- 5 BullMQ queues and workers active -- jobs are being enqueued and processed by schedulers immediately on startup
- Server startup orchestrated: database first, Redis second, schedulers third, listen last
- Graceful shutdown handler covers all infrastructure connections on SIGTERM/SIGINT

## Task Commits

Each task was committed atomically:

1. **Task 1: MongoDB connection, Redis connection, and all Mongoose models** - `8b9dab0` (feat)
2. **Task 2: BullMQ queues, workers, and job schedulers** - `75dc462` (feat)

## Files Created/Modified
- `backend/src/config/database.ts` - Mongoose connection with exponential backoff retry (max 10 retries)
- `backend/src/config/redis.ts` - BullMQ connection config factories and general-purpose ioredis client
- `backend/src/models/User.ts` - User model with email unique, microsoftId sparse unique indexes
- `backend/src/models/Mailbox.ts` - Mailbox model with userId+email compound unique index, deltaLinks Map
- `backend/src/models/EmailEvent.ts` - EmailEvent model with 4 indexes including 90-day TTL and dedup unique
- `backend/src/models/Pattern.ts` - Pattern model with evidence array validation (max 10), cooldown sparse index
- `backend/src/models/Rule.ts` - Rule model with graphRuleId sparse index, actions array
- `backend/src/models/StagedEmail.ts` - StagedEmail model with TTL at exact expiresAt date
- `backend/src/models/AuditLog.ts` - AuditLog model with Schema.Types.Mixed details field
- `backend/src/models/Notification.ts` - Notification model with 30-day TTL, relatedEntity subdoc
- `backend/src/models/WebhookSubscription.ts` - WebhookSubscription model with subscriptionId unique index
- `backend/src/models/index.ts` - Barrel export for all 9 models and their TypeScript interfaces
- `backend/src/jobs/queues.ts` - 5 BullMQ queues and workers with placeholder processors
- `backend/src/jobs/schedulers.ts` - 5 upsertJobScheduler calls with cron/interval patterns
- `backend/package.json` - Added mongoose@8, ioredis@5, bullmq@5 dependencies
- `backend/src/server.ts` - Startup sequence, graceful shutdown, model registration, health endpoint with live status

## Decisions Made
- **Plain config objects for BullMQ connections:** BullMQ bundles its own ioredis, creating type incompatibility when passing external ioredis instances. Solution: pass `{ host, port, ... }` config objects instead of Redis class instances. BullMQ creates its own connections internally.
- **Named import `{ Redis }` from ioredis:** Default import (`import Redis from 'ioredis'`) doesn't work with ESM + NodeNext module resolution. Named import resolves correctly.
- **Startup ordering:** Database connection must complete before schedulers initialize (schedulers write to Redis which requires connection). Express listen is last to avoid accepting requests before infrastructure is ready.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ioredis ESM import incompatibility**
- **Found during:** Task 1 (Redis connection config)
- **Issue:** `import Redis from 'ioredis'` fails with TypeScript NodeNext module resolution -- `Redis` is a namespace, not a type
- **Fix:** Changed to `import { Redis } from 'ioredis'` (named import)
- **Files modified:** backend/src/config/redis.ts
- **Verification:** `tsc --noEmit` passes
- **Committed in:** 8b9dab0 (Task 1 commit)

**2. [Rule 1 - Bug] BullMQ/ioredis version mismatch type error**
- **Found during:** Task 2 (Queue creation)
- **Issue:** BullMQ bundles its own ioredis with different internal types. Passing project's ioredis Redis instances to BullMQ Queue/Worker constructors causes TypeScript errors (incompatible `AbstractConnector` types)
- **Fix:** Refactored redis.ts to export plain config objects (`getQueueConnectionConfig`, `getWorkerConnectionConfig`) instead of Redis instances. BullMQ creates its own connections from these configs.
- **Files modified:** backend/src/config/redis.ts, backend/src/jobs/queues.ts
- **Verification:** `tsc --noEmit` passes, all queues initialize and process jobs in Docker
- **Committed in:** 75dc462 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both auto-fixes necessary for TypeScript compilation. No scope creep. The plain config object approach is actually cleaner than the original plan's connection factory pattern.

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required
None - no external service configuration required for this plan.

## Next Phase Readiness
- All 9 Mongoose models ready for Phase 2 auth (User model can store encrypted tokens and MSAL cache)
- BullMQ infrastructure ready for Phase 3 observation (delta-sync, webhook-renewal queues active)
- Health endpoint now reports live MongoDB/Redis status (foundation for Plan 03 health hardening)
- Graceful shutdown ensures clean container stops during development
- Azure AD app registration still needed before Phase 2 can begin (blocker from STATE.md)

## Self-Check: PASSED

- All 14 created files verified present on disk
- Both task commits (8b9dab0, 75dc462) verified in git history
- Summary file verified at expected path

---
*Phase: 01-infrastructure-foundation*
*Completed: 2026-02-17*
