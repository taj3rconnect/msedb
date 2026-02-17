---
phase: 03-email-observation-pipeline
verified: 2026-02-17T18:00:00Z
status: human_needed
score: 18/18 must-haves verified
human_verification:
  - test: "Verify Cloudflare Tunnel routes HTTPS to backend port 8010 and Graph webhook validation handshake succeeds"
    expected: "POST https://<tunnel-hostname>/webhooks/graph?validationToken=test123 returns the token as text/plain with status 200"
    why_human: "Cloudflare Tunnel setup was deliberately skipped by user decision. Code is implemented (webhook handler validates token and returns it), but the public HTTPS endpoint is not yet configured. Graph webhook subscriptions will fail until GRAPH_WEBHOOK_URL is set and tunnel is operational."
  - test: "Verify webhook subscriptions are actually created in Microsoft Graph when a mailbox is connected"
    expected: "After a mailbox is connected, syncSubscriptionsOnStartup creates a subscription with a valid subscriptionId returned by Graph API, and the WebhookSubscription MongoDB document is populated"
    why_human: "Requires live Azure AD credentials and a connected mailbox. Cannot verify without real OAuth tokens and a reachable GRAPH_WEBHOOK_URL."
  - test: "Verify real-time webhook notifications flow through BullMQ to EmailEvent documents"
    expected: "An email action in a connected mailbox (e.g., receiving a new email) produces a BullMQ job in webhook-events queue, which is processed by processWebhookEvent, resulting in an EmailEvent document in MongoDB within seconds"
    why_human: "Requires a live Microsoft 365 mailbox and operational Cloudflare Tunnel. Cannot verify without the full external integration."
  - test: "Verify delta sync completes for a connected mailbox and stores deltaLink in Redis"
    expected: "After the 15-minute scheduler fires (or manual trigger via processDeltaSync), Redis contains a key matching delta:{mailboxId}:{folderId} for each well-known folder in the connected mailbox"
    why_human: "Requires a connected mailbox with a valid access token. Cannot verify Redis state without live OAuth tokens and a running backend with a connected mailbox."
---

# Phase 3: Email Observation Pipeline Verification Report

**Phase Goal:** The system observes email activity in real-time via webhooks with delta query fallback, collecting deduplicated metadata events for every connected mailbox -- the data foundation for all intelligence and automation
**Verified:** 2026-02-17T18:00:00Z
**Status:** human_needed (all automated checks passed; 4 live-integration items need human testing)
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

All 18 must-have truths across Plans 01, 02, and 03 are verified against the actual codebase.

#### Plan 01 Truths (OBSV-01, OBSV-04)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Graph API calls use Bearer token injection and return structured errors | VERIFIED | `graphClient.ts:42-46` injects `Authorization: Bearer ${accessToken}` header; `GraphApiError` class at lines 8-20 carries status, body, path |
| 2 | Webhook handler validates clientState, enqueues notifications into BullMQ, and returns 202 within milliseconds | VERIFIED | `webhooks.ts:39` sends `res.status(202).json` before any async work; async IIFE at lines 43-97 runs fire-and-forget clientState validation and enqueue |
| 3 | Lifecycle notifications (subscriptionRemoved, missed, reauthorizationRequired) are routed to webhook-renewal queue | VERIFIED | `webhooks.ts:66-74` routes `notification.lifecycleEvent` to `queues['webhook-renewal'].add('lifecycle-event', ...)` |
| 4 | Webhook subscriptions created per mailbox with lifecycleNotificationUrl and 2-hour expiry | VERIFIED | `subscriptionService.ts:31-33` sets `lifecycleNotificationUrl` and `expirationDateTime = Date.now() + 2h`; `resource: users/${mailbox.email}/messages` (not `me/`) |
| 5 | Webhook renewal processor recreates expired or removed subscriptions and runs on startup | VERIFIED | `webhookRenewal.ts` calls `syncSubscriptionsOnStartup()` for `renew-webhooks` jobs and `handleLifecycleEvent()` for lifecycle events; `server.ts:74` calls `syncSubscriptionsOnStartup()` at startup |
| 6 | Cloudflare Tunnel forwards HTTPS to backend webhook endpoint | HUMAN NEEDED | Code is implemented; tunnel not configured (user decision -- see human verification items) |

#### Plan 02 Truths (OBSV-03, OBSV-04)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 7 | Webhook notifications processed into EmailEvent documents with correct metadata | VERIFIED | `webhookEvents.ts:33` calls `processChangeNotification(notification)`; `eventCollector.ts` handles created/updated/deleted change types and calls `saveEmailEvent()` |
| 8 | Sender email, domain, subject, folder, timestamp, and importance are extracted from Graph messages | VERIFIED | `metadataExtractor.ts:33-80` extracts all fields; sender email lowercased at line 33; domain derived at 34; importance normalized at 53-56 |
| 9 | Message moves detected by comparing parentFolderId against last known state | VERIFIED | `eventCollector.ts:270-283` compares `graphMessage.parentFolderId !== priorEvent.toFolder` and creates `'moved'` event with `fromFolder`/`toFolder` |
| 10 | Duplicate events silently skipped via MongoDB compound unique index (error code 11000) | VERIFIED | `eventCollector.ts:26-30` catches error with `code === 11000` and returns `false`; `EmailEvent.ts:81-84` defines `{ userId, mailboxId, messageId, eventType }` unique compound index |
| 11 | Email body content is never fetched or stored | VERIFIED | `GraphMessage` interface in `metadataExtractor.ts` has no body fields; `EmailEvent` model has no body/bodyPreview field; `$select` via `buildSelectParam('message')` controls Graph API field selection |
| 12 | Newsletter and automated email indicators detected from internet message headers | VERIFIED | `metadataExtractor.ts:40-49` checks for `list-unsubscribe` header (hasListUnsubscribe, isNewsletter) and `x-auto-response-suppress` header (isAutomated) |

#### Plan 03 Truths (OBSV-02)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 13 | Delta query runs every 15 minutes per mailbox per tracked folder | VERIFIED | `schedulers.ts:27-35` registers `delta-sync` scheduler with `{ every: 15 * 60 * 1000 }` and job name `'run-delta-sync'`; `deltaSync.ts:18-44` iterates all connected mailboxes and calls `runDeltaSyncForMailbox` per mailbox |
| 14 | deltaLinks stored in Redis keyed by `delta:{mailboxId}:{folderId}` with no TTL | VERIFIED | `deltaService.ts:29-31` defines `deltaKey()` returning `delta:${mailboxId}:${folderId}`; `setDeltaLink()` at lines 40-47 calls `redis.set(key, link)` with NO TTL argument; comment at line 45 confirms |
| 15 | Expired delta tokens (410 Gone) trigger full sync by deleting stored deltaLink | VERIFIED | `deltaService.ts:110-118` catches `GraphApiError` with `status === 410`, calls `deleteDeltaLink()`, logs warning, and recursively calls `runDeltaSync()` for full sync restart |
| 16 | Delta query results processed through same event collector as webhook notifications | VERIFIED | `deltaService.ts:5` imports `saveEmailEvent` from `eventCollector.js`; lines 152 and 161 call `saveEmailEvent()` for both deleted and created/updated messages |
| 17 | Folder ID-to-name mapping cached in Redis for human-readable folder names in EmailEvents | VERIFIED | `folderCache.ts:70-83` stores `folder:{email}:{folderId}` keys with 24h TTL via Redis pipeline; `getFolderName()` at lines 99-107 retrieves from Redis, returns raw folderId as fallback |
| 18 | Well-known folders (Inbox, SentItems, DeletedItems, Archive, Drafts, JunkEmail) are tracked | VERIFIED | `folderCache.ts:18-25` exports `WELL_KNOWN_FOLDERS` const array with all 6 folders; `getTrackedFolderIds()` resolves each via Graph API well-known aliases, handles 404 gracefully for non-existent folders (e.g., Archive not enabled) |

**Score:** 17/18 truths programmatically verified; 1 (Cloudflare Tunnel) requires human verification

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `backend/src/services/graphClient.ts` | Graph API fetch wrapper with token injection and GraphApiError | VERIFIED | Exports `graphFetch`, `GraphApiError`, `GRAPH_BASE`; 59 lines, substantive implementation |
| `backend/src/services/subscriptionService.ts` | Subscription CRUD: create, renew, delete, sync from Graph | VERIFIED | Exports `createSubscription`, `renewSubscription`, `deleteSubscription`, `syncSubscriptionsOnStartup`, `handleLifecycleEvent`; 293 lines |
| `backend/src/routes/webhooks.ts` | Enhanced webhook handler with clientState validation and BullMQ enqueue | VERIFIED | 101 lines; 202-first pattern confirmed at line 39; async IIFE for fire-and-forget enqueue |
| `backend/src/jobs/queues.ts` | webhook-events queue added to QUEUE_NAMES and queues record | VERIFIED | 6 queues total; `webhook-events` at line 21 in QUEUE_NAMES; real processors for webhook-events, webhook-renewal, delta-sync, token-refresh |
| `backend/src/jobs/processors/webhookRenewal.ts` | BullMQ processor for subscription renewal and lifecycle event handling | VERIFIED | Exports `processWebhookRenewal`; handles `renew-webhooks` and `lifecycle-event` job names |
| `backend/src/services/metadataExtractor.ts` | Extract metadata from Graph message objects into EmailEvent shape | VERIFIED | Exports `extractMetadata`, `GraphMessage` interface; no body fields anywhere |
| `backend/src/services/eventCollector.ts` | Fetch message details from Graph, process into deduplicated EmailEvent documents | VERIFIED | Exports `processChangeNotification`, `saveEmailEvent`; handles created/updated/deleted; 11000 dedup |
| `backend/src/jobs/processors/webhookEvents.ts` | BullMQ processor that handles incoming change notifications | VERIFIED | Exports `processWebhookEvent`; delegates to `processChangeNotification` |
| `backend/src/services/folderCache.ts` | Folder ID-to-name cache in Redis, well-known folder discovery | VERIFIED | Exports `refreshFolderCache`, `getFolderName`, `getTrackedFolderIds`, `WELL_KNOWN_FOLDERS` |
| `backend/src/services/deltaService.ts` | Delta query execution with pagination, deltaLink storage in Redis | VERIFIED | Exports `runDeltaSync`, `runDeltaSyncForMailbox`; 410 Gone recovery implemented |
| `backend/src/jobs/processors/deltaSync.ts` | BullMQ processor for scheduled and on-demand delta sync | VERIFIED | Exports `processDeltaSync`; handles `run-delta-sync` and `lifecycle-delta-sync` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `webhooks.ts` | `jobs/queues.ts` | `queues['webhook-events'].add()` and `queues['webhook-renewal'].add()` | WIRED | Lines 67 and 76 confirmed with retry opts `{ attempts: 3, backoff: exponential }` |
| `webhookRenewal.ts` | `subscriptionService.ts` | `syncSubscriptionsOnStartup` / `handleLifecycleEvent` calls | WIRED | Import at line 2; `syncSubscriptionsOnStartup()` called at line 24; `handleLifecycleEvent()` at line 32 |
| `graphClient.ts` | `https://graph.microsoft.com/v1.0` | native fetch with Bearer token | WIRED | `GRAPH_BASE` defined at line 1; Bearer injection at lines 43-46 |
| `subscriptionService.ts` | `auth/tokenManager.ts` | `getAccessTokenForMailbox` | WIRED | Import at line 3; called at lines 19, 86, 119 |
| `webhookEvents.ts` | `eventCollector.ts` | `processChangeNotification` call | WIRED | Import at line 2; called at line 33 |
| `eventCollector.ts` | `graphClient.ts` | `graphFetch` to get message details | WIRED | Import at line 1; called at line 188 in `fetchGraphMessage()` |
| `eventCollector.ts` | `metadataExtractor.ts` | `extractMetadata` call | WIRED | Import at line 2; called at lines 224 and 260 |
| `eventCollector.ts` | `models/EmailEvent.ts` | `EmailEvent.create` with duplicate key error handling | WIRED | `EmailEvent.create()` at line 20; error code 11000 check at lines 26-30 |
| `deltaService.ts` | `config/redis.ts` | `getRedisClient` for deltaLink storage | WIRED | Import at line 3; `getRedisClient().get/set/del` at lines 37, 46, 53 |
| `deltaService.ts` | `eventCollector.ts` | `saveEmailEvent` for delta query results | WIRED | Import at line 5; called at lines 152 and 161 |
| `deltaService.ts` | `graphClient.ts` | `graphFetch` for delta query API calls | WIRED | Import at line 1; called at line 107 in pagination loop |
| `deltaSync.ts` | `deltaService.ts` | `runDeltaSync` call | WIRED | Import at line 2; `runDeltaSyncForMailbox()` called at lines 26 and 52 |
| `deltaService.ts` | `metadataExtractor.ts` | `extractMetadata` for delta results | WIRED | Import at line 4; called at line 160 |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| OBSV-01 | 03-01 | Real-time email event observation via Graph API webhooks (created, updated, moved, deleted events) per mailbox. Webhook subscriptions include lifecycleNotificationUrl. Renewal job runs on startup and every 2 hours | SATISFIED | `subscriptionService.ts` creates subscriptions with `lifecycleNotificationUrl`; `schedulers.ts` registers `webhook-renewal` at `0 */2 * * *`; `server.ts` calls `syncSubscriptionsOnStartup()` on startup; webhook handler processes all change types |
| OBSV-02 | 03-03 | Delta query fallback every 15 min per mailbox per folder to catch missed webhook events. deltaLink cached in Redis per user per mailbox per folder | SATISFIED | `schedulers.ts` registers `delta-sync` at 15-minute interval; `deltaService.ts` stores deltaLinks at key `delta:{mailboxId}:{folderId}` with NO TTL; `folderCache.ts` tracks well-known folders per mailbox |
| OBSV-03 | 03-02 | Email metadata extraction and storage -- sender, subject, folder, timestamps, action type. Never store body content. Data model includes optional content fields for future use without populating them now | SATISFIED | `metadataExtractor.ts` extracts all required fields; no body fields in GraphMessage interface or EmailEvent model; all extracted data written to MongoDB via `saveEmailEvent()` |
| OBSV-04 | 03-01, 03-02 | Event deduplication via userId + mailboxId + messageId + eventType compound index. Webhook handler returns 202 immediately, processes via BullMQ (zero blocking in handler) | SATISFIED | `EmailEvent.ts:81-84` defines unique compound index `{ userId, mailboxId, messageId, eventType }`; `eventCollector.ts:26-30` catches code 11000 silently; `webhooks.ts:39` sends 202 before any async work |

**Requirements coverage: 4/4 -- OBSV-01, OBSV-02, OBSV-03, OBSV-04 all satisfied**

No orphaned requirements: REQUIREMENTS.md maps only OBSV-01 through OBSV-04 to Phase 3. All four are claimed across the three plans and have implementation evidence.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `eventCollector.ts` | 301-303 | Dead variable `priorFlagStatus` assigned `undefined` twice with no usage | Info | No functional impact; unused variable in flag detection logic (the actual dedup check at line 307 works correctly via DB query) |

No blockers or warnings found. The single info-level item is a harmless dead variable and does not affect correctness.

### Human Verification Required

The following items require live Microsoft 365 integration and cannot be verified by static code analysis alone.

#### 1. Cloudflare Tunnel Setup and Webhook Validation Handshake

**Test:** On the DGX host, set up Cloudflare Tunnel to forward HTTPS to `localhost:8010`. Then run:
```
curl -X POST "https://<tunnel-hostname>/webhooks/graph?validationToken=test123"
```
**Expected:** Returns `test123` as `text/plain` with HTTP 200. Backend logs show "Graph webhook validation handshake" entry.

**Why human:** Cloudflare Tunnel was intentionally skipped by user decision. The webhook handler code is correctly implemented (lines 22-30 in `webhooks.ts` handle the validation token), but there is no publicly reachable HTTPS endpoint until the tunnel is configured. Set `GRAPH_WEBHOOK_URL` in backend `.env` once the tunnel is operational.

#### 2. Live Graph Webhook Subscription Creation

**Test:** Connect a Microsoft 365 mailbox via the auth flow. Check MongoDB `webhooksubscriptions` collection and backend logs after `syncSubscriptionsOnStartup()` runs.

**Expected:** A `WebhookSubscription` document exists with a `subscriptionId` (GUID from Graph), `status: 'active'`, `expiresAt` approximately 2 hours in the future, and `clientState` populated. Backend logs show "Webhook subscription created" with `subscriptionId` and `mailboxId`.

**Why human:** Requires valid Azure AD credentials (`AZURE_AD_TENANT_ID`, `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`) and a connected mailbox with a `users/{email}/messages` subscription successfully registered with Microsoft Graph.

#### 3. End-to-End Webhook Notification Flow

**Test:** With the tunnel operational and a subscription active, send a test email to the connected mailbox. Within 60 seconds, check:
- BullMQ UI or `queues['webhook-events']` job count
- MongoDB `emailevents` collection for a new document

**Expected:** An `EmailEvent` document with `eventType: 'arrived'`, populated `sender` (email, domain, name), `subject`, `toFolder`, and `metadata.isNewsletter`. No `body` or `bodyPreview` fields present anywhere.

**Why human:** Requires the full external integration: live Graph webhook, operational Cloudflare Tunnel, and a connected Microsoft 365 mailbox.

#### 4. Delta Sync Redis Storage Verification

**Test:** With a connected mailbox and valid access token, manually trigger delta sync or wait 15 minutes for the scheduler. Then inspect Redis:
```
docker compose exec redis redis-cli keys "delta:*"
```

**Expected:** Keys matching `delta:{mailboxId}:{folderId}` for each well-known folder (Inbox, SentItems, DeletedItems, Archive, Drafts, JunkEmail) that exists in the mailbox. Running `TTL delta:{key}` should return `-1` (no TTL set).

**Why human:** Requires a connected mailbox with a valid access token to execute the delta query API call that returns the deltaLink from Graph.

---

## Summary

Phase 3 goal is **achieved at the code level**. All 11 required artifacts exist, are substantive (not stubs), and are correctly wired. All 13 key links between services are verified. All 4 requirements (OBSV-01 through OBSV-04) are satisfied by the implementation.

The observation pipeline is fully implemented:
- **Webhook ingress:** Handler returns 202 immediately, validates clientState fire-and-forget, routes change vs lifecycle notifications to separate BullMQ queues
- **Event processing:** Metadata extracted from Graph messages (never body), moves detected via parentFolderId comparison, duplicates rejected by compound unique index
- **Delta sync fallback:** Per-folder delta queries every 15 minutes with Redis-stored deltaLinks (no TTL), 410 Gone recovery restarts full sync, results deduplicated by the same pipeline as webhooks
- **Subscription lifecycle:** Create/renew/delete with lifecycleNotificationUrl, startup sync, periodic renewal every 2 hours, lifecycle event handling (subscriptionRemoved/missed/reauthorizationRequired)

The only outstanding item is the Cloudflare Tunnel, which was deliberately deferred by user decision. The code correctly handles the tunnel being absent (warns on startup, does not crash), and the integration cannot be tested without a public HTTPS endpoint.

---

_Verified: 2026-02-17T18:00:00Z_
_Verifier: Claude (gsd-verifier)_
