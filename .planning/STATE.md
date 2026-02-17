# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-16)

**Core value:** Users never lose control of their email. The system observes, learns, suggests, and only acts with explicit approval -- and every action can be undone.
**Current focus:** Phase 5 - Pattern Intelligence (In Progress)

## Current Position

Phase: 5 of 8 (Pattern Intelligence)
Plan: 3 of 3 in current phase
Status: Phase Complete
Last activity: 2026-02-17 -- Completed 05-03 (Pattern suggestions UI and dashboard integration)

Progress: [████████████████░] ~75%

## Performance Metrics

**Velocity:**
- Total plans completed: 14
- Average duration: 4min
- Total execution time: 0.83 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-infrastructure-foundation | 3/3 | 15min | 5min |
| 02-authentication-token-management | 2/2 | 6min | 3min |
| 03-email-observation-pipeline | 3/3 | 9min | 3min |
| 04-frontend-shell-observation-ui | 3/3 | 11min | 4min |
| 05-pattern-intelligence | 3/3 | 9min | 3min |

**Recent Trend:**
- Last 5 plans: 04-02 (5min), 04-03 (3min), 05-01 (4min), 05-02 (2min), 05-03 (3min)
- Trend: Steady

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
- [03-01]: graphFetch uses native fetch with no retry logic -- BullMQ handles retries at job level
- [03-01]: Webhook handler returns 202 before clientState validation -- enqueue is fire-and-forget after response
- [03-01]: Subscriptions use users/{email}/messages resource path (not me/messages) since background jobs have no user context
- [03-01]: syncSubscriptionsOnStartup reused by periodic webhook-renewal job (same create-or-renew logic)
- [03-01]: Cloudflare Tunnel skipped by user -- webhook subscriptions will fail until tunnel is configured
- [03-02]: Copy metadata from prior events for deleted message notifications (message already gone from Graph)
- [03-02]: Move detection via parentFolderId comparison against most recent EmailEvent.toFolder
- [03-02]: Newsletter detection heuristic: presence of List-Unsubscribe header
- [03-02]: Flag detection uses EmailEvent query (no prior flagged event) rather than stored flag field
- [03-03]: deltaLinks stored in Redis with no TTL -- expire server-side via 410 Gone
- [03-03]: Well-known folder resolution via Graph API aliases (not name-matching from folder list)
- [03-03]: Delta sync treats all non-deleted messages as 'arrived' events
- [03-03]: Per-mailbox and per-folder error isolation prevents cascade failures in delta sync
- [04-01]: Path alias @/ added to both root tsconfig.json and tsconfig.app.json for shadcn compatibility
- [04-01]: AppRoot component with useAuth hook wraps all routes for session initialization
- [04-01]: API client auto-prefixes /api for non-auth paths, uses /auth paths as-is
- [04-01]: npm overrides for react-is to ensure React 19 compatibility with recharts
- [04-02]: Socket.IO emission centralized in saveEmailEvent -- all saves automatically emit to dashboard
- [04-02]: Kill switch at /api/user/preferences with dedicated userRouter (not nested in dashboard)
- [04-02]: Socket.IO useRef pattern prevents reconnection on re-renders
- [04-02]: AppShell renders Outlet directly for react-router nesting
- [04-03]: TanStack Table with manualSorting and manualPagination for server-driven data table
- [04-03]: shadcn ChartContainer wraps Recharts for consistent theming with OKLCH colors
- [04-03]: Sender breakdown shows top 10 from 20 API results to keep chart readable
- [04-03]: Timeline range toggle uses Button group (not tabs) for compactness
- [05-01]: Vitest chosen over Jest for ESM TypeScript compatibility (native ESM, no transforms needed)
- [05-01]: Shared pipeline builders (buildBaseMatchFilter, buildEvidenceAccumulator) reduce aggregation duplication
- [05-01]: Confidence minimum threshold of 50% before persisting patterns (noise reduction)
- [05-01]: Recency penalty uses 0.5x divergence weight with 0.85 floor factor
- [05-02]: POST /analyze route defined before /:id routes to prevent 'analyze' being captured as :id param
- [05-02]: Customize endpoint combines action modification and auto-approval in a single operation
- [05-02]: Dashboard patternsPending uses $in: ['detected', 'suggested'] with optional mailboxId filter
- [05-03]: PatternCard has condensed prop for dashboard use (hides evidence section)
- [05-03]: Client-side patternType filtering since backend API only supports status filter
- [05-03]: PendingSuggestionsSection is self-contained (fetches own data via usePatterns hook)
- [05-03]: Customize from dashboard navigates to /patterns (full dialog needs page context)

### Pending Todos

None yet.

### Blockers/Concerns

- Cloudflare Tunnel not yet configured -- skipped again in 03-01 by user decision ("skip tunnel"). Webhook subscriptions will fail until tunnel is operational. Steps: install cloudflared, create tunnel to localhost:8010, set GRAPH_WEBHOOK_URL in .env, disable Bot Fight Mode or add WAF Skip rule for /webhooks/graph. All webhook ingress code is ready and waiting.

## Session Continuity

Last session: 2026-02-17
Stopped at: Completed 05-03-PLAN.md (Pattern suggestions UI). Phase 05 complete (3/3 plans done). Ready for Phase 06.
Resume file: None
