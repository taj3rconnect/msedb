# MSEDB Architecture & Security Review

Date: 2026-07-06
Scope: `backend/src`, `addin/src`, `docker-compose.yml`. Read-only review — no code changed.

---

## Current Architecture

MSEDB is an Express 5 + TypeScript backend that watches M365 mailboxes via Microsoft Graph webhooks, detects repetitive sender/action patterns, and — only after explicit user approval — converts a pattern into a mailbox rule that Graph then auto-applies to future mail. React 19 SPA frontend + an Outlook add-in (NAA/Bearer auth) both talk to the same API. MongoDB (shared container, port 27020) is the system of record, Redis backs BullMQ (11 queues) and rate limiting, and Qdrant (AX1, port 6333) + local Ollama power semantic search over email metadata.

### Startup sequence (`backend/src/server.ts`)
1. Connect MongoDB with retry (`server.ts:65`)
2. Verify Redis (`server.ts:68-70`)
3. Apply `/auth` (20/min) and `/api` (100/min) rate limiters (`server.ts:76-77`)
4. Mount CSRF token endpoint + `validateCsrf` on all non-GET routes (`server.ts:80-81`)
5. Mount all routers (`server.ts:84-99`) + global error handler (`server.ts:100`)
6. Init BullMQ schedulers (`server.ts:103`)
7. Init tunnel config, ensure Qdrant collection (non-fatal) (`server.ts:106-115`)
8. Start Socket.IO + HTTP listener, **then** sync Graph webhook subscriptions (Graph validates the callback URL live, so the server must already be listening) (`server.ts:117-136`)
9. Warm contacts cache in the background (`server.ts:139`)

`/health`, `/webhooks/graph`, and `/track/*` are mounted before rate limiting/CSRF/auth (`server.ts:53-59`) — the only three intentionally public routes.

### Data flow: Graph webhook → rule execution

```
Microsoft Graph (mailbox change)
        │  POST /webhooks/graph  (public, no auth)
        ▼
webhooks.ts: validationToken handshake, clientState check against
             WebhookSubscription.clientState  →  res.status(202) fire-and-forget
        │
        ▼  BullMQ: webhook-events queue (job = {subscriptionId, notification-envelope only})
        ▼
eventCollector.ts: fetchGraphMessage() — re-fetches the real message from Graph
                   by id (never trusts notification body content)
        │
        ├─► saveEmailEvent() → EmailEvent (Mongo, 90-day TTL, metadata only, no body)
        ├─► BullMQ: email-embedding queue (metadata only) → embeddingService.ts
        │            fetches body from Graph, strips HTML, embeds via Ollama,
        │            upserts to Qdrant (bodySnippet ≤500 chars stored as payload)
        ├─► BullMQ: body-prefetch queue ({mailboxId, messageId} pointer only)
        │            → Redis body cache, 4h TTL, 250KB cap
        └─► ruleEngine.evaluateRulesForMessage() — for messages matching an
             ALREADY-APPROVED, enabled Rule → actionExecutor.executeActions()
             → Graph API (delete/move/archive/markRead/flag/categorize)
             → AuditLog entry written unconditionally

Independently, on a schedule (daily-report / pattern-analysis queues):
patternEngine.ts → Pattern (status: 'detected' | 'suggested') — NEVER touches
                   Rule or Graph directly
        │  user reviews suggestion in UI
        ▼
POST /api/patterns/:id/approve  (requireAuth)
        │  sets Pattern.status = 'approved'  ← only writer of this status in the codebase
        ▼
ruleConverter.convertPatternToRule()  — hard gate: throws unless
        Pattern.status === 'approved' (ruleConverter.ts:58-60)
        ▼
Rule created (isEnabled: true) → feeds back into ruleEngine above
```

Delta sync (`deltaService.ts`) runs independently per mailbox on a schedule to catch anything a webhook missed; on Graph's `410 Gone` (expired delta token) it deletes the stored deltaLink and restarts as a full sync from `config.syncSinceDate` (`deltaService.ts:124-135`).

### Auth architecture

```
Browser SPA                          Outlook Add-in
  │ MSAL OAuth code grant               │ NAA (nested app auth)
  ▼                                     ▼
GET /auth/callback                  Azure AD access token
  │ jwt sign → msedb_session cookie     │ Authorization: Bearer <token>
  │ (httpOnly, secure in prod,          │
  │  sameSite=lax, 24h)                 │
  ▼                                     ▼
        requireAuth (auth/middleware.ts:109-151)
        cookie → jwt.verify(config.jwtSecret) + re-check User.isActive
        Bearer → validateAzureToken() → JWKS audience check
        ▼
        req.user = { userId, email, role }  (JWT claims only)
```

Graph tokens themselves are cached per-mailbox via MSAL's `ICachePlugin`, persisted into `Mailbox.msalCache` (see Security Findings — this is the single biggest finding in this review).

### Job queues (BullMQ + Redis, `backend/src/jobs/queues.ts`)

11 queues, one dedicated worker each: `webhook-events`, `webhook-renewal`, `delta-sync`, `pattern-analysis`, `staging-processor`, `token-refresh`, `email-embedding`, `scheduled-email`, `contacts-sync`, `daily-report`, `scheduled-email-cleanup`. Workers run with no explicit `concurrency` (BullMQ default = 1/queue) and `defaultJobOptions` sets only `removeOnComplete`/`removeOnFail` — no default `attempts`/`backoff` (`queues.ts:22-25`), so any `.add()` call site that doesn't pass its own retry options gets zero retries on transient failure.

---

## Strengths

- **Approval-before-action contract is structurally enforced, not just documented.** `ruleConverter.ts:58-60` is a single choke point: `Pattern → Rule` conversion throws unless `Pattern.status === 'approved'`, and grepping the codebase shows exactly two route handlers ever set that status (`patterns.ts:333`, `:473`), both behind `requireAuth`. No scheduler or background job can create/enable a rule unilaterally.
- **Consistent owner-scoped queries across all ~14 route files.** Every model holding user/mailbox data (`EmailEvent`, `Mailbox`, `Pattern`, `Rule`, `StagedEmail`, `AuditLog`, `Notification`, `ScheduledEmail`, `TrackedEmail`, `WebhookSubscription`) carries a required `userId`/`mailboxId`, and every route fetches the primary resource with `{_id, userId: req.user!.userId}` before any secondary lookup — no exploitable IDOR/BOLA found in this review.
- **Webhook intake follows Microsoft's recommended pattern exactly**: `validationToken` echo-back, `clientState` compared against the value stored at subscription creation (before anything is enqueued), notification body used only for `subscriptionId`/`resourceData.id`, and the real message is always re-fetched from Graph rather than trusted from the payload (`webhooks.ts:20-63`, `eventCollector.ts:76-149,208-229`).
- **No PII/email content found in application logs.** Winston logs (`config/logger.ts`) are structured JSON to stdout + rotating files; grepping every `logger.*`/`console.*` call across routes/services/jobs found only IDs, addresses, error messages, and counts — never `body`/`bodyPreview`/subject content.
- **Message body retention is disciplined.** `EmailEvent` never stores a body at all (metadata + 90-day TTL); the only Mongo collection holding a full body (`ScheduledEmail`, for outbound drafts) has a 30-day TTL after send/cancel; the only other body copies are Redis (4h TTL, 250KB cap) and Qdrant (500-char snippet).
- **CSRF is a correctly-implemented double-submit cookie pattern** — random token in an httpOnly cookie plus the response body, header/cookie compared server-side, exemptions limited to safe methods and the two genuinely public routes (`middleware/csrf.ts:36-98`).
- **Global error handler never leaks stack traces to clients in any environment** — 500s always return a fixed `"Internal server error"` message; full detail is logged server-side only (`middleware/errorHandler.ts:89-108`).
- **Secret handling has a fail-loud production guard**: `config/index.ts:79-88` refuses to boot in production if `encryptionKey`/`jwtSecret`/`sessionSecret` are missing or under 32 chars — no hardcoded fallback secret exists anywhere in the codebase.

---

## Findings (Architecture / Reliability)

### F1 — [Medium] BullMQ jobs added without explicit retry options get zero retries
`backend/src/jobs/queues.ts:22-25` (`defaultJobOptions`) sets no `attempts`/`backoff`. Several ad-hoc `.add()` calls rely on this default: `backend/src/routes/admin.ts:381-383`, `backend/src/services/subscriptionService.ts:250,257`, `backend/src/routes/patterns.ts:201-204`. A transient Graph 429/503 or Mongo blip during one of these jobs fails permanently rather than retrying. Softened by per-mailbox try/catch inside the processors, but a single-mailbox failure then waits for the next scheduled cycle instead of retrying immediately.
**Recommendation:** add a default `attempts: 3, backoff: exponential` to `defaultJobOptions`, or pass explicit opts at each ad-hoc `.add()` site.

### F2 — [Medium] No alerting on repeated/permanent job failure
`queues.ts:123-130` — the global `worker.on('failed', ...)` handler only calls `logger.error`; failed jobs auto-purge after 24h/1000 count. No `Notification` doc or admin alert is ever created on failure, so a permanently-broken mailbox sync (e.g., revoked consent) is invisible without tailing Docker logs.
**Recommendation:** emit a `Notification` (model already exists and is used elsewhere, e.g. `tokenRefresh.ts:21-27`) when a job exhausts its attempts, or surface failed-job counts on `/api/health`.

### F3 — [Medium] `/api/health` doesn't check Qdrant despite being a documented hard dependency
`backend/src/routes/health.ts:36-129` gates `healthy`/`degraded` on Mongo + Redis only. CLAUDE.md explicitly states "Qdrant dependency — AX1's Qdrant at port 6333 must be running before backend starts," but if it goes down mid-operation, health still reports `healthy` while AI search silently degrades.
**Recommendation:** add a Qdrant ping to the health check (non-fatal to overall status if desired, but visible).

### F4 — [Low] `/api/health` queue metric is a static count, not a real signal
`health.ts:57-58,119-121` reports `Object.keys(queues).length` — always the same number whether workers are alive or crashed. Not useful operationally.
**Recommendation:** use `queue.getJobCounts()` for waiting/active/failed per queue if this endpoint is meant to drive alerting/dashboards.

### F5 — [Low] No worker concurrency configured
`queues.ts:115-117` — `new Worker(...)` omits `concurrency`, defaulting to 1 job at a time per queue. Not a correctness bug (jobs queue rather than drop), but `webhook-events` will serialize processing during traffic bursts.
**Recommendation:** add a tunable `concurrency` once webhook volume justifies it; not urgent today.

### F6 — [Low] Two independent, divergent Bearer-token validators for the same trust boundary
`auth/middleware.ts:31-99` (`validateAzureToken`, used by `requireAuth` on every protected route) checks audience as `api://{host}/{clientId}` and never checks `scp`. A second implementation, `auth/ssoMiddleware.ts:57-114` (`requireSsoAuth`, used only by `GET /auth/me`), checks audience as bare `azureAdClientId` and additionally requires `scp` to include `access_as_user`. Two parallel validators for the same credential type will drift if one is updated and not the other.
**Recommendation:** consolidate into one Bearer-validation function (carry over the `scp` check), shared by `requireAuth` and `/auth/me`.

### F7 — [Low] Minor documentation/count mismatches
`backend/src/jobs/schedulers.ts:10` comment says "8 job schedulers" while 9 are registered and logged at `:122`; `middleware/csrf.ts:55` comment claims `/auth/callback` is explicitly exempted from CSRF when it's actually just caught by the generic GET/safe-method check. Cosmetic, but would break silently if either changed.

---

## Security Findings

### S1 — [HIGH] Microsoft Graph access/refresh tokens are stored in MongoDB in plaintext
`backend/src/auth/msalClient.ts:47-68` (`MongoDBCachePlugin`) serializes the raw MSAL token cache — containing live Graph access **and** refresh tokens — directly into `Mailbox.msalCache` (`backend/src/models/Mailbox.ts:30,60`, a plain `String` field) with no encrypt/decrypt call anywhere in the read/write path. This is the path every Graph call in the app uses (`deltaService.ts`, `eventCollector.ts`, `subscriptionService.ts`, `tokenRefresh.ts` all call `createMsalClient()`).

The codebase already contains a correct AES-256-GCM implementation (`backend/src/utils/encryption.ts`) and a `tokenManager.ts:10-19` (`encryptTokenData`/`decryptTokenData`) built specifically for this, plus an `encryptedTokens.{accessToken,refreshToken}` sub-schema on both `User` and `Mailbox` models — but grepping the entire backend, these functions are **never called**. The only field of `encryptedTokens` ever written is `expiresAt` (a plaintext date, `routes.ts:146,240`, `tokenRefresh.ts:80-82`).

Net effect: CLAUDE.md's own claim ("MSAL token refresh handled automatically... encrypted tokens stored per-user in MongoDB") is not accurate for the actual token material. Anyone with read access to this MongoDB instance — which CLAUDE.md itself documents as **shared with JTCRM** on port 27020 — can extract a live token and act as that mailbox's user against Graph (read/write/send mail, calendar) until expiry or revocation.
**Recommendation:** wrap `MongoDBCachePlugin.beforeCacheAccess`/`afterCacheAccess` (`msalClient.ts:54-67`) with the existing `encrypt`/`decrypt` helpers before persisting `msalCache`, or fully migrate onto the already-built `encryptedTokens` field and delete the unused plaintext-cache approach. This is the top-priority fix from this review.

### S2 — [Medium] `Calendars.ReadWrite` scope is requested but unused
`backend/src/auth/msalClient.ts:22` requests `Calendars.ReadWrite` as part of `GRAPH_SCOPES`. Grepping `backend/src` for any calendar-related code found nothing — no feature uses it. This is broader-than-necessary consent (calendar write access) for an app whose documented scopes (per CLAUDE.md) are `Mail.Read`, `Mail.ReadWrite`, `MailboxSettings.ReadWrite`.
**Recommendation:** drop `Calendars.ReadWrite` (and re-consent existing mailboxes) unless a calendar feature is actually planned.

### S3 — [Medium] Qdrant stores a plaintext, unencrypted, indefinite copy of email body content
`backend/src/services/embeddingService.ts:154-155` stores `bodySnippet` (first 500 chars of the stripped email body) as a Qdrant payload field alongside the vector, with no TTL/expiry observed in `qdrantClient.ts`. This is a secondary at-rest copy of message content outside MongoDB's TTL-governed retention model.
**Recommendation:** confirm Qdrant (AX1, port 6333) has network-level access controls (internal-only, not internet-facing) and consider a retention policy matching the existing 90-day embed-tracking TTL in Redis (`embeddingService.ts:16`).

### S4 — [Medium] `/auth/login` + `/auth/callback` share the same rate-limit bucket as low-risk auth endpoints
`server.ts:76-84` applies one 20/min limiter to the entire `/auth` prefix, so the OAuth code-exchange endpoint (`/auth/callback`, which calls out to Azure AD) shares its budget with `/auth/csrf-token`, `/auth/me`, `/auth/logout` — endpoints a legitimate SPA hits far more often. 20/min is coarse specifically for the login/callback pair.
**Recommendation:** give `/auth/login` + `/auth/callback` their own tighter limiter (e.g. 5-10/min), separate from the rest of `/auth`.

### S5 — [Low-Medium] `azureAdClientSecret` is excluded from the production secret-validation list
`backend/src/config/index.ts:81` (`secretFields`) validates `encryptionKey`, `jwtSecret`, `sessionSecret` at boot but not `azureAdClientSecret`. A missing/empty value won't fail fast — it surfaces later as an opaque MSAL auth failure at first login attempt.
**Recommendation:** add it to the same startup validation list.

### S6 — [Low] `jwt.verify` calls don't pin `algorithms`
`backend/src/auth/routes.ts:65` and `backend/src/auth/middleware.ts:114` call `jwt.verify(token, config.jwtSecret)` without an `algorithms` option. Not currently exploitable (single symmetric secret, no asymmetric-key path exists), but it's a standard hardening step and a latent alg-confusion risk if the signing scheme ever changes.
**Recommendation:** `jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] })`.

### S7 — [Low] One JWT secret signs two different token purposes with no `typ`/`aud` distinction
`config.jwtSecret` signs both the short-lived OAuth `state` token (`auth/routes.ts:22-26`) and the 24h session cookie (`auth/routes.ts:150-158`), with no claim distinguishing them. Not exploitable today (the state token lacks the fields `requireAuth` needs), but worth separating as the auth surface grows.
**Recommendation:** add a `typ` claim or use distinct secrets per token purpose.

### S8 — [Low] No IP allowlist on the public `/webhooks/graph` endpoint
`server.ts:55-56` mounts the webhook router with no rate limiting or IP restriction ("Microsoft controls the rate" — but anyone on the internet can POST to it, not just Microsoft). Mitigated by the global 1MB body cap and a cheap indexed lookup that rejects unknown `subscriptionId`s (`webhooks.ts:47-56`), so this is defense-in-depth rather than a live gap.
**Recommendation:** consider an IP allowlist for Microsoft's published Graph notification ranges if this endpoint ever shows abuse.

### S9 — [Low] `clientState` comparison is not constant-time
`webhooks.ts:58` uses plain `!==` to compare the incoming `clientState` against the stored value. A timing side-channel is theoretically present but impractical to exploit over real network jitter for a single shared secret per subscription.
**Recommendation:** low priority; switch to a constant-time compare (`crypto.timingSafeEqual`) only if this endpoint's threat model changes.

### S10 — [Low] Defense-in-depth gap in one mailbox lookup
`backend/src/routes/events.ts:117,419,566` — `Mailbox.find({_id: mailboxId})` resolves a mailbox's email address for Redis cache keys without also filtering by `userId`. Not exploitable today (the resolved address is never returned to the client, and downstream `EmailEvent` queries still require the caller's `userId`), but inconsistent with the owner-scoped pattern used everywhere else.
**Recommendation:** add `userId: req.user!.userId` to this lookup for consistency.

### S11 — [Low] No checked-in `.env.example`
No `.env` is committed (correct) but there's also no `.env.example` template in the repo — secret provisioning relies on tribal knowledge / CLAUDE.md / Obsidian rather than a self-documenting template. No real secrets found hardcoded anywhere in source (grepped `backend/src` and `docker-compose.yml`; only placeholder text like `AZURE_AD_CLIENT_SECRET=your-client-secret` in docs).
**Recommendation:** add a placeholder-only `.env.example`.

### S12 — [Informational] Mongo/Redis run without auth by design
`docker-compose.yml` runs Mongo with no `--auth`/root user and Redis with no password (confirmed intentional per commit `d63cfc4` — matches the backend's no-auth connection config). Both ports are published to the host (27020, 6382) rather than being internal-only to the Docker network. This is a documented, deliberate tradeoff, not an app-code defect — flagging only because S1 (plaintext tokens) raises the stakes of anyone reaching this port. Confirm DGX host firewall / Tailscale ACLs actually restrict these published ports from the public internet.

---

## Recommended Improvements (Prioritized)

1. **[HIGH, do first]** Encrypt the MSAL token cache before it's written to `Mailbox.msalCache` (S1) — the fix is a few lines using code that already exists in the repo (`utils/encryption.ts`).
2. **[Medium]** Drop the unused `Calendars.ReadWrite` Graph scope (S2).
3. **[Medium]** Add default retry/backoff to BullMQ `defaultJobOptions` and alert on exhausted job failures (F1, F2).
4. **[Medium]** Add Qdrant to `/api/health` (F3) and confirm Qdrant's network exposure / consider a retention TTL on stored `bodySnippet` (S3).
5. **[Medium]** Give `/auth/login` + `/auth/callback` a dedicated, tighter rate limit (S4).
6. **[Low-Medium]** Add `azureAdClientSecret` to the production secret-validation list (S5); consolidate the two Bearer-token validators (F6).
7. **[Low]** Pin `jwt.verify` algorithms (S6), separate JWT secret purposes (S7), scope the `events.ts` mailbox lookup by `userId` (S10), add a real queue-health metric (F4), add `.env.example` (S11).
8. **[Low, opportunistic]** Worker concurrency tuning (F5) and doc/comment cleanups (F7) — no urgency, fix opportunistically.

---

## Methodology

Reviewed via direct file reads across `backend/src/{server.ts, auth/, middleware/, routes/, services/, jobs/, models/, config/}`, `addin/src/auth/`, and `docker-compose.yml`, plus targeted greps for logging of PII, hardcoded secrets, and IDOR patterns (owner-scoped vs. unscoped DB lookups). All findings above were independently spot-checked against source (see the plaintext-token-cache path in `msalClient.ts`, confirmed directly). No code was modified as part of this review.
