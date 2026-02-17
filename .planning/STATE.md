# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-16)

**Core value:** Users never lose control of their email. The system observes, learns, suggests, and only acts with explicit approval -- and every action can be undone.
**Current focus:** Phase 2 - Authentication & Token Management (Complete)

## Current Position

Phase: 2 of 8 (Authentication & Token Management)
Plan: 2 of 2 in current phase
Status: Phase 2 Complete
Last activity: 2026-02-17 -- Completed 02-02 (Token refresh, admin routes, multi-mailbox)

Progress: [████░░░░░░] ~25%

## Performance Metrics

**Velocity:**
- Total plans completed: 5
- Average duration: 4min
- Total execution time: 0.35 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-infrastructure-foundation | 3/3 | 15min | 5min |
| 02-authentication-token-management | 2/2 | 6min | 3min |

**Recent Trend:**
- Last 5 plans: 01-02 (5min), 01-03 (5min), 02-01 (3min), 02-02 (3min)
- Trend: Steady/Improving

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: 8-phase build order follows strict dependency chain (infra -> auth -> observation -> frontend -> patterns -> automation -> polish -> add-in)
- [Roadmap]: Stack updated per research: Node.js 22, Express 5, React 19, Tailwind 4, Mongoose 8, BullMQ 5
- [Roadmap]: Redis must use `noeviction` policy (not `allkeys-lru`) for BullMQ compatibility
- [Roadmap]: MSAL cache must persist to MongoDB via ICachePlugin to survive container restarts
- [01-01]: Used nginxinc/nginx-unprivileged:alpine for non-root frontend container
- [01-01]: Frontend healthcheck must use 127.0.0.1 (not localhost) due to IPv6 resolution in alpine
- [01-01]: Both packages use ESM ("type": "module") for modern import/export
- [01-02]: Use plain config objects for BullMQ connections (avoids ioredis version mismatch with BullMQ's bundled ioredis)
- [01-02]: Named import { Redis } from ioredis for ESM compatibility with NodeNext module resolution
- [01-02]: Server startup sequence: connectDatabase -> Redis ping -> initializeSchedulers -> listen
- [01-03]: Factory functions for rate limiters (createAuthLimiter/createApiLimiter) -- Redis client unavailable at import time
- [01-03]: Graph API SELECT_FIELDS as central constant -- all future Graph calls must use buildSelectParam() for INFR-04
- [01-03]: Health endpoint treats subscriptions.active and tokens.healthy as informational, not gates for healthy/degraded
- [01-03]: Cloudflare Tunnel deferred to Phase 3 prerequisite (user decision)
- [02-01]: Signed JWT as OAuth state parameter instead of Redis nonce -- self-contained, no Redis lookup required
- [02-01]: Auth middleware applied at route level only, not as blanket server-level middleware
- [02-01]: Separate createLoginMsalClient (no cache plugin) vs createMsalClient (with cache plugin) for login vs post-login flows
- [02-02]: Token refresh queries ALL connected mailboxes (no expiry filter) -- MSAL acquireTokenSilent handles cache hits for still-valid tokens
- [02-02]: ProcessorMap pattern in queues.ts maps queue names to processor functions (real or placeholder)
- [02-02]: ConflictError (409) added to error handler for admin invite duplicate detection
- [02-02]: Multi-mailbox connect uses signed JWT state with userId for CSRF-safe cross-request context

### Pending Todos

None yet.

### Blockers/Concerns

- Azure AD app registration not yet created -- must be set up before Phase 2 can begin
- Cloudflare Tunnel not yet configured -- deferred from 01-03 by user decision, must be operational before Phase 3 webhook testing. Steps: create tunnel to localhost:8010, set GRAPH_WEBHOOK_URL in .env, disable Bot Fight Mode or add WAF Skip rule for /webhooks/graph

## Session Continuity

Last session: 2026-02-17
Stopped at: Completed 02-02-PLAN.md (Token refresh, admin routes, multi-mailbox). Phase 2 complete. Ready for Phase 3.
Resume file: None
