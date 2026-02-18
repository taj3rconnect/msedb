---
phase: 03-email-observation-pipeline
plan: 01
subsystem: api
tags: [graph-api, webhooks, bullmq, subscriptions, microsoft-graph]

# Dependency graph
requires:
  - phase: 02-authentication-token-management
    provides: "MSAL token acquisition (getAccessTokenForMailbox), Mailbox model, auth middleware"
  - phase: 01-infrastructure-foundation
    provides: "BullMQ queues, Redis connection, Express server, Mongoose models"
provides:
  - "graphFetch wrapper for all Graph API v1.0 calls with Bearer token injection"
  - "GraphApiError class for structured Graph error handling"
  - "webhook-events BullMQ queue for incoming mail change notifications"
  - "Webhook handler with clientState validation and 202-first pattern"
  - "subscriptionService with full subscription lifecycle (create, renew, delete, sync, lifecycle events)"
  - "webhookRenewal BullMQ processor for scheduled renewal and lifecycle event handling"
  - "Startup subscription sync for all connected mailboxes"
affects: [03-email-observation-pipeline, 04-frontend-dashboard]

# Tech tracking
tech-stack:
  added: [uuid]
  patterns: [graph-api-fetch-wrapper, fire-and-forget-enqueue, subscription-lifecycle-management, 202-first-webhook-pattern]

key-files:
  created:
    - backend/src/services/graphClient.ts
    - backend/src/services/subscriptionService.ts
    - backend/src/jobs/processors/webhookRenewal.ts
  modified:
    - backend/src/routes/webhooks.ts
    - backend/src/jobs/queues.ts
    - backend/src/server.ts

key-decisions:
  - "graphFetch uses native fetch with no retry logic -- BullMQ handles retries at job level"
  - "Webhook handler returns 202 before clientState validation -- enqueue is fire-and-forget after response"
  - "Subscriptions use users/{email}/messages resource path (not me/messages) since background jobs have no user context"
  - "syncSubscriptionsOnStartup runs on server start AND as periodic webhook-renewal job (same logic)"
  - "Cloudflare Tunnel skipped by user -- webhook subscriptions will fail until tunnel is configured"

patterns-established:
  - "Graph API wrapper pattern: graphFetch(path, token, options) with GraphApiError for all Graph calls"
  - "Fire-and-forget webhook pattern: send 202, then async IIFE for clientState validation and BullMQ enqueue"
  - "Subscription lifecycle pattern: create/renew/delete/sync via subscriptionService with lifecycle event handling"

requirements-completed: [OBSV-01, OBSV-04]

# Metrics
duration: 3min
completed: 2026-02-17
---

# Phase 3 Plan 01: Webhook Ingress Summary

**Graph API client with Bearer token injection, webhook handler returning 202-first with fire-and-forget BullMQ enqueue, and subscription lifecycle service with startup sync and automatic renewal**

## Performance

- **Duration:** ~3 min (Tasks 1-2 code execution)
- **Started:** 2026-02-17T17:00:44Z
- **Completed:** 2026-02-17T17:02:10Z
- **Tasks:** 2 completed, 1 skipped (Cloudflare Tunnel checkpoint)
- **Files modified:** 6

## Accomplishments
- Graph API fetch wrapper (graphClient.ts) provides authenticated access to all Graph v1.0 endpoints with structured error handling
- Webhook handler validates clientState and routes change vs lifecycle notifications to separate BullMQ queues after immediately returning 202
- Subscription service manages full webhook subscription lifecycle: create, renew, delete, sync on startup, and lifecycle event handling
- Webhook-renewal BullMQ processor replaces placeholder with real processor handling both scheduled renewal and lifecycle events
- Server startup automatically syncs all mailbox subscriptions (creates missing, renews existing)

## Task Commits

Each task was committed atomically:

1. **Task 1: Graph API client, webhook-events queue, and webhook handler enhancement** - `f27c62f` (feat)
2. **Task 2: Subscription service and webhook-renewal processor** - `5e4dc90` (feat)
3. **Task 3: Verify Cloudflare Tunnel is operational** - Skipped by user decision

## Files Created/Modified
- `backend/src/services/graphClient.ts` - Graph API fetch wrapper with Bearer token, GraphApiError, GRAPH_BASE constant
- `backend/src/services/subscriptionService.ts` - Full subscription lifecycle: create, renew, delete, sync, lifecycle event handling
- `backend/src/jobs/processors/webhookRenewal.ts` - BullMQ processor for scheduled renewal and lifecycle events
- `backend/src/routes/webhooks.ts` - Enhanced: 202-first response, clientState validation, BullMQ enqueue for change/lifecycle notifications
- `backend/src/jobs/queues.ts` - Added webhook-events queue (6 total), wired real webhookRenewal processor
- `backend/src/server.ts` - Added syncSubscriptionsOnStartup() call and GRAPH_WEBHOOK_URL warning

## Decisions Made
- graphFetch uses native fetch with no retry logic -- BullMQ handles retries at the job level, keeping the wrapper thin
- Webhook handler returns 202 before clientState validation -- enqueue is fire-and-forget after response is sent (async IIFE pattern)
- Subscriptions use `users/{email}/messages` resource path instead of `me/messages` since background jobs have no user context
- syncSubscriptionsOnStartup is reused by the periodic webhook-renewal job (same create-or-renew logic)
- Cloudflare Tunnel setup skipped by user -- webhook subscriptions will fail until tunnel is configured later

## Deviations from Plan

None - Tasks 1-2 executed exactly as written. Task 3 (Cloudflare Tunnel checkpoint) was skipped by user decision.

## Issues Encountered

- **Cloudflare Tunnel not configured:** Task 3 was a human-action checkpoint for setting up Cloudflare Tunnel to forward HTTPS to the backend webhook endpoint. The user chose to skip this step. Webhook subscriptions will fail when attempted because Microsoft Graph cannot reach the notification URL without a publicly accessible HTTPS endpoint. This is a known limitation that will need to be resolved before live webhook testing.

## User Setup Required

**Cloudflare Tunnel setup is deferred but required for live webhook functionality.** When ready:
1. Install cloudflared on the host machine
2. Create and configure a tunnel forwarding to localhost:8010
3. Set `GRAPH_WEBHOOK_URL` in backend `.env` to the tunnel hostname
4. Disable Cloudflare Bot Fight Mode or add WAF Skip rule for `/webhooks/graph`
5. Restart backend container

## Next Phase Readiness
- Graph API client ready for all Phase 3 services (delta sync, email observation)
- Webhook ingress pipeline complete: handler -> BullMQ queues -> processors
- Subscription lifecycle management operational (pending tunnel for live testing)
- **Blocker:** Cloudflare Tunnel must be configured before webhook subscriptions can be created with Microsoft Graph

## Self-Check: PASSED

All 6 files verified present on disk. Both task commits (f27c62f, 5e4dc90) verified in git history. SUMMARY.md created successfully.

---
*Phase: 03-email-observation-pipeline*
*Completed: 2026-02-17*
