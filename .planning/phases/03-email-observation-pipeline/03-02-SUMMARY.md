---
phase: 03-email-observation-pipeline
plan: 02
subsystem: api
tags: [graph-api, bullmq, webhook, metadata-extraction, email-events, mongodb, deduplication]

# Dependency graph
requires:
  - phase: 03-01
    provides: "Graph client (graphFetch), webhook handler, subscription service, BullMQ queue infrastructure"
  - phase: 02-02
    provides: "Token manager (getAccessTokenForMailbox), MSAL cache persistence"
  - phase: 01-02
    provides: "BullMQ queues, Redis connection configs, processorMap pattern"
  - phase: 01-03
    provides: "Graph API SELECT_FIELDS and buildSelectParam utility"
provides:
  - "metadataExtractor.ts: Extract metadata from Graph messages into EmailEvent shape"
  - "eventCollector.ts: Process change notifications into deduplicated EmailEvent documents"
  - "webhookEvents.ts: BullMQ processor for webhook-events queue"
  - "Move detection via parentFolderId comparison"
  - "Newsletter/automated email detection via internet message headers"
affects: [03-03, 04-email-dashboard, 05-pattern-intelligence]

# Tech tracking
tech-stack:
  added: []
  patterns: [change-notification-processing, metadata-extraction-without-body, deduplication-via-unique-index, prior-event-lookup-for-deleted-messages]

key-files:
  created:
    - backend/src/services/metadataExtractor.ts
    - backend/src/services/eventCollector.ts
    - backend/src/jobs/processors/webhookEvents.ts
  modified:
    - backend/src/jobs/queues.ts
    - backend/src/routes/webhooks.ts

key-decisions:
  - "Copy metadata from prior events for deleted message notifications (message already gone from Graph)"
  - "Detect moves via parentFolderId comparison against most recent EmailEvent.toFolder"
  - "Newsletter detection heuristic: presence of List-Unsubscribe header"
  - "Flag detection uses EmailEvent query (no prior flagged event) rather than stored flag field"

patterns-established:
  - "Prior event lookup: query most recent EmailEvent for a messageId to detect state changes"
  - "Sparse event recording: deleted events stored even without metadata (messageId + eventType minimum)"
  - "Fire-and-forget updates: lastNotificationAt update is non-blocking (.catch for error logging)"

requirements-completed: [OBSV-03, OBSV-04]

# Metrics
duration: 3min
completed: 2026-02-17
---

# Phase 3 Plan 2: Event Processing Pipeline Summary

**Webhook notifications processed into deduplicated EmailEvent documents with metadata extraction, move detection via parentFolderId comparison, and newsletter/automated email detection from internet message headers**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-17T17:17:43Z
- **Completed:** 2026-02-17T17:21:05Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Metadata extractor converts Graph message objects to EmailEvent-compatible data without ever touching body content
- Event collector handles all three change types (created/updated/deleted) with move detection, read/flag/category change detection, and duplicate rejection
- Webhook events BullMQ processor wired into queues -- no more placeholder for webhook-events queue
- Ad-hoc jobs from webhook handler now include retry options (3 attempts, exponential backoff)

## Task Commits

Each task was committed atomically:

1. **Task 1: Metadata extractor and event collector services** - `a4e21d7` (feat)
2. **Task 2: Webhook events BullMQ processor** - `f4f0510` (feat)

**Plan metadata:** pending (docs: complete plan)

## Files Created/Modified
- `backend/src/services/metadataExtractor.ts` - Extracts sender, subject, folder, timestamps, newsletter indicators from Graph messages (never body)
- `backend/src/services/eventCollector.ts` - Processes change notifications into deduplicated EmailEvent documents with move/read/flag/category detection
- `backend/src/jobs/processors/webhookEvents.ts` - BullMQ processor that delegates to processChangeNotification
- `backend/src/jobs/queues.ts` - Replaced webhook-events placeholder with real processWebhookEvent processor
- `backend/src/routes/webhooks.ts` - Added retry options to ad-hoc queue.add() calls for webhook-events and webhook-renewal

## Decisions Made
- **Copy metadata from prior events for deleted messages:** When a message is deleted, Graph no longer has the message. The collector looks up the most recent EmailEvent for that messageId and copies metadata (sender, subject, etc.) from it. If no prior event exists, the deleted event is stored with minimal data (messageId + eventType only).
- **Move detection via parentFolderId comparison:** Updated notifications fetch the message from Graph and compare parentFolderId against the most recent EmailEvent's toFolder. If different, a 'moved' event is created with fromFolder/toFolder.
- **Newsletter detection heuristic:** Emails with a List-Unsubscribe header are classified as newsletters. This is a simple but effective heuristic that covers most subscription emails.
- **Flag detection via event query:** Since EmailEvent does not store a flag status field, flagged detection queries for any existing 'flagged' event for the messageId to avoid duplicates.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Full event processing pipeline operational: webhook notifications flow through BullMQ into EmailEvent documents
- Ready for 03-03 (delta sync) which provides the complementary catch-up mechanism for missed notifications
- Pattern intelligence engine (Phase 5) can query EmailEvent documents for behavior analysis
- Remaining placeholder processors: delta-sync, pattern-analysis, staging-processor

## Self-Check: PASSED

- [x] backend/src/services/metadataExtractor.ts exists
- [x] backend/src/services/eventCollector.ts exists
- [x] backend/src/jobs/processors/webhookEvents.ts exists
- [x] Commit a4e21d7 exists (Task 1)
- [x] Commit f4f0510 exists (Task 2)
- [x] TypeScript compiles cleanly (npx tsc --noEmit)

---
*Phase: 03-email-observation-pipeline*
*Completed: 2026-02-17*
