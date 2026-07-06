# MSEDB Scalability & Reliability Review

Reviewer pass over the backend (Express 5 + TS, MongoDB, Redis, BullMQ, MS Graph). Evidence cited as `file:line`. Scope: Graph API usage, webhook lifecycle, BullMQ design, data volume, single-process bottlenecks, bulk operations.

## Current Design Summary

- **Graph client**: single `graphFetch()` wrapper (`backend/src/services/graphClient.ts`) used by every service — token injection, 30s timeout, one 429 retry with `Retry-After`, and a process-wide concurrency semaphore.
- **Sync model**: MS Graph webhooks (`/webhooks/graph`) push near-real-time change notifications into a `webhook-events` queue; a 15-minute `delta-sync` scheduler job sweeps every connected mailbox as a safety net; a 2-hour webhook subscription is kept alive by a `webhook-renewal` scheduler and by lifecycle notifications (`subscriptionRemoved`, `missed`, `reauthorizationRequired`).
- **Job queues**: 12 BullMQ queues (`backend/src/jobs/queues.ts`), each with exactly one `Worker` and no `concurrency` option set.
- **Data model**: `EmailEvent` has a 90-day TTL index and a compound unique index for dedup (`backend/src/models/EmailEvent.ts:83-88`). `AuditLog` (180-day TTL) and `StagedEmail` (TTL via `cleanupAt`) are similarly bounded. `WebhookSubscription` has no TTL.
- **Real time**: Socket.IO is co-hosted on the same Express process (`backend/src/config/socket.ts`), using in-memory rooms only (no Redis adapter).

## Bottlenecks & Failure Points

### 1. Every BullMQ worker runs at concurrency 1 — HIGH
`backend/src/jobs/queues.ts:114-117`: `new Worker(name, processorMap[name], { connection: workerConnectionConfig })` — no `concurrency` passed, so BullMQ defaults to 1 job in flight per queue, for all 12 queues (`webhook-events` included).

What breaks at scale: every Graph-API-bound webhook notification (`processWebhookEvent` → `processChangeNotification`, `backend/src/jobs/processors/webhookEvents.ts:16`, `backend/src/services/eventCollector.ts:76`) is processed **one at a time, system-wide**, regardless of how many of the 50 mailboxes are generating traffic concurrently. Each notification does a Graph fetch + rule evaluation + possible action-execution Graph call + Mongo writes (likely 300ms-1s wall time). At even a modest combined arrival rate (a few notifications/sec across 50 mailboxes during business hours), the queue backs up indefinitely and webhook-to-dashboard latency grows unbounded. Same ceiling applies to `email-embedding` and `body-prefetch` (one embedding/prefetch in flight for the whole deployment).

### 2. Scheduled sync jobs iterate all mailboxes serially inside one job — HIGH
- `backend/src/jobs/processors/deltaSync.ts:17-37` (`run-delta-sync`, every 15 min via `backend/src/jobs/schedulers.ts:27-36`)
- `backend/src/jobs/processors/patternAnalysis.ts:18-51` (daily)
- `backend/src/jobs/processors/tokenRefresh.ts:50-102` (every 45 min)
- `backend/src/jobs/processors/contactsSync.ts:83-108` (daily)

Each is a single BullMQ job that does `Mailbox.find({isConnected:true})` then a `for` loop `await`-ing one mailbox at a time — no `Promise.all`/chunking. Delta sync additionally iterates **all folders per mailbox** serially (`backend/src/services/deltaService.ts:328-346`, folder list from `getAllCachedFolderIds`, `backend/src/services/folderCache.ts:170-177`). With 50 mailboxes × ~15-30 folders each, that's 750-1500 sequential Graph round-trips inside one 15-minute job. The `graphConcurrency` semaphore in `graphClient.ts:55` (limit 2) is never exploited because the calling code awaits each folder/mailbox in turn — concurrency infrastructure exists but isn't used by the callers that would benefit most.

What breaks at scale: if one cycle takes longer than 15 minutes (very plausible at 500k-message-scale mailboxes or 50 users), the next scheduled job just queues behind it (worker concurrency 1, see #1) — sync interval silently drifts, and mailboxes late in iteration order fall further behind each cycle. A single slow/hanging mailbox also delays every mailbox after it in the loop (errors are caught per-mailbox so it doesn't crash, but it doesn't skip ahead in parallel either).

### 3. Graph API retry/backoff is minimal — MEDIUM
`backend/src/services/graphClient.ts:106-117`: only handles `429`, retries exactly once, waits `min(Retry-After, 30s)`. No retry for `503`/`504`/network errors, no exponential backoff/jitter across attempts, and a second `429` on the retry is not handled (throws `GraphApiError` and propagates to the caller/BullMQ's own `attempts` — which most call sites don't set, e.g. `runDeltaSyncForMailbox`, `processTokenRefresh` have no BullMQ `attempts` configured beyond the scheduler-level 3 retries with 5s backoff in `backend/src/jobs/schedulers.ts:4-7`, which only applies to the schedule-triggering job itself, not the ad-hoc jobs like `lifecycle-delta-sync` added via `queues['delta-sync'].add('lifecycle-delta-sync', {mailboxId})` in `subscriptionService.ts:250/257` with no `attempts`/`backoff` opts at all).

What breaks at scale: transient 503s or brief Graph outages during high-traffic windows cause a whole delta-sync/token-refresh cycle to log-and-move-on rather than retry with backoff, silently degrading sync freshness instead of recovering.

### 4. No `$batch` usage anywhere — MEDIUM
Grep across `backend/src/services` and `backend/src/jobs` finds no `/$batch` calls. Every folder discovery, delta page, contact page, and per-message action (move/markRead/categorize/flag/forward in `backend/src/services/actionExecutor.ts`) is its own HTTP round trip. Graph's `$batch` endpoint allows up to 20 requests per call.

What breaks at scale: for a mailbox with many folders or a rule that fires many single-message actions in a burst, request count (and therefore 429 risk + wall-clock time) scales linearly with item count instead of being batched down by ~20x.

### 5. Webhook notifications are not deduplicated at the queue level — MEDIUM
`backend/src/routes/webhooks.ts:76-79`: `queues['webhook-events'].add('change-notification', {...}, {attempts:3, backoff:...})` — no `jobId`. Microsoft Graph's documented behavior is that notifications **can be delivered more than once**; only `body-prefetch` jobs use a deterministic `jobId` (`` `body:${mailboxId}:${msg.id}` ``, e.g. `backend/src/services/deltaService.ts:220`, `actionExecutor` fire-and-forget in `eventCollector.ts:295`) to dedup. `webhook-events` and `email-embedding` jobs have no such guard.

What breaks at scale: duplicate Graph notifications double the load on the already concurrency-1 `webhook-events` worker (finding #1) and re-run rule evaluation/action-execution twice for the same message (mitigated for storage by the unique index in `EmailEvent`, `eventCollector.ts:22-56`, but not mitigated for the Graph fetch + rule-engine + action Graph calls that happen before that dedup check).

### 6. `WebhookSubscription` collection grows unbounded — MEDIUM
`backend/src/models/WebhookSubscription.ts` has no TTL index (compare `EmailEvent`'s 90-day TTL and `AuditLog`'s 180-day TTL). `createSubscription()` (`backend/src/services/subscriptionService.ts:18-72`) inserts a **new** document every time a subscription needs recreating (lifecycle `subscriptionRemoved`, failed renewal, `reauthorizationRequired` renewal failure) — old rows are only flipped to `status:'expired'`, never deleted. `GET /api/admin/health` (`backend/src/routes/admin.ts:194-200`) does an unfiltered `WebhookSubscription.find()` with two `populate()`s and no `.limit()`.

What breaks at scale: over months of normal churn (token expiry, Graph-side subscription resets), this table accumulates rows indefinitely and the admin health page's unbounded, populated query gets slower every month even though only the ~50 active subscriptions actually matter.

### 7. Contacts cache stores one unbounded JSON blob per mailbox — LOW/MEDIUM
`backend/src/jobs/processors/contactsSync.ts:31-45`: `syncContactsForMailbox` accumulates **all** contacts into one in-memory array (`allContacts.push(...)` across every paginated page) then does one `redis.set(..., JSON.stringify(contacts), ...)` (line 61). No cap on contact count.

What breaks at scale: a mailbox with a very large Contacts folder (shared/synced org contacts can run into the tens of thousands) builds one large in-memory array and one large Redis value read/written whole on every access — not a paged/streamed design. Same "read the whole array" pattern also applies inside `refreshFolderCache`'s `folderMap` (`backend/src/services/folderCache.ts:92`), which is fine for folder counts but is the same shape of unbounded-growth risk if a mailbox has hundreds of folders/subfolders (each one gets a recursive `fetchChildFoldersRecursive` call, `folderCache.ts:43-76`, with no depth or count guard).

### 8. Socket.IO co-hosted, in-memory rooms only — MEDIUM (scale-out blocker)
`backend/src/config/socket.ts:28-33`: `new SocketIOServer(httpServer, {...})` with no Redis/adapter configuration; rooms (`socket.join('user:'+userId)`, `socket.ts:71`) live only in the process's memory, and `io.to('user:'+userId).emit(...)` is called from `saveEmailEvent` (`backend/src/services/eventCollector.ts:32`) and rule-popup delivery (`actionExecutor` caller in `eventCollector.ts:325`).

What breaks at scale: this is fine for a single backend instance (current deployment, per `CLAUDE.md`), but it is a hard blocker to horizontal scaling — running two backend replicas would silently drop real-time events for any user whose socket landed on the other replica than the one that processed their webhook/job. Not an issue today; flag before any move to multiple backend replicas.

### 9. Staging processor is capped at 100 items / 30-minute run — LOW
`backend/src/jobs/processors/stagingProcessor.ts:25-28`: `StagedEmail.find({status:'staged', expiresAt:{$lte:new Date()}}).limit(100)`, processed in chunks of 5 via `Promise.allSettled`.

What breaks at scale: if the rate of newly-staged, expiring items exceeds 100 per 30 minutes (plausible with many active rules across 50 mailboxes), a backlog accumulates that only drains 100 items ahead each cycle — grace-period actions get progressively delayed rather than a bounded worst case.

### 10. Folder-routing pattern detection re-introduces N+1 — LOW
`backend/src/services/patternEngine.ts:631-677`: sender-pattern recency stats are correctly batched into one aggregation (`patternEngine.ts:527-561`, explicitly commented "avoids N+1"), but the folder-routing branch loops over every detected folder pattern and does a `EmailEvent.countDocuments` (line 636) **and** a fresh `getRecencyStats` aggregation (line 646) per iteration, sequentially.

What breaks at scale: for mailboxes with many distinct sender→folder routing patterns, daily pattern-analysis time grows linearly with pattern count instead of being one batched query — compounds with finding #2 (this whole job already runs mailbox-by-mailbox, single job, concurrency 1).

## Recommendations (prioritized)

| # | Recommendation | Addresses | Effort |
|---|---|---|---|
| 1 | Set an explicit `concurrency` (e.g. 5-10) on the `webhook-events`, `email-embedding`, and `body-prefetch` Workers in `queues.ts`; keep 1 for anything that must stay strictly serial (e.g. `token-refresh` if desired). | #1 | S |
| 2 | Parallelize the per-mailbox loops in `deltaSync.ts`, `patternAnalysis.ts`, `tokenRefresh.ts`, `contactsSync.ts` with a bounded `Promise.allSettled` batch (e.g. 5-10 at a time), reusing the existing `graphConcurrency` semaphore pattern instead of a flat `for...await`. | #2 | M |
| 3 | Add a `jobId` (e.g. `` `webhook:${subscriptionId}:${messageId}:${changeType}` ``) when enqueuing `change-notification` jobs so duplicate Graph deliveries are deduped by BullMQ before hitting the worker. | #5 | S |
| 4 | Extend `graphFetch` to retry once on `503`/`504`/network-abort with backoff, and set explicit `attempts`/`backoff` on every `queues[...].add(...)` call site that currently has none (`lifecycle-delta-sync`, scheduled-job bodies). | #3 | S |
| 5 | Add a TTL index to `WebhookSubscription` (e.g. 30-day `expireAfterSeconds` on `updatedAt` for `status != 'active'`) or a daily cleanup job mirroring `scheduled-email-cleanup`; add `.limit()` to the admin `/health` query. | #6 | S |
| 6 | Move to Graph `$batch` for folder discovery and multi-action rule execution where more than ~3 calls would otherwise be issued back-to-back. | #4 | M |
| 7 | Batch the folder-routing recency lookups in `patternEngine.ts` the same way sender-pattern recency already is. | #10 | S |
| 8 | When ready to run more than one backend replica, add `@socket.io/redis-adapter` before doing so — no action needed at current single-instance scale. | #8 | M (deferred) |
| 9 | Raise the staging-processor per-run cap (or run it more often) if telemetry shows the 100-item ceiling is regularly hit; add a metric/log for backlog size (`StagedEmail.countDocuments({status:'staged', expiresAt:{$lte:new Date()}})`) to know if this is actually needed. | #9 | S |
| 10 | Cap contacts-cache size or paginate the Redis value (store contact IDs in a set + individual hashes) instead of one JSON blob if any mailbox is known to exceed a few thousand contacts. | #7 | M |

