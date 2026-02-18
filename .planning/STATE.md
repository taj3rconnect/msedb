# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-16)

**Core value:** Users never lose control of their email. The system observes, learns, suggests, and only acts with explicit approval -- and every action can be undone.
**Current focus:** Phase 7 in progress -- Backend APIs and shadcn components complete

## Current Position

Phase: 7 of 8 (Polish, Notifications & Admin)
Plan: 1 of 3 in current phase
Status: In progress
Last activity: 2026-02-18 -- Plan 07-01 complete (notification service, settings routes, admin extensions, shadcn components)

Progress: [██████████████████░░] ~88%

## Performance Metrics

**Velocity:**
- Total plans completed: 22
- Average duration: 4min
- Total execution time: 1.13 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-infrastructure-foundation | 3/3 | 15min | 5min |
| 02-authentication-token-management | 2/2 | 6min | 3min |
| 03-email-observation-pipeline | 3/3 | 9min | 3min |
| 04-frontend-shell-observation-ui | 3/3 | 11min | 4min |
| 05-pattern-intelligence | 3/3 | 9min | 3min |
| 06-automation-safety | 6/6 | 27min | 5min |
| 07-polish-notifications-admin | 1/3 | 3min | 3min |

**Recent Trend:**
- Last 5 plans: 06-04 (3min), 06-05 (4min), 06-06 (5min), 06-fix (2min), 07-01 (3min)
- Trend: Steady

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
- [06-02]: Move/archive actions automatically paired with markRead as secondary action (common user pattern)
- [06-02]: Conversion is idempotent: calling twice for same pattern returns existing rule
- [06-02]: Undo reverses actions in reverse order for correctness (last action undone first)
- [06-02]: 404 from Graph API treated as partial undo success, not failure (message may be purged by Exchange)
- [Phase 06-01]: Org-wide whitelist stored in Redis Sets for O(1) lookup without extra Mongo queries
- [Phase 06-01]: StagedEmail TTL uses cleanupAt = expiresAt + 7 days to prevent premature auto-deletion
- [Phase 06-01]: Action executor breaks on 404 (message gone) rather than continuing to next action
- [Phase 06-01]: Socket.IO staging notifications wrapped in try/catch for worker process compatibility
- [Phase 06-03]: PUT /reorder defined before PUT /:id to prevent Express param capture
- [Phase 06-03]: Auto-convert patterns to rules on approve/customize with try-catch (failure non-blocking)
- [Phase 06-03]: Org-whitelist routes defined before /:id routes on mailbox router
- [Phase 06-03]: Batch execute uses Promise.allSettled in chunks of 5 for concurrency control
- [Phase 06-04]: Staging processor uses chunked Promise.allSettled (batches of 5) for concurrency control
- [Phase 06-04]: Rule evaluation runs inline with webhook processing (not separate queue) for low latency
- [Phase 06-04]: Rule evaluation errors isolated -- email event recording continues even if automation fails
- [Phase 06-04]: Removed createProcessor placeholder; all 6 BullMQ queues now have production processors
- [Phase 06-05]: Drag handle on GripVertical icon only (not entire card) to preserve click/toggle interactions
- [Phase 06-05]: Optimistic local state in RuleList for instant visual reorder feedback
- [Phase 06-05]: PointerSensor with 5px activation distance to prevent accidental drags
- [Phase 06-05]: Action badges color-coded by type (move=blue, delete=red, markRead=green, etc.)
- [Phase 06-06]: useCountdown hook updates every 60s (not per-second) for performance; green >12h, yellow 4-12h, red <4h
- [Phase 06-06]: AlertDialog confirmation required before Execute Now (single and batch) -- destructive action
- [Phase 06-06]: Undo eligibility guard: undoable + within 48 hours + not already undone
- [Phase 06-06]: Staging count badge auto-refreshes via 60s refetchInterval and Socket.IO staging:new event
- [Phase 06-fix]: undoService reads messageId from details with targetId fallback; audit creators include messageId+originalFolder in details
- [Phase 07-01]: Field-level $set for user preferences prevents kill switch overwrite (only provided fields updated)
- [Phase 07-01]: Rule.mailboxId optional (required: false) for org-scoped rules -- cleaner than per-mailbox duplication
- [Phase 07-01]: notificationService wraps Socket.IO emit in try/catch for worker process/test compatibility
- [Phase 07-01]: Data export limits EmailEvents to 10,000 and AuditLogs to 5,000 for timeout prevention

### Pending Todos

None yet.

### Blockers/Concerns

- Cloudflare Tunnel not yet configured -- skipped again in 03-01 by user decision ("skip tunnel"). Webhook subscriptions will fail until tunnel is operational. Steps: install cloudflared, create tunnel to localhost:8010, set GRAPH_WEBHOOK_URL in .env, disable Bot Fight Mode or add WAF Skip rule for /webhooks/graph. All webhook ingress code is ready and waiting.

## Session Continuity

Last session: 2026-02-18
Stopped at: Completed 07-01-PLAN.md
Resume file: None
