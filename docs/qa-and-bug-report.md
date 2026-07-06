# MSEDB QA & Bug Report

Generated 2026-07-06. Scope: `backend/src` (Express 5 + TS, BullMQ, MongoDB, Graph API) and `frontend/src` socket/state handling. All findings below are grounded in the current `main` branch (commit `2323061`) — file:line citations point at the reviewed code.

---

## Confirmed Bugs

### 1. [HIGH] Pattern suggestions bypass the 14-day minimum observation period
**File:** `backend/src/services/patternEngine.ts:144`

```ts
const daysSinceFirstSeen = (Date.now() - firstSeen.getTime()) / (1000 * 60 * 60 * 24);
if (daysSinceFirstSeen < 1) {
  return false;
}
```

The docstring above `shouldSuggestPattern` (line 132-134) says the function checks that "the pattern has been observed for at least MIN_OBSERVATION_DAYS," and the test suite (`backend/src/services/__tests__/patternEngine.test.ts:186-215`) asserts a **14-day** minimum (e.g. "should enforce 14-day minimum observation period," "should return true exactly at 14 days"). The implementation checks `< 1` day, not `< 14`. This is not a docstring typo — it is a live, currently-failing test (see Current Test Run Output below), meaning a sender pattern with as little as 5 events gathered in a single day can be surfaced to the user for approval as if it had two weeks of evidence behind it. Since MSEDB's core UX contract is "never create a rule without informed approval," suggesting patterns on paper-thin evidence undermines the confidence the approval step is supposed to convey.

**Fix:** change `daysSinceFirstSeen < 1` to `daysSinceFirstSeen < 14` (or read a `MIN_OBSERVATION_DAYS` constant, since a magic `14` is currently absent from the file entirely).

### 2. [MEDIUM] `executeActions` can produce a partially-executed rule with no audit trail
**File:** `backend/src/services/actionExecutor.ts:217-263`

`executeActions` runs actions in a `for` loop (line 55). Only `GraphApiError` with `status === 404` is caught and treated as "stop, but don't fail" (line 219-226); every other error — including a 429 that survives `graphFetch`'s single retry (`graphClient.ts:106-117`), a 5xx, or a network timeout — is re-thrown at line 227 straight out of `executeActions`, **before** the `Rule.findByIdAndUpdate` stats update (line 232) and the `AuditLog.create` call (line 243) ever run. Concretely: rule has `[delete, categorize]`; `delete` succeeds (message is moved to staging or deleted); `categorize` throws a transient 5xx. The email is now gone/staged with zero audit record and zero rule-stats update. The caller (`eventCollector.ts:337-347`, inside a `try { … } catch` that only logs at line 349-354) swallows this, so nothing surfaces to the user except a log line — the user has no record of why an email disappeared.

**Fix:** wrap the audit/stats block in a `finally`, or move audit-log creation to record per-action outcomes (including the executed prefix) rather than only firing after every action succeeds.

### 3. [MEDIUM] Cross-mailbox event lookups are not scoped to `userId`/`mailboxId` — shared mailbox contamination risk
**Files:** `backend/src/services/eventCollector.ts:170-172` (`handleDeleted`), `:383-385` (`handleUpdated`); `backend/src/services/deltaService.ts:142-144` (deleted-message handling)

All three "find the prior event for this message" lookups query only by `messageId`:

```ts
const priorEvent = await EmailEvent.findOne({ messageId }).sort({ timestamp: -1 }).lean();
```

`EmailEvent`'s uniqueness/dedup index is `{ userId, mailboxId, messageId, eventType }` (`models/EmailEvent.ts:83-86`), i.e. the schema itself acknowledges `messageId` alone isn't the natural key — there's a separate non-unique `{ messageId, timestamp: -1 }` index (line 87) that these three call sites use instead. If two `Mailbox` documents (two different `userId`s, or the same user with two `Mailbox` records) point at the same underlying M365 mailbox — the exact "shared mailbox" scenario called out in this repo's own QA checklist — a Graph message ID collision means `handleUpdated`'s move/read/flag/category diffing (lines 390-476) and `handleDeleted`'s metadata copy (lines 182-193) can read a *different mailbox's* prior event and produce wrong `fromFolder`/`isRead`/`categories` values, or write `isDeleted: true` onto another user's event rows via the `EmailEvent.updateMany({ userId, mailboxId, messageId, eventType: 'arrived' }, …)` calls that follow (these ARE correctly scoped, so no cross-tenant *write* corruption, but the *read* that drives the diff logic is not scoped, so the computed diff can be wrong).

**Fix:** add `userId`/`mailboxId` (or at minimum `mailboxId`) to the three `findOne({ messageId })` queries; the existing `{ messageId, timestamp: -1 }` index would need `mailboxId` prepended to stay useful.

### 4. [LOW] Dead/no-op code in flag-change detection
**File:** `backend/src/services/eventCollector.ts:426-436`

```ts
const priorFlagStatus = priorEvent
  ? undefined // We do not store flag status in EmailEvent, so check if prior event was 'flagged' type
  : undefined;
```

Both ternary branches evaluate to `undefined`; `priorFlagStatus` is assigned and never read again. This isn't causing incorrect behavior (the real gate is the `hasPriorFlagEvent` query two lines down), but it's vestigial code that reads like an incomplete refactor and will confuse the next person who touches flag detection. Delete it.

### 5. [LOW] Doc/code mismatch on Graph concurrency limit
**File:** `backend/src/services/graphClient.ts:22-27, 55`

The docstring says "Graph enforces a MailboxConcurrency limit (~4 parallel connections per mailbox per app). We cap at 3…" and the function-level docstring (line 62) repeats "concurrency limit of 3." The actual semaphore is `new Semaphore(2)`. Not exploitable, but worth fixing before someone "fixes" a throttling issue by looking at the comment instead of the constructor arg.

---

## Suspected Issues (needs verification against live Graph traffic / DB data)

| # | Area | Concern | How to verify |
|---|------|---------|----------------|
| S1 | `deltaService.ts:250-257` | If a delta page has neither `@odata.nextLink` nor `@odata.deltaLink` (Graph contract violation / edge response), `url` is set to `''` and the loop exits **without ever storing a deltaLink**, so the *next* scheduled sync silently falls back to a full initial sync (`$filter=receivedDateTime ge config.syncSinceDate`, `deltaService.ts:106`) instead of resuming incrementally. Low-probability per Graph's documented contract, but worth a defensive log/alert since it fails silently. | Mock a Graph delta response with `value` but no `@odata.nextLink`/`@odata.deltaLink`; assert a warning is logged and no silent full-resync occurs undetected. |
| S2 | `actionExecutor.ts` + `stagingProcessor.ts` | If `executeActions` throws mid-loop (see Bug #2) and BullMQ retries the whole `webhook-events` job (`attempts: 3` per `webhookEvents.ts` processor config), the already-executed `delete` action's `createStagedEmail` (actionExecutor.ts:84-91) runs a **second time** on retry, creating a duplicate `StagedEmail` row for the same message/rule. `stagingProcessor.ts` would then attempt the same Graph move/delete twice (harmless — second one 404s and is marked `'expired'`) but doubles the audit trail and staging UI entries. | Force a mid-loop throw in a test harness (mock `graphFetch` to fail on the 2nd action), replay the BullMQ job, and check `StagedEmail.countDocuments` for the same `messageId`. |
| S3 | `subscriptionService.ts:150-208` (`syncSubscriptionsOnStartup`) | Runs on both server startup (`server.ts:132`) and the `renew-webhooks` scheduled job (every 2h, per `webhookRenewal.ts:22-25`). No lock/mutex — if a restart happens to coincide with the scheduled renewal tick, two concurrent calls could both see `existingSub.expiresAt < new Date()` as true and both call `createSubscription`, producing two active Graph subscriptions for the same mailbox (double webhook delivery, doubling load on `webhook-events` — deduped downstream by the unique index, but wasted work and two `WebhookSubscription` DB rows to track). | Trigger a restart at the same time a BullMQ repeatable job fires; check Graph `/subscriptions` and local `WebhookSubscription` collection for duplicates on the same `resource`. |
| S4 | `useSocket.ts:20-58` | No `socket.on('reconnect', …)` handler that re-invalidates queries after a dropped connection is restored. Socket.IO client auto-reconnects, but any `email:event`/`staging:new` notifications that occurred while disconnected are lost — the dashboard won't refresh until the *next* live event arrives or the user manually navigates/refetches. Likely masked in practice by React Query's window-focus refetch, but worth confirming. | Kill backend Socket.IO server briefly while frontend is open, cause a webhook event during the outage, restore server, confirm whether dashboard catches up without a manual refresh. |
| S5 | `patternEngine.ts:499-561` (`analyzeMailboxPatterns` recency batch) | `recencyTotals` accumulates `totalEvents` across **all** `eventType`s seen in the 7-day window per sender (line 558-561), but the per-action `recencyActions` map key is `sender|eventType`. If a sender has both `deleted` and `moved` events in the recent window, `recentTotalEvents` used for the `deleted` action's recency factor includes the `moved` events too — this appears intentional (recency compares "how often was this action taken out of all recent events for this sender"), but worth confirming against the original spec, since `getRecencyStats` (the single-sender helper used by folder-routing, line 311-349) computes `totalEvents` per-sender the same way, so at least the two code paths are self-consistent. | Re-derive the intended recency formula from product/PM spec and confirm the batched aggregation (`analyzeMailboxPatterns`) matches the single-sender helper (`getRecencyStats`) semantics exactly for a hand-computed example. |

---

## Test Inventory & Gaps

Test suite requires `node_modules` to be installed (`backend/node_modules` was absent in this checkout — installed via `yarn install` for this review; no `yarn.lock` exists, only a stray root-level `package-lock.json`, which yarn itself flags as a package-manager mismatch risk).

| Test file | Lines | Covers |
|---|---|---|
| `services/__tests__/patternEngine.test.ts` | 222 | `calculateConfidence` (base rate, sample multiplier, recency penalty, clamping) and `shouldSuggestPattern` (per-action thresholds, observation window) — pure functions only, no DB/aggregation coverage |
| `services/__tests__/actionExecutor.test.ts` | 169 | `executeActions` — likely happy-path + some action types (needs deeper look, but present) |
| `services/__tests__/ruleEngine.test.ts` | 81 | `matchesConditions` / `evaluateRulesForMessage` — condition matching logic |
| `routes/__tests__/patterns-hasRule.test.ts` | 56 | `GET /api/patterns` `hasRule` enrichment field |

**Gaps — untested services/routes (highest risk first):**
- `deltaService.ts` — no tests at all. This is the most complex control-flow file in the backend (pagination, 410 Gone recovery/recursion, delete-vs-arrived branching, isRead sync) and currently has zero coverage.
- `eventCollector.ts` — no tests. Contains the webhook fan-out logic (created/updated/deleted handling, move/read/flag/category diffing) called out in Bug #3 and #4 above; a test would have caught the dead-code branch and could catch the unscoped-lookup bug with a two-mailbox fixture.
- `subscriptionService.ts` — no tests for `createSubscription`/`renewSubscription`/`syncSubscriptionsOnStartup`/`handleLifecycleEvent`. Given Suspected Issue S3, concurrent-invocation behavior is entirely unverified.
- `stagingProcessor.ts` — no tests for the grace-period execution path (404/429/other-error branches).
- `tokenManager.ts` / `tokenRefresh.ts` — no tests for token acquisition, `isInteractionRequired` detection, or the disconnect-and-notify flow.
- `auth/` (msalClient, ssoMiddleware, middleware, routes) — no tests for the OAuth code-grant flow or JWT session validation.
- `graphClient.ts` — no tests for the 429 retry/backoff path or the concurrency semaphore (directly relevant to Bug #5 and general throttling resilience).
- Routes: `mailbox.ts`, `rules.ts`, `staging.ts`, `events.ts`, `webhooks.ts`, `admin.ts`, `audit.ts`, `notifications.ts`, `settings.ts`, `aiSearch.ts`, `scheduledEmails.ts`, `reports.ts`, `dashboard.ts` — none have tests beyond the single `patterns-hasRule` enrichment test. No integration/API-contract tests exist for any authenticated endpoint.
- Frontend — zero test files found under `frontend/src`; no component, hook, or E2E coverage (no Playwright/Vitest/Testing Library config detected in `frontend/package.json` scripts).
- No CI-visible test config in `package.json` for the frontend (`yarn lint` and `yarn build` only).

---

## Current Test Run Output

Command run: `cd backend && npx vitest run` (per instructions; `node_modules` had to be installed first — it did not exist in this checkout, which itself is worth flagging: a fresh `git clone` + `yarn test` fails immediately with a vitest config resolution error until `yarn install` is run).

```
 RUN  v4.1.10 D:/claude/msedb/backend

 ❯ src/services/__tests__/patternEngine.test.ts (18 tests | 2 failed) 14ms
     × should return false for move at 86% confidence with only 10 days observation
     × should enforce 14-day minimum observation period

 FAIL  src/services/__tests__/patternEngine.test.ts > shouldSuggestPattern > should return false for move at 86% confidence with only 10 days observation
AssertionError: expected true to be false
 FAIL  src/services/__tests__/patternEngine.test.ts > shouldSuggestPattern > should enforce 14-day minimum observation period
AssertionError: expected true to be false

 Test Files  1 failed | 3 passed (4)
      Tests  2 failed | 36 passed (38)
```

Both failures trace directly to Bug #1 above (`daysSinceFirstSeen < 1` instead of `< 14`).

---

## QA Checklist

Each row: scenario → how to simulate/verify in this codebase.

| Scenario | How to simulate / verify |
|---|---|
| Graph API 5xx failure mid-action | Mock `graphFetch` (services/graphClient.ts) to throw a non-404/429 `GraphApiError` on the 2nd action in `executeActions`; confirm audit/stats behavior (see Bug #2) and BullMQ retry outcome. |
| Expired/revoked refresh token | Mock MSAL `acquireTokenSilent` to reject with an `interaction_required` message; confirm `tokenRefresh.ts` calls `markMailboxDisconnected` (`tokenRefresh.ts:13-34`) and creates the `Notification`. |
| Graph throttling (429) | Mock `fetch` to return 429 with a `Retry-After` header on first call, 200 on retry; confirm `graphFetch` (`graphClient.ts:106-117`) waits `min(Retry-After, 30)s` then succeeds. Also test the case where the retry *also* 429s — confirm the caller's handling (webhook processor should hit BullMQ retry with backoff; staging processor should return `'skipped'` per `stagingProcessor.ts:192-199`). |
| Partial sync (delta page cut off, no deltaLink) | Feed `runDeltaSync` a mocked response with `value` populated but neither `@odata.nextLink` nor `@odata.deltaLink` present (S1); confirm behavior on the next sync cycle. |
| Duplicate messages (webhook + delta race) | Fire `processChangeNotification({changeType:'created', …})` and `runDeltaSync` concurrently for the same `messageId`/`mailboxId`/`userId`; confirm exactly one `EmailEvent` row is created via the compound unique index dedup in `saveEmailEvent` (`eventCollector.ts:22-57`) and the other call returns `false`/increments `skipped`. |
| Deleted message | For webhook: notification with `changeType:'deleted'`, confirm `handleDeleted` copies metadata from the prior `arrived` event and marks it `isDeleted: true`. For delta: confirm `msg['@removed']` branch in `deltaService.ts:140-177` behaves identically. Check both against a shared-mailbox fixture (two `Mailbox` docs, same `messageId`) to probe Bug #3. |
| Moved message | Send an `updated` notification with a different `parentFolderId` than the prior stored `toFolder`; confirm a `moved` event with correct `fromFolder`/`toFolder` (`eventCollector.ts:390-403`). |
| Large attachments | Confirm `metadataExtractor.ts`'s `hasAttachments` flag and the `email-embedding`/`body-prefetch` job payloads (`eventCollector.ts:269-300`, `deltaService.ts:193-225`) don't attempt to fetch/embed attachment binaries inline — verify `body-prefetch` job payload size stays small regardless of attachment size. |
| Empty body / no bodyPreview | Confirm `matchesConditions`' `bodyContains` check (`ruleEngine.ts:111-116`) treats a missing `bodyPreview` as `''` and doesn't throw; confirm rule matching degrades to "no match" rather than error. |
| Shared mailboxes (same Graph mailbox monitored under 2+ `Mailbox` docs/users) | Directly exercises Bug #3 — create two `Mailbox` records with the same `email`, feed identical `messageId` notifications to both, and diff the resulting `EmailEvent` rows/detected move-vs-arrived state for cross-contamination. |
| Concurrent webhook renewal + startup sync | Call `syncSubscriptionsOnStartup()` twice concurrently against the same mailbox's `WebhookSubscription` record (S3); check Graph `/subscriptions` list and local DB for duplicate active subscriptions. |
| Rule action against an already-user-deleted message | Confirm 404 handling in `executeActions` (`actionExecutor.ts:217-226`) stops further actions gracefully and doesn't throw. |
| Staged item rescued after grace-period processor already claimed it | Race `rescueStagedEmail` (`stagingManager.ts:142-171`, status filter `'staged'`) against `processOneItem` (`stagingProcessor.ts:83-209`, which reads then later `.save()`s the same doc) — confirm the `findOneAndUpdate` status guard in rescue prevents a rescue from "succeeding" after the processor has already flipped status, and vice versa. |

---

## Prioritized Test-Writing Plan

1. **Fix Bug #1, then add a regression test** — trivial, already covered by existing (currently failing) tests; just fix the `< 1` → `< 14` and rerun. Zero new test-writing needed, but this is the highest-value, lowest-effort item and should ship first.
2. **`eventCollector.ts` unit tests** — mock `graphFetch`/`Mailbox`/`EmailEvent`, cover `handleCreated`/`handleUpdated`/`handleDeleted` including a two-mailbox-same-messageId fixture to pin down Bug #3 before fixing it.
3. **`deltaService.ts` unit tests** — mock `graphFetch` for pagination (multi-page `@odata.nextLink`), 410 Gone recovery, and the no-deltaLink edge case (S1).
4. **`actionExecutor.ts` failure-path tests** — extend the existing 169-line suite to cover a mid-loop non-404 throw (Bug #2) and confirm/deny the audit-trail gap.
5. **`subscriptionService.ts` tests** — cover `syncSubscriptionsOnStartup` idempotency under a pre-existing active, non-expired subscription (S3) and `handleLifecycleEvent` for all three lifecycle types.
6. **`graphClient.ts` tests** — 429 retry/backoff, non-ok throw shape, concurrency semaphore behavior under load (also forces resolving the "2 vs 3" doc mismatch in Bug #5).
7. **Route-level API tests** for `rules.ts`, `staging.ts`, `mailbox.ts` — currently zero coverage on any authenticated endpoint; start with the rule-approval flow since it's the product's core safety contract ("never create a rule without approval").
8. **Frontend** — no test harness exists yet; lowest priority relative to backend correctness, but `useSocket.ts` reconnect behavior (S4) is worth a Playwright smoke test once a harness is stood up.
