# Tests Audit — 2026-08-13

## Suite result

**Backend:** 68 tests passed across 9 test files
```bash
cd backend && yarn test
# Result: 9 test files passed, 68 tests passed (3.88s)
```

**Frontend:** No test suite configured
```bash
cd frontend && yarn test
# Result: No test script in package.json
```

**Linting:** Frontend lint fails
```bash
cd frontend && yarn lint
# Result: FAIL — eslint not installed/not configured
```

## Test Coverage

**Backend:** ~99 source files, 9 test files (68 tests total)
- **Coverage ratio:** 9% of backend source has tests
- **Frontend:** ~153 source files, 0 test files
- **Integrated coverage:** ~6% of total codebase (9 files of 252 total)

## Findings

### TEST-01 · CRITICAL · tests · impact H / effort H · status: OPEN

**Where:** `backend/src/services/deltaService.ts` (lines 1-50+, entire module)

**Claim:** Delta query sync (incremental email fetch from Graph API) is completely untested; it processes token lifecycle, pagination, and real Graph API errors with no test coverage.

**Why it matters:** `deltaService` is called by the `delta-sync` BullMQ queue (one of 11 core workers). Failures to paginate, handle expired tokens, or recover from Graph API 410 errors could silently skip email batches or leak deltaLink state, breaking pattern detection for hours. This is the single largest coverage gap by risk.

**Fix:** Create `backend/src/services/__tests__/deltaService.test.ts` with tests for: (1) successful delta query with pagination, (2) expired deltaLink → 410 Gone → fresh query, (3) corrupted/missing deltaLink → initial sync, (4) Graph API transient errors (5xx) with retry, (5) emailEvent deduplication pipeline integration.

**Verifier:** `cd backend && npx vitest run src/services/__tests__/deltaService.test.ts`

**Eligible for --fix:** yes


### TEST-02 · CRITICAL · tests · impact H / effort H · status: OPEN

**Where:** `backend/src/services/graphClient.ts` (entire module, core Graph wrapper)

**Claim:** `graphClient` (Graph API wrapper with Semaphore, error handling, retry logic) is mocked in all downstream tests but has zero standalone tests. Mocks hide bugs in retry backoff, semaphore starvation, or token header construction.

**Why it matters:** This is the foundation for all Graph API calls. Bugs in the semaphore (concurrent request limits), token refresh headers, or error classification (transient vs permanent) affect every operation: webhook processing, delta sync, rule execution, email actions. A semaphore deadlock would stop the entire backend.

**Fix:** Create `backend/src/services/__tests__/graphClient.test.ts` with tests for: (1) semaphore acquires and releases correctly under concurrency, (2) transient errors (429, 5xx) trigger exponential backoff, (3) permanent errors (401, 403, 404) fail immediately, (4) Bearer token header is set correctly.

**Verifier:** `cd backend && npx vitest run src/services/__tests__/graphClient.test.ts`

**Eligible for --fix:** yes


### TEST-03 · CRITICAL · tests · impact H / effort H · status: OPEN

**Where:** `backend/src/routes/webhooks.ts:20-110` (Graph webhook endpoint)

**Claim:** The `/webhooks/graph` endpoint processes all Microsoft Graph change notifications (email received, flagged, deleted, moved) with no tests. Logic: validation handshake, clientState checks, deduplication jobId, fire-and-forget queue enqueuing — all untested.

**Why it matters:** This is the only public endpoint (no auth required). Graph sends ~thousands of notifications per day. Bugs in clientState validation could process spoofed notifications. Deduplication logic (jobId construction) could fail silently, causing duplicate rule execution on the same email. The 3-second response window is tight; an untested regression could violate Graph's SLA and lose subscriptions.

**Fix:** Create `backend/src/routes/__tests__/webhooks.test.ts` with tests for: (1) validation handshake returns validationToken, (2) mismatched clientState is skipped with warning, (3) valid lifecycle notification is enqueued to webhook-renewal, (4) valid change notification is enqueued to webhook-events with dedup jobId, (5) response is 202 before async enqueue completes.

**Verifier:** `cd backend && npx vitest run src/routes/__tests__/webhooks.test.ts`

**Eligible for --fix:** yes


### TEST-04 · HIGH · tests · impact H / effort H · status: OPEN

**Where:** `backend/src/auth/routes.ts:20-90` (login and callback flows)

**Claim:** Auth entry points (`GET /auth/login` and `GET /auth/callback`) — the entire OAuth 2.0 flow — have no tests. Callback exchanges auth code for tokens, creates User/Mailbox, persists MSAL cache, and issues JWT session cookie.

**Why it matters:** Without this flow, no user gets into the app. A regression in state validation, token caching, or MSAL client initialization could lock users out or leak tokens into wrong mailboxes. This is the entry gate.

**Fix:** Create `backend/src/auth/__tests__/routes.test.ts` with tests for: (1) login redirects to Azure AD with state token, (2) callback rejects if code/state missing, (3) callback exchanges code for tokens correctly, (4) callback finds or creates User and Mailbox, (5) callback rejects invalid state token.

**Verifier:** `cd backend && npx vitest run src/auth/__tests__/routes.test.ts`

**Eligible for --fix:** yes


### TEST-05 · HIGH · tests · impact H / effort M · status: OPEN

**Where:** `backend/src/middleware/csrf.ts:36-98` (CSRF token issuance and validation)

**Claim:** The double-submit cookie CSRF pattern (issue token via `/auth/csrf-token`, validate on state-changing requests) is completely untested. Logic: token generation, cookie + JSON response, validation comparison, exemptions for safe methods/webhooks/Bearer auth.

**Why it matters:** A CSRF bug is the difference between an SPA that safely mutates state and one open to cross-origin attacks. The exemption list (safe methods, `/webhooks`, `/track`, Bearer auth) needs verification — a broken exemption exposes the add-in or webhooks to CSRF. Token comparison must be timing-attack resistant.

**Fix:** Create `backend/src/middleware/__tests__/csrf.test.ts` with tests for: (1) issueCsrfToken generates random token and sets httpOnly cookie, (2) validateCsrf passes GET/HEAD/OPTIONS, (3) validateCsrf fails on missing/mismatched token, (4) validateCsrf exempts webhook paths, (5) validateCsrf exempts Bearer auth.

**Verifier:** `cd backend && npx vitest run src/middleware/__tests__/csrf.test.ts`

**Eligible for --fix:** yes


### TEST-06 · HIGH · tests · impact M / effort M · status: OPEN

**Where:** `backend/src/middleware/errorHandler.ts` (entire module, error response mapping)

**Claim:** Error handler middleware (converts internal errors to HTTP responses) is untested. Responsible for translating AppError/ValidationError/ForbiddenError to 4xx/5xx with sanitized messages.

**Why it matters:** Misconfigured error handling can leak stack traces to the client or suppress real errors. Unit tests confirm error→status mapping, message sanitization, and audit logging on sensitive errors (auth, data access).

**Fix:** Create `backend/src/middleware/__tests__/errorHandler.test.ts` with tests for: (1) AppError maps to correct status, (2) stack traces absent from client response, (3) generic 500 on unexpected errors, (4) validation errors return 400 with constraint details.

**Verifier:** `cd backend && npx vitest run src/middleware/__tests__/errorHandler.test.ts`

**Eligible for --fix:** yes


### TEST-07 · MEDIUM · tests · impact M / effort L · status: OPEN

**Where:** `backend/src/middleware/rateLimiter.ts` (entire module)

**Claim:** Rate limiter (20 req/min on `/auth`, 100 req/min on `/api` per CLAUDE.md) is applied at startup but has no tests. No verification that limits are enforced or that Redis connection failures fall back gracefully.

**Why it matters:** Brute-force attacks on login, exhaustion attacks on pattern analysis. Without tests, a deployment regression could silently disable rate limiting. The `/auth` endpoint (high-value target) has a low limit; verify it holds.

**Fix:** Create `backend/src/middleware/__tests__/rateLimiter.test.ts` with tests for: (1) requests within limit pass, (2) requests exceeding limit get 429, (3) limits reset per window, (4) Redis failure doesn't crash the server.

**Verifier:** `cd backend && npx vitest run src/middleware/__tests__/rateLimiter.test.ts`

**Eligible for --fix:** yes


### TEST-08 · HIGH · tests · impact H / effort H · status: OPEN

**Where:** `frontend/src/` (entire frontend, ~153 source files, 0 tests)

**Claim:** Frontend has no test infrastructure: no vitest/jest config, no test files, no linting. ESLint is not installed/configured, so `yarn lint` fails.

**Why it matters:** Frontend handles auth state (Zustand store with JWT), rule/pattern CRUD UI, and streaming AI search. No tests means UI regressions, state management bugs, and accessibility issues ship undetected. A missing auth state check could leak emails between users.

**Fix:** (1) Add ESLint config to `frontend/` (use `backend/.eslintrc.cjs` pattern). (2) Install vitest + React testing dependencies. (3) Write critical-path tests: auth state (login/logout/token refresh), pattern CRUD, rule execution flow, add-in integration. Start with component tests for high-risk pages: `/patterns`, `/rules`, `<PatternForm>`, `<RuleCard>`.

**Verifier:** `cd frontend && yarn lint` (should pass), then `cd frontend && yarn test` (should pass all tests)

**Eligible for --fix:** no — frontend test setup is major infrastructure work; eligible only after ESLint + vitest installed and first smoke tests pass.


### TEST-09 · MEDIUM · tests · impact M / effort L · status: OPEN

**Where:** `backend/src/auth/__tests__/requireAuth.test.ts:6-20` (single test case)

**Claim:** The `requireAuth` middleware has exactly one test: missing token. No tests for valid token parsing, expired token rejection, malformed JWT, or token from wrong issuer. Most of the code path is untested.

**Why it matters:** The test name comments on a regression ("used to throw, now fails via next()"), but the fix is never proven in normal flow. A token validation bug could grant access to the wrong user or miss an expired token.

**Fix:** Add tests to `requireAuth.test.ts`: (1) valid JWT is parsed and userId extracted, (2) expired JWT is rejected, (3) malformed JWT is rejected, (4) JWT signed with wrong secret is rejected.

**Verifier:** `cd backend && npx vitest run src/auth/__tests__/requireAuth.test.ts` (should pass all 5+ tests)

**Eligible for --fix:** yes


### TEST-10 · MEDIUM · tests · impact H / effort M · status: OPEN

**Where:** `backend/src/jobs/processors/` (12 job processors, 1 test file: embeddingReconcile.test.ts)

**Claim:** Of 12 BullMQ job processors (deltaSync, patternAnalysis, stagingProcessor, webhookEvents, contactsSync, etc.), only `embeddingReconcile` has a test (2 tests). The others — especially `webhookEvents`, `stagingProcessor`, `patternAnalysis` — are untested.

**Why it matters:** These are the steady-state workers. A bug in `webhookEvents` (writes rule execution results) or `stagingProcessor` (moves emails to staging folder) silently corrupts mailbox state and breaks the review flow. Each processor deserves at least a happy-path test.

**Fix:** Create tests for the 3 highest-risk processors: (1) `webhookEvents` — receives change notification, calls ruleEngine, executes actions, (2) `stagingProcessor` — moves email to staging, (3) `patternAnalysis` — detects pattern, suggests rule.

**Verifier:** `cd backend && npx vitest run src/jobs/processors/__tests__/` (should include tests for all 3 above)

**Eligible for --fix:** yes


## Checks

```csv
check_id,dim,status,score,max,note
TEST-01,tests,FAIL,0,5,deltaService untested; core incremental sync module
TEST-02,tests,FAIL,0,5,graphClient untested; all Graph API calls route through it
TEST-03,tests,FAIL,0,5,webhooks route untested; public endpoint processes all Graph notifications
TEST-04,tests,FAIL,0,3,auth routes (login/callback) untested; entry point to app
TEST-05,tests,FAIL,0,3,csrf middleware untested; security-critical token issuance and validation
TEST-06,tests,FAIL,0,2,errorHandler middleware untested; maps errors to HTTP responses
TEST-07,tests,FAIL,0,2,rateLimiter untested; enforces 20 req/min on auth, 100 on api
TEST-08,tests,FAIL,0,5,frontend completely untested; 153 source files, 0 tests, no linting
TEST-09,tests,FAIL,0,2,requireAuth tests incomplete; only 1 case, missing valid/expired/malformed token cases
TEST-10,tests,FAIL,0,3,11 of 12 job processors untested; only embeddingReconcile has tests
BACKEND-SUITE,tests,PASS,3,3,68 tests passing in 9 test files; backend tests run and pass cleanly
FRONTEND-SUITE,tests,NOT_EVALUATED,,3,no test script configured; no test infrastructure
```

## Summary

**Backend:** 68 tests pass, but critical gaps: deltaService, graphClient, webhooks, auth routes, CSRF, errorHandler, rateLimiter, job processors.

**Frontend:** 0 tests, no ESLint config.

**Top 3 gaps by risk:**
1. **deltaService** (CRITICAL) — incremental sync with Graph; silently skips emails on token rotation or pagination errors
2. **graphClient** (CRITICAL) — semaphore + token handling; a deadlock stops the entire app
3. **webhooks** (CRITICAL) — public endpoint; dedup/validation bugs cause duplicate rule execution or spoofed notifications
