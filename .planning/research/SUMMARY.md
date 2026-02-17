# Project Research Summary

**Project:** MSEDB — Microsoft Email Intelligence & Automation Portal
**Domain:** Microsoft 365 Email Monitoring, Pattern Detection & Mailbox Automation
**Researched:** 2026-02-16
**Confidence:** HIGH

## Executive Summary

MSEDB is a self-hosted email intelligence portal that observes Microsoft 365 mailbox behavior via the Microsoft Graph API, detects repetitive user actions (deletes, moves, archives) through statistical pattern analysis, and proposes mailbox automation rules for user approval. The product occupies a gap between opaque consumer tools (SaneBox, Clean Email) and complex enterprise Exchange administration — offering behavior-learned automation with full transparency and a robust safety model. Experts build this type of system using a webhook-first event pipeline with delta query fallback, a queued async processing architecture, and a strict user-approval gate before any automation fires.

The recommended approach is a Docker Compose stack running an Express.js/Node.js backend, React/Vite frontend, MongoDB for event and pattern storage, Redis for job queuing and caching, and BullMQ for all background processing. The Microsoft Graph API (with MSAL OAuth 2.0) is the sole external integration surface. The architecture separates concerns into distinct layers: ingestion (webhooks + delta sync), intelligence (pattern detection engine), automation (rule engine + staging manager), and real-time feedback (Socket.IO). Build order must be strictly dependency-driven — auth before Graph access, observation before pattern detection, patterns before automation.

The principal risks are infrastructure-level: webhook subscriptions silently expire without proper lifecycle management, MSAL token caches are lost on container restart without persistent storage, and Graph API throttling creates cascading failures under multi-user load. All three must be addressed in Phase 1 before any user-facing features are built. The staging folder grace period and mandatory user approval gate are non-negotiable trust mechanisms — removing either destroys the product's value proposition. The core differentiator is transparent, explainable automation (confidence scores, sample evidence, visible staging) rather than black-box sorting.

---

## Key Findings

### Recommended Stack

The stack is well-established and highly compatible. Node.js 22 LTS is the correct runtime (Node 20 EOL is April 2026 — too close for a greenfield project). Express 5.2.x is now the npm stable default. TypeScript 5.9.x covers both frontend and backend. React 19 with Vite 6 is the correct frontend target — Next.js is unnecessary for a pure SPA dashboard with no SEO or SSR requirements. MongoDB 7 is the right database given the document-model fit of email events and patterns; BullMQ 5.x backed by Redis 7.4 handles all seven background jobs. Socket.IO 4.x handles real-time dashboard updates. All components have confirmed cross-version compatibility (see STACK.md compatibility matrix).

**Core technologies:**
- **Node.js 22 LTS + Express 5.2.x**: Backend runtime and HTTP framework — chosen over Node 20 (EOL too soon) and Fastify (fewer MSAL/Graph examples)
- **React 19 + Vite 6 + Tailwind 4 + shadcn/ui**: Frontend — SPA-appropriate, no Next.js overhead; shadcn/ui fully supports Tailwind v4 and React 19
- **MongoDB 7 + Mongoose 8**: Primary persistence — document model maps naturally to email events, patterns, and rules; change streams available
- **Redis 7.4 + BullMQ 5.x**: Job queue and cache — BullMQ handles all 7 background jobs; Redis 7.x avoids the RSALv2 licensing changes in Redis 8
- **@azure/msal-node 3.8.7 + @microsoft/microsoft-graph-client 3.0.7**: Auth and Graph access — stable GA versions; avoid msal-node 5.x (unclear GA status) and msgraph-sdk (still preview)
- **Zustand 5 + TanStack Query 5**: Frontend state — eliminates Redux; Zustand for UI state, TanStack Query for server state
- **Socket.IO 4.8.x**: Real-time dashboard updates — JWT-authenticated, per-user rooms
- **Zod 4 + jose 6 + BullMQ Job Schedulers API**: Validation, JWTs, and scheduled jobs respectively

**Critical version notes:** Use `noeviction` Redis policy (not `allkeys-lru`) — BullMQ requires it. Use `redis:7-alpine` Docker image. Use `mongo:7` image. Use `node:22-alpine` for both backend and frontend build stages. Avoid Vite 8 beta (Rolldown, experimental) and TS 6+ (stability).

### Expected Features

The product must implement a full observation-to-automation pipeline with a user-approval gate at every decision point. No rule creation without explicit approval is the non-negotiable product principle.

**Must have (table stakes — v1.0 MVP):**
- OAuth 2.0 SSO with Microsoft 365 via MSAL — users will not create separate credentials
- Email event observation via webhooks + delta query fallback — the data pipeline that enables everything else
- Sender-level and folder routing pattern detection with confidence scoring — minimum viable intelligence
- Pattern review and approval UI — the trust gate; no automation fires without this
- Rule creation and management (CRUD + priority ordering)
- Staging folder with 24-hour grace period — automated deletes held before execution
- Kill switch (pause all automation) — must be visible in persistent top navigation, not buried in settings
- Whitelist (sender + domain) — protection for important senders
- Undo mechanism (48-hour window) — recovery from mistakes
- Audit log with filterable history
- Basic dashboard with stats (emails processed, rules fired, pending suggestions)
- Admin user management (invite, deactivate, role assignment)
- Settings page (connection status, preferences, whitelist management)
- Data export and deletion

**Should have (differentiators — v1.x, add after validation):**
- Subject pattern normalization + detection — requires custom NLP-lite normalization engine
- Confidence scoring with visual sample evidence ("You kept 5 of 100 emails from this sender — here are the 5")
- Transparent staging folder with visible countdown timers (unique vs. SaneBox's opaque BlackHole)
- Time-based pattern detection (weekday vs. weekend behavior differences)
- Composite pattern detection (sender + subject + time conditions)
- Rule health monitoring with auto-retirement when undo rate exceeds threshold
- Real-time activity feed via Socket.IO
- Multi-action rules (move + mark read + categorize simultaneously)
- Admin aggregate analytics (org-wide time saved, rule adoption rates)
- Daily email digest with actionable rescue links for staged emails

**Defer (v2+):**
- Auto-responses / email drafting (requires Mail.Send permission, separate architecture)
- AI-powered categorization via LLM (privacy/cost concerns; heuristic metadata analysis is sufficient for Phase 1)
- Shared/team mailbox support (requires application-level Graph permissions, different data model)
- Cross-user pattern sharing (privacy design required)
- Outlook add-in (Office.js — entirely separate frontend stack)
- Multi-tenant SaaS with billing

**Anti-features to explicitly reject:** Email body content analysis (privacy liability), auto-unsubscribe (phishing vectors), auto-rule creation without approval (destroys trust), real-time sub-second rule execution promises (Graph webhooks have inherent latency).

### Architecture Approach

The system is organized into five layers within a single Docker Compose stack: Ingestion (webhook receiver + delta sync), Processing (event collector, metadata extractor, rule engine), Intelligence (pattern detection engine, confidence scorer, subject normalizer), Background (BullMQ job workers for renewal, sync, analysis, staging, tokens, digest), and Real-Time (Socket.IO per-user rooms). The frontend is a separate nginx container serving the React SPA and reverse-proxying `/api`, `/auth`, `/webhooks`, and `/socket.io` to the backend. Cloudflare Tunnel provides HTTPS termination for the public webhook endpoint. The build order is strictly dependency-driven: infrastructure → auth → observation → frontend shell → pattern intelligence → automation → polish.

**Major components:**
1. **Webhook Receiver** — accepts Graph notifications within 3 seconds, validates clientState, enqueues to BullMQ immediately (zero Graph API calls in handler)
2. **Event Collector + Metadata Extractor** — normalizes webhook and delta payloads into EmailEvent documents; deduplicates by userId + messageId + eventType
3. **Pattern Detection Engine** — daily BullMQ job; statistical aggregation over 30-day sliding window; sender, subject, folder routing, and composite analysis with threshold gating (85-98% depending on action risk)
4. **Rule Engine** — priority-ordered first-match-wins evaluation; check automationPaused, then whitelist, then rules; routes to staging or direct execution
5. **Staging Manager** — moves emails to "MSEDB Staging" folder; BullMQ stagingProcessor executes expired items every 30 minutes; user can rescue at any time
6. **Token Manager** — AES-256-GCM encrypted refresh token storage in MongoDB; custom MSAL cache plugin for persistence across container restarts; proactive refresh every 45 minutes
7. **BullMQ Job Workers** — 7 cron jobs: webhookRenewal (2h), deltaSync (15m), patternAnalysis (2AM daily), stagingProcessor (30m), tokenRefresh (45m), dailyDigest (8AM), plus on-demand jobs

### Critical Pitfalls

1. **Webhook subscription silent expiry** — Subscriptions expire after 7 days. Renewal job must run on startup AND every 2 hours. Implement `lifecycleNotificationUrl` on every subscription (cannot be added after creation). Health endpoint must report subscription status. Prevention: startup check + proactive renewal + lifecycle events.

2. **MSAL token cache lost on container restart** — MSAL's in-memory cache is destroyed on every `docker restart`. All background jobs fail until cache is re-hydrated. Prevention: implement MSAL `ICachePlugin` persisting to MongoDB; or bypass MSAL cache entirely and always call `acquireTokenByRefreshToken` directly from encrypted MongoDB storage.

3. **Webhook event race conditions and data loss** — Graph requires 202 response within 3 seconds; webhooks have at-least-once delivery (duplicates); events arrive out of order. Prevention: return 202 immediately (zero processing in handler), dedup by userId+messageId+eventType, Redis lock for per-user rule evaluation serialization, BullMQ concurrency 1 per user.

4. **Pattern detection false positives destroy trust** — Domain-level patterns mask important sub-senders (LinkedIn = notifications AND job offers). Delete suggestions require 98%+ confidence AND composite criteria. Surface the exceptions explicitly to users. Default aggressiveness to conservative (95%+ confidence). The staging grace period is the last line of defense.

5. **BullMQ Redis eviction policy misconfiguration** — Redis configured with `allkeys-lru` (the natural default for a cache) silently evicts BullMQ job keys, causing jobs to vanish without error. Must use `noeviction`. Manage memory via `removeOnComplete`/`removeOnFail` with age limits on all queues.

6. **Graph API throttling cascade** — Per-app-per-tenant throttle limits aggregate across all users. 50 users on Monday morning can trigger tenant-wide 429 responses. Prevention: centralized Redis rate limiter tracking aggregate calls, batch requests ($batch, up to 20 per call), `$select` on all Graph calls, `Retry-After` propagated to all pending workers.

7. **Staging folder becomes invisible** — Users don't check a "MSEDB Staging" folder in Outlook. Prevention: Socket.IO push notification when items enter staging, prominent badge on nav item, staging count on dashboard home, actionable rescue links in daily digest, alert if user hasn't checked staging in 7 days.

---

## Implications for Roadmap

Based on research, a 7-phase build order is strongly indicated by component dependencies. Each phase must produce a testable, working system before the next begins.

### Phase 1: Infrastructure Foundation
**Rationale:** MongoDB, Redis, Docker Compose, and health endpoints must exist before any other component can be built. Nothing depends on having users or Graph access — but everything depends on having containers and persistence.
**Delivers:** Running Docker Compose stack (backend, frontend shell, MongoDB, Redis), health endpoint, Mongoose models with all indexes defined, database and Redis connections with retry logic
**Addresses:** Core persistence layer for all subsequent features
**Avoids:** MongoDB index pitfall (compound indexes must be in schema from day one, not retrofitted), Redis eviction policy misconfiguration (set `noeviction` before first deployment), named Docker volumes for Redis data persistence

### Phase 2: Authentication and Token Management
**Rationale:** Every Graph API call and every authenticated API endpoint requires working OAuth. This is the single most risky module — MSAL token persistence across container restarts must be solved here, not discovered later when users lose their sessions.
**Delivers:** MSAL OAuth 2.0 flow (/auth/login → callback → JWT → /auth/me), custom MSAL cache plugin persisting to MongoDB, encrypted refresh token storage (AES-256-GCM), requireAuth + requireAdmin middleware, token proactive refresh job scaffold
**Addresses:** OAuth SSO (table stakes), admin user management foundation
**Avoids:** MSAL cache loss on container restart (Pitfall 7), delegated token expiry breaking background processing (Pitfall 2) — both must be solved before any Graph calls are made
**Research flag:** MSAL custom ICachePlugin implementation has sparse documentation for MongoDB backends; may need implementation research during this phase

### Phase 3: Email Observation Pipeline
**Rationale:** Cannot detect patterns without events. Observation must be proven working — with full renewal, lifecycle handling, and delta fallback — before building any intelligence on top. The webhook architecture is the most complex infrastructure decision and must be validated with real traffic before committing to pattern detection.
**Delivers:** Graph client factory (per-user authenticated), webhook subscription service with lifecycleNotificationUrl, webhook handler (202 + BullMQ async, zero blocking), event collector with deduplication, delta sync service with deltaLink caching in Redis, BullMQ jobs: webhookRenewal (2h), deltaSync (15m), tokenRefresh (45m), metadata extractor (header parsing, subject normalization prep)
**Addresses:** Email event observation (table stakes), webhook + delta fallback (required for all intelligence)
**Avoids:** Webhook subscription expiry (Pitfall 1 — lifecycleUrl + startup check + renewal job all built here), webhook race conditions (Pitfall 3 — 202 + dedup + Redis lock), Graph throttling (Pitfall 6 — centralized rate limiter wraps all Graph calls)

### Phase 4: Frontend Shell and Observation UI
**Rationale:** Developers need visual feedback that observation is working. Building the frontend shell here — before patterns and automation — lets the team verify the data pipeline is collecting real events. It also validates the Socket.IO real-time connection and the JWT auth flow in the React app.
**Delivers:** React 19 + Vite 6 + Tailwind 4 + shadcn/ui setup, auth flow (login page, JWT storage, protected routes), main layout (sidebar + topbar with kill switch visible), dashboard page (stats cards, event count), email activity page (events table, filters), Socket.IO client integration (useWebSocket hook, real-time email:event display)
**Addresses:** Basic dashboard with stats (table stakes), settings page foundation, kill switch in persistent navigation
**Avoids:** Kill switch hidden in settings (UX pitfall — must be in top nav from initial layout build)

### Phase 5: Pattern Intelligence
**Rationale:** Pattern detection requires accumulated EmailEvents to analyze (need 10+ events per sender). By Phase 5, the observation pipeline has been running and there is data to analyze. Subject normalization must be built before subject pattern detection can work.
**Delivers:** Subject normalizer (variable replacement for numbers/dates/UUIDs), confidence scorer (statistical base + bonuses + asymmetric risk penalties for delete vs. move), pattern detector (sender, folder routing, subject, composite), daily BullMQ pattern analysis job (2AM cron), frontend Patterns page (pattern cards with confidence %, sample size, exceptions, approve/reject/customize)
**Addresses:** Sender-level pattern detection (table stakes), folder routing detection (table stakes), confidence scoring with transparency (differentiator), pattern review and approval UI (table stakes)
**Avoids:** Pattern false positives (Pitfall 4 — asymmetric confidence thresholds: 98%+ for delete vs. 85% for move; exceptions surfaced in UI; 14-day minimum observation period before first suggestions)
**Research flag:** Subject normalization engine is a custom component with no off-the-shelf library. Regex/NLP-lite approach needs design during planning. Standard patterns apply; low research risk.

### Phase 6: Automation and Safety
**Rationale:** Automation is the riskiest phase — it writes to users' mailboxes. It must be built after observation and patterns are stable and verified. The staging system and undo mechanism are safety-critical and must be complete before rule execution fires on any real email.
**Delivers:** Rule engine (priority-ordered matching, whitelist check, automationPaused check, condition evaluation, first-match-wins), staging manager (MSEDB Staging folder creation via Graph, grace period, StagedEmail documents), BullMQ stagingProcessor (30m cron), undo service (48-hour reversal window), frontend: Rules page (list + reorder + create wizard from pattern), Staging page (countdown timers + rescue + batch execute), Audit log page (history + undo button in each row)
**Addresses:** Rule creation and management (table stakes), staging folder grace period (table stakes + differentiator), kill switch integration with rule engine, undo mechanism (table stakes), audit log (table stakes)
**Avoids:** Staging folder black hole (Pitfall 5 — Socket.IO notifications + dashboard badge + rescue links built alongside staging manager, not after), auto-rule creation without approval (anti-feature — never implemented)

### Phase 7: Polish, Notifications, and Admin
**Rationale:** Settings, notifications, admin panel, and daily digest are non-critical-path features. They improve the experience but do not affect the core observation-to-automation pipeline. Building them last allows the team to focus on correctness first.
**Delivers:** Settings page (preferences, aggressiveness level, whitelist management, connection status, token health), notification system (in-app bell, Socket.IO push, read/unread state), daily digest BullMQ job (8AM cron, timezone-aware, per-user scheduling), admin panel (user invite/deactivate/role, org-wide rules, aggregate health dashboard including subscription status and token health), error handling hardening (Graph 429 global throttle mode, Retry-After propagation), docker-compose.dev.yml with hot reload
**Addresses:** Notification system (table stakes), admin user management (table stakes), user settings (table stakes), data export/deletion (table stakes), rule health monitoring (v1.x differentiator)
**Avoids:** Daily digest timezone pitfall (UX — must be per-user timezone-aware from implementation), Azure AD client secret expiry visibility (admin health dashboard shows secret expiry date)

### Phase Ordering Rationale

- **Infrastructure before auth:** MongoDB and Redis must exist for MSAL cache persistence and BullMQ; you cannot validate the token manager without a database.
- **Auth before observation:** All Graph API calls use per-user authenticated clients; the token manager must be proven reliable before webhook subscriptions are created.
- **Observation before intelligence:** Patterns require event history. Running observation for even a few days with test accounts validates the pipeline before committing to the pattern engine design.
- **Frontend shell in Phase 4 (not Phase 7):** Embedding frontend during the observation phase provides immediate visual validation of event collection and Socket.IO. Deferring UI entirely creates a long blind-spot period where data pipeline bugs are invisible.
- **Intelligence before automation:** Patterns drive rule suggestions. Rule creation from scratch (without pattern backing) is table-stakes but lower value than the learned automation path. Building intelligence first also surfaces any schema or data issues before the automation layer takes dependencies on pattern data.
- **Automation last among core phases:** Writing to user mailboxes is irreversible. Building automation only after observation and intelligence are stable minimizes the risk that a pipeline bug causes incorrect automated actions.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (Authentication):** MSAL `ICachePlugin` for MongoDB is sparsely documented. The alternative approach (bypass MSAL cache, always call `acquireTokenByRefreshToken`) needs a proof-of-concept before committing to one approach. Medium-risk implementation detail.
- **Phase 3 (Observation):** Cloudflare Tunnel bot protection rules blocking Graph API webhook POSTs is a known issue. Research bypass configuration for `/webhooks/graph` path before deployment.
- **Phase 5 (Pattern Intelligence):** Subject normalization engine is custom-built with no reference implementation. The regex tokenization approach (numbers, dates, UUIDs, order IDs) needs design validation against a sample of real email subjects before coding.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Infrastructure):** Docker Compose, MongoDB, Redis — well-documented, established patterns. No research needed.
- **Phase 4 (Frontend Shell):** React 19 + Vite + Tailwind + shadcn/ui — fully documented, standard SPA setup.
- **Phase 6 (Automation):** Rule engine logic and Graph API write operations (move, delete, categorize) are fully documented. Standard patterns apply.
- **Phase 7 (Polish):** Settings, notifications, admin — standard CRUD patterns; BullMQ timezone scheduling is documented.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All version choices verified via official npm registries and release announcements. Compatibility matrix confirmed. One medium-confidence item: @azure/msal-node 5.x GA status unclear — use 3.8.7. |
| Features | HIGH | Microsoft Graph API capabilities (messageRule predicates, actions) verified against official docs. Competitor analysis cross-referenced across multiple sources. Feature dependencies are internally consistent and grounded in PRD requirements. |
| Architecture | HIGH | Webhook behavior (3-second deadline, throttle thresholds, subscription lifetimes) verified against official Microsoft Graph docs. BullMQ patterns verified against official BullMQ docs. One medium-confidence area: MSAL confidential client token caching implementation details vary by version. |
| Pitfalls | HIGH | Critical pitfalls (webhook expiry, token persistence, Redis eviction) verified against official documentation and known GitHub issues. UX pitfalls derived from competitor analysis and standard product design patterns. |

**Overall confidence:** HIGH

### Gaps to Address

- **MSAL token persistence approach**: Two implementation options exist (ICachePlugin vs. direct acquireTokenByRefreshToken). Both are valid; the choice affects the token manager design significantly. Decide and prototype in Phase 2 before building dependent services.
- **Application permissions vs. delegated permissions for background jobs**: Using `/users/{id}/messages` with application permissions is more reliable for 24/7 background processing than delegated `/me/messages` (which depends on user refresh token health). Requires admin consent from Azure AD admin. The PRD Setup Guide mentions this as optional. Should be evaluated as a default architecture choice, not an afterthought.
- **Daily digest email delivery**: FEATURES.md notes a conflict — Phase 1 defers Mail.Send permission, but daily digest requires email sending. Options: request Mail.Send upfront (simpler), use an external service (SendGrid/SES, adds dependency), or make digest in-app-only for MVP. Decision needed before Phase 7.
- **Staging folder naming**: "MSEDB Staging" is visible to users in Outlook. Consider allowing user-customizable folder name or choosing a more neutral name like "Email Review" from the start. Changing folder names later requires migrating existing staged emails.
- **Multi-domain tenant handling**: Users from aptask.com, jobtalk.ai, yenom.ai, and hudosndatallc.com share one MSEDB instance. Pattern analysis must partition strictly by userId, not by email domain. Verify this assumption is enforced in all aggregation queries.

---

## Sources

### Primary (HIGH confidence)
- [Microsoft Graph subscription resource type](https://learn.microsoft.com/en-us/graph/api/resources/subscription?view=graph-rest-1.0) — subscription lifetimes, max 10,080 minutes for Outlook messages
- [Microsoft Graph Lifecycle Notifications](https://learn.microsoft.com/en-us/graph/change-notifications-lifecycle-events) — subscriptionRemoved, reauthorizationRequired, missed event handling
- [Microsoft Graph Webhook Delivery](https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks) — 3-second response requirement, throttle thresholds (10%/>10s = slow, 15%/>10s = drop)
- [Microsoft Graph Delta Query for Messages](https://learn.microsoft.com/en-us/graph/delta-query-messages) — deltaLink handling, @removed annotations, $select/$filter support
- [Microsoft Graph Throttling](https://learn.microsoft.com/en-us/graph/throttling) and [Service-specific limits](https://learn.microsoft.com/en-us/graph/throttling-limits) — per-app/per-tenant limits
- [Microsoft Graph messageRule resource](https://learn.microsoft.com/en-us/graph/api/resources/messagerule?view=graph-rest-1.0) — 28+ predicates, 11 actions confirmed
- [MSAL Node Token Caching](https://learn.microsoft.com/en-us/entra/msal/javascript/node/caching) — persistent cache requirements for confidential clients
- [BullMQ Documentation](https://docs.bullmq.io) — Job Schedulers API, noeviction requirement, production guidance
- Node.js, Express, React, TypeScript, MongoDB, Redis official release pages — version verification

### Secondary (MEDIUM confidence)
- [SaneBox Features](https://www.sanebox.com/learn) and [Clean Email Features](https://clean.email/features) — competitor feature comparison
- [@azure/msal-node npm page](https://www.npmjs.com/package/@azure/msal-node) — v3.8.7 stable status (v5.x GA unclear)
- [Cloudflare community: Inconsistent Webhook Behavior Through Cloudflare Tunnel](https://community.cloudflare.com/t/inconsistent-webhook-behavior-through-cloudflare-tunnel-need-help/816846) — bot protection blocking webhooks
- [BullMQ GitHub issue #366](https://github.com/taskforcesh/bullmq/issues/366) — job return value memory accumulation

### Tertiary (LOW confidence)
- SaneBox vs. Clean Email comparison articles — used for cross-reference only, not primary competitive analysis
- Third-party Outlook rules guides — verified against official Microsoft docs before use

---

*Research completed: 2026-02-16*
*Ready for roadmap: yes*
