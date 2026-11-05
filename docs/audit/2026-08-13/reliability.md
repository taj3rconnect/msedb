# Reliability Lens — MSEDB — 2026-08-13

Scope: error handling/swallowing, startup/shutdown behavior, BullMQ worker retry/idempotency,
Graph API resilience, health-check honesty, timeouts, data-loss risk. Read-only; no prod access.
Every finding below was confirmed by opening the file at the cited line, not by grep alone.

## Findings

### REL-01 · HIGH · reliability · impact H / effort L · status: OPEN
**Where:** `backend/src/services/eventCollector.ts:140-148`
**Claim:** `processChangeNotification()` — the single function BullMQ's `webhook-events`
queue calls for every incoming-mail webhook — wraps its entire body in a try/catch that only
`logger.error`s and returns; it never rethrows. `processWebhookEvent()`
(`backend/src/jobs/processors/webhookEvents.ts:33`) just `await`s it, so the job always
resolves as "completed" to BullMQ regardless of what happened inside.
**Why it matters:** The queue's `defaultJobOptions` (`backend/src/jobs/queues.ts:25-30`)
configure `attempts: 3` with exponential backoff specifically so a transient failure (Graph
5xx, a DB blip, a momentary token error) gets retried — but that retry path is dead code for
this queue. A transient failure on new-mail processing is silently dropped after one attempt,
with only a log line and no visibility in `/api/health`, no dead-letter, and no operator
signal. On a single-environment, prod-only app this is the primary ingestion path going dark
without anyone knowing.
**Fix:** In `processChangeNotification`, rethrow after logging (or move the try/catch up into
`processWebhookEvent` so BullMQ sees the failure) so `attempts`/backoff actually apply, and let
a job that exhausts retries land in the `failed` set instead of vanishing as "completed".
**Verifier:** `cd backend && npx vitest run src/services/__tests__/eventCollector.test.ts -t "processChangeNotification rethrows on Graph failure so BullMQ can retry"` — fails now (test/file does not exist; once added it asserts the promise rejects when `fetchGraphMessage`/`getAccessTokenForMailbox` throws a non-404 error).
**Eligible for --fix:** yes

### REL-02 · HIGH · reliability · impact H / effort L · status: OPEN
**Where:** `backend/src/services/ollamaClient.ts:20-37` (`generateEmbedding`), also
`:83-101` (`parseSearchQuery`) and `:128-151` (`generateOllamaCompletion`)
**Claim:** These three outbound calls to Ollama use plain `fetch()` with no `AbortSignal` /
timeout at all (contrast `checkOllamaHealth` at `:160`, which does pass `AbortSignal.timeout(3000)`).
`generateEmbedding` is called from `embedEmail()` inside the `email-embedding` BullMQ processor
(`backend/src/jobs/processors/emailEmbedding.ts:17`), whose queue has no special concurrency
override in `backend/src/jobs/queues.ts:127-137` (defaults to BullMQ's `concurrency: 1`).
**Why it matters:** If Ollama hangs (GPU busy, model swap stall, network partition to the host
Ollama), the single worker for `email-embedding` blocks forever on that one job — never times
out, never fails, never frees the slot. The whole embedding queue backs up indefinitely with no
error surfaced, and nothing in `/api/health` reports it (health checks only Mongo/Redis).
**Fix:** Pass `signal: AbortSignal.timeout(<N>_000)` on all three Ollama fetch calls (a value in
line with the other 30s Graph timeout is reasonable) and let the resulting `AbortError` flow
into BullMQ's existing retry (2 attempts is already configured for `embed-email` jobs).
**Verifier:** `cd backend && npx vitest run src/services/__tests__/ollamaClient.test.ts -t "generateEmbedding rejects instead of hanging when Ollama never responds"` — fails now (no timeout exists to trigger; file/test to be added mocks a fetch that never resolves and asserts rejection within a bounded wait).
**Eligible for --fix:** yes

### REL-03 · HIGH · reliability · impact H / effort L · status: OPEN
**Where:** `backend/src/routes/health.ts:36-129`
**Claim:** `/api/health` gates `healthy`/`degraded` on MongoDB and Redis only. It never calls
the existing `checkOllamaHealth()` (`backend/src/services/ollamaClient.ts:156`) or
`getCollectionInfo()` (`backend/src/services/qdrantClient.ts:187`) helpers — both already
written and exported, just never wired into the health route. Qdrant is a documented hard
dependency (`RUNBOOK.md:76,87-89`: "must be running before backend starts") and Ollama backs
AI search and embeddings.
**Why it matters:** CLAUDE.md states plainly that `/api/health` and the prod watchdog are the
ONLY safety net in this one-environment app. A health endpoint that reports "healthy" while
Qdrant/Ollama are down is worse than an honest "degraded" — it hides exactly the failure class
(REL-02 above) that silently stalls a queue forever. The helper functions to fix this already
exist and are unused.
**Fix:** In `health.ts`, call `checkOllamaHealth()` and `getCollectionInfo()` alongside the
Mongo/Redis checks and add them to the informational `services` block (can stay
non-gating like subscriptions/tokens, but must be visible).
**Verifier:** `cd backend && npx vitest run src/routes/__tests__/health.test.ts -t "reports qdrant and ollama status in the services block"` — fails now (route doesn't emit these fields; test/file to be added).
**Eligible for --fix:** yes

### REL-04 · MEDIUM · reliability · impact M / effort M · status: OPEN
**Where:** `backend/src/services/actionExecutor.ts:57-231`
**Claim:** `executeActions()` iterates a rule's sorted actions and reuses the original
`messageId` parameter for every Graph call in the loop. Microsoft Graph assigns a
folder-scoped message ID that changes when a message is moved (`move`/`delete`/`archive`
actions at lines 60-97, 99-117, 157-168 all call `/messages/{messageId}/move`). Any action
ordered *after* one of those in the same rule (e.g. `move` then `markRead`, or `archive` then
`categorize`) is sent using the now-stale pre-move ID.
**Why it matters:** The stale-ID call gets a 404 from Graph, which the catch block at
`:220-230` interprets as "message not found (user may have moved/deleted)" and silently
`break`s — logging a warning, not an error, and continuing to the `finally` block that records
the rule as executed with only the actions that ran before the move in `executedActions`. A
multi-action rule the user approved quietly does less than approved, with the audit log and
logs both describing it as a benign "user moved it first" case rather than MSEDB's own ordering
bug.
**Fix:** Capture the Graph response body from `move`/`archive`/staging-delete calls (Graph
returns the moved message resource, including its new `id`) and use that id for subsequent
actions in the same `executeActions()` call.
**Verifier:** `cd backend && npx vitest run src/services/__tests__/actionExecutor.test.ts -t "uses the post-move message id for actions ordered after a move"` — fails now (no test exists for this ordering; `graphFetch` is currently never re-read for a new id between actions).
**Eligible for --fix:** yes

### REL-05 · MEDIUM · reliability · impact M / effort L · status: OPEN
**Where:** `backend/src/server.ts` (whole file — no `process.on('unhandledRejection', ...)` or `process.on('uncaughtException', ...)` registered anywhere in `backend/src`)
**Claim:** Only `SIGTERM`/`SIGINT` are handled (`:186-187`). An unhandled promise rejection
anywhere in the app (e.g. a floating promise outside the several `.catch()`-guarded
fire-and-forget calls already present in `startServer()`) has no process-level handler.
**Why it matters:** Modern Node terminates the process on an unhandled rejection by default.
Without a handler that at minimum logs the reason before exit, a crash in this prod-only app
produces no diagnostic trail beyond "container restarted" — and any in-flight BullMQ job or
Graph call at that moment is lost without going through the graceful-shutdown path that closes
workers cleanly.
**Fix:** Add `process.on('unhandledRejection', (reason) => { logger.error(...); })` (and
optionally `uncaughtException`) in `server.ts`, logging full context before either exiting or
routing into `gracefulShutdown`.
**Verifier:** `grep -q "process.on('unhandledRejection'" backend/src/server.ts` — fails now (exit 1, no match); passes once the handler is added.
**Eligible for --fix:** yes

## Checks

```csv
check_id,dim,status,score,max,note
REL-CHECK-01,reliability,PASS,3,3,"/api/health pings live Mongo (readyState) + Redis (PING) and gates healthy/degraded on both"
REL-CHECK-02,reliability,FAIL,0,3,"health.ts never surfaces Qdrant/Ollama status despite RUNBOOK calling Qdrant a hard dependency (REL-03)"
REL-CHECK-03,reliability,PASS,3,3,"graphFetch() sets a 30s AbortController timeout on every Graph call (graphClient.ts:85-92)"
REL-CHECK-04,reliability,PASS,3,3,"graphFetch() honors Retry-After on 429, caps wait at 30s, retries once (graphClient.ts:106-117)"
REL-CHECK-05,reliability,PASS,2,2,"BullMQ defaultJobOptions: attempts 3, exponential backoff, bounded removeOnComplete/removeOnFail (queues.ts:25-30)"
REL-CHECK-06,reliability,FAIL,0,5,"processChangeNotification swallows all errors and never rethrows -- webhook-events retry contract is dead code (REL-01)"
REL-CHECK-07,reliability,FAIL,0,3,"generateEmbedding/parseSearchQuery/generateOllamaCompletion have no fetch timeout -- can hang the single email-embedding worker forever (REL-02)"
REL-CHECK-08,reliability,PASS,3,3,"SIGTERM/SIGINT handled: closes BullMQ workers, then queues, then Mongo, then Redis, in order (server.ts:154-184)"
REL-CHECK-09,reliability,FAIL,0,2,"No process.on('unhandledRejection'/'uncaughtException') anywhere in backend/src (REL-05)"
REL-CHECK-10,reliability,PASS,2,2,"stagingProcessor handles Graph 404 as terminal 'expired' and 429 as 'skip, retry next run' (stagingProcessor.ts:181-199)"
REL-CHECK-11,reliability,PASS,2,2,"stagingProcessor batches in chunks of 5 via Promise.allSettled so one item's failure can't block or crash the batch"
REL-CHECK-12,reliability,PASS,2,2,"actionExecutor writes AuditLog + rule stats in a finally block even on partial failure (actionExecutor.ts:232-268)"
REL-CHECK-13,reliability,FAIL,0,2,"actionExecutor reuses a stale pre-move messageId for actions ordered after move/delete/archive (REL-04)"
REL-CHECK-14,reliability,PASS,2,2,"syncSubscriptionsOnStartup isolates per-mailbox failures (try/catch inside loop) and self-heals a 404-on-renew by recreating the subscription"
REL-CHECK-15,reliability,PASS,2,2,"handleLifecycleEvent triggers immediate delta-sync on 'missed'/'subscriptionRemoved' so a delta-token gap is not silently blind to new mail"
REL-CHECK-16,reliability,PASS,2,2,"Job retention is bounded (removeOnComplete age 3600s/count 200, removeOnFail age 86400s/count 1000) -- no unbounded Redis growth"
REL-CHECK-17,reliability,PASS,1,1,"embeddingReconcile hourly job exists specifically to backfill embeddings that permanently failed during an Ollama/Qdrant outage past the 2-attempt retry budget"
REL-CHECK-18,reliability,PASS,3,3,"connectDatabase() retries Mongo connection up to 10x with exponential backoff (1s->30s cap) before giving up and exiting (database.ts)"
REL-CHECK-19,reliability,PASS,2,2,"delta-sync and token-refresh scheduled jobs isolate per-mailbox failures in a try/catch loop so one broken mailbox can't stop the batch"
REL-CHECK-20,reliability,NOT_EVALUATED,,2,"Qdrant client (@qdrant/js-client-rest) internal timeout/retry defaults not verified from source -- requires reading the installed package's HTTP layer, out of scope for a repo-code read"
```
