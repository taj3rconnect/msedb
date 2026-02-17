# Roadmap: MSEDB

## Overview

MSEDB delivers a self-hosted email intelligence portal that connects to Microsoft 365 mailboxes, observes user behavior, detects repetitive patterns, and automates email actions with explicit user approval. The build follows a strict dependency chain: infrastructure and persistence must exist before authentication, authentication before Graph API access, observation before intelligence, intelligence before automation. Each phase produces a testable, working system. The Outlook Add-in ships last as a separate client consuming the established backend API.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Infrastructure Foundation** - Docker Compose stack with MongoDB, Redis, health endpoints, and all Mongoose models (completed 2026-02-17)
- [x] **Phase 2: Authentication & Token Management** - Azure AD OAuth 2.0 SSO, JWT sessions, encrypted token storage, multi-mailbox connections (completed 2026-02-17)
- [ ] **Phase 3: Email Observation Pipeline** - Webhook subscriptions, delta query fallback, event collection, metadata extraction, background jobs
- [ ] **Phase 4: Frontend Shell & Observation UI** - React SPA with auth flow, dashboard, email activity page, Socket.IO real-time updates
- [ ] **Phase 5: Pattern Intelligence** - Sender and folder routing pattern detection, confidence scoring, pattern review and approval UI
- [ ] **Phase 6: Automation & Safety** - Rule engine, staging folder, undo mechanism, whitelist enforcement, kill switch integration, audit log
- [ ] **Phase 7: Polish, Notifications & Admin** - Settings page, admin panel, notification system, and remaining UI pages
- [ ] **Phase 8: Outlook Add-in** - Office Add-in with sender/domain whitelist/blacklist actions and Azure AD SSO

## Phase Details

### Phase 1: Infrastructure Foundation
**Goal**: A running, healthy Docker Compose stack with all persistence layers, background job infrastructure, security hardening, and the Cloudflare Tunnel for webhook ingress -- ready for authentication and Graph API integration
**Depends on**: Nothing (first phase)
**Requirements**: INFR-01, INFR-02, INFR-03, INFR-04, INFR-05
**Success Criteria** (what must be TRUE):
  1. `docker compose up` starts all four containers (backend, frontend shell, MongoDB, Redis) within resource limits (5 CPU / 5GB RAM) and all containers report healthy via health endpoints
  2. MongoDB connection is established with all Mongoose models registered, compound indexes created, and retry logic working (verified by restarting MongoDB container)
  3. Redis is configured with `noeviction` policy, BullMQ queues are initialized with `removeOnComplete`/`removeOnFail` age limits, and a test job can be enqueued and processed
  4. Cloudflare Tunnel is operational and forwards HTTPS traffic to the backend webhook endpoint, with bot protection bypassed for `/webhooks/graph`
  5. Health endpoint at `/api/health` reports status of all services (MongoDB, Redis, container uptime) and rate limiting is enforced on all API routes
**Plans**: 3 plans

Plans:
- [ ] 01-01-PLAN.md — Docker Compose stack, Dockerfiles, Express 5 backend skeleton, React 19 frontend shell
- [ ] 01-02-PLAN.md — MongoDB/Redis connections, 9 Mongoose models with indexes, BullMQ queues and job schedulers
- [ ] 01-03-PLAN.md — AES-256-GCM encryption, rate limiting, health endpoint, webhook handler, Cloudflare Tunnel

### Phase 2: Authentication & Token Management
**Goal**: Users can authenticate via Azure AD, maintain persistent sessions, connect multiple Microsoft 365 mailboxes, and have their tokens securely stored and proactively refreshed -- even across container restarts
**Depends on**: Phase 1
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06
**Success Criteria** (what must be TRUE):
  1. User clicks "Sign in with Microsoft" and completes the Azure AD OAuth 2.0 flow, landing on a protected dashboard page with a valid JWT session stored in an httpOnly cookie
  2. User's session persists across browser refresh, and the backend's `requireAuth` middleware rejects requests without a valid JWT
  3. Admin can invite users by email, assign roles (Admin/User), and `requireAdmin` middleware blocks non-admin users from admin-only routes
  4. After `docker restart msedb-backend`, all users' Graph API access continues working without re-authentication (MSAL cache persisted to MongoDB, encrypted refresh tokens intact)
  5. A single user can connect multiple mailboxes (e.g., taj@aptask.com and taj@jobtalk.ai) via separate OAuth consent flows, with each mailbox maintaining independent tokens and the UI clearly labeling which mailbox is which
**Plans**: 2 plans

Plans:
- [ ] 02-01-PLAN.md — MSAL OAuth flow, JWT sessions, auth middleware, ICachePlugin, token manager
- [ ] 02-02-PLAN.md — Token refresh worker, admin user management, multi-mailbox connection flow

### Phase 3: Email Observation Pipeline
**Goal**: The system observes email activity in real-time via webhooks with delta query fallback, collecting deduplicated metadata events for every connected mailbox -- the data foundation for all intelligence and automation
**Depends on**: Phase 2
**Requirements**: OBSV-01, OBSV-02, OBSV-03, OBSV-04
**Success Criteria** (what must be TRUE):
  1. When a user receives, moves, or deletes an email in Outlook, a webhook notification arrives at the backend within seconds and an EmailEvent document appears in MongoDB with correct metadata (sender, subject, folder, timestamp, action type) -- never body content
  2. Webhook subscriptions include `lifecycleNotificationUrl`, renew automatically every 2 hours, and recover from `subscriptionRemoved` and `missed` lifecycle events by re-creating subscriptions and running immediate delta sync
  3. Delta query runs every 15 minutes per mailbox per folder, catches events missed by webhooks, and stores deltaLinks in Redis -- with fallback to full sync on expired delta tokens (410 Gone)
  4. Duplicate events are rejected via the compound index on userId + mailboxId + messageId + eventType, and the webhook handler returns 202 within 3 seconds with zero blocking (all processing via BullMQ)
**Plans**: TBD

Plans:
- [ ] 03-01: Graph client factory, webhook subscription service, webhook handler
- [ ] 03-02: Event collector, metadata extractor, deduplication
- [ ] 03-03: Delta sync service, BullMQ jobs (webhook renewal, delta sync, token refresh)

### Phase 4: Frontend Shell & Observation UI
**Goal**: Users can log in to the React dashboard, see real-time email activity stats, browse collected events, and verify the observation pipeline is working -- with the kill switch visible in persistent navigation from day one
**Depends on**: Phase 2, Phase 3
**Requirements**: DASH-01, DASH-02, PAGE-01
**Success Criteria** (what must be TRUE):
  1. User logs in via the React app, sees a dashboard with stats cards (emails processed, per-mailbox counts) and an activity feed showing recent email events, with per-mailbox and aggregate views
  2. When a new email event is collected by the backend, it appears on the dashboard within seconds via Socket.IO without requiring a page refresh
  3. Email activity page displays events in a filterable table with per-mailbox filters, event timeline, and sender breakdown -- paginated for performance
  4. Kill switch toggle is visible in the top navigation bar on every page (not buried in settings), and the main layout includes sidebar navigation to all future pages
**Plans**: TBD

Plans:
- [ ] 04-01: React + Vite + Tailwind + shadcn/ui setup, auth flow, protected routes
- [ ] 04-02: Layout, dashboard page, Socket.IO integration
- [ ] 04-03: Email activity page with filters and real-time updates

### Phase 5: Pattern Intelligence
**Goal**: The system detects sender-level and folder routing patterns from accumulated email events, scores confidence with asymmetric risk thresholds, and presents actionable suggestions that users can approve, reject, or customize
**Depends on**: Phase 3, Phase 4
**Requirements**: PATN-01, PATN-02, PATN-03, PATN-04, PAGE-02
**Success Criteria** (what must be TRUE):
  1. After 14+ days of observation with 10+ events per sender, the pattern detection engine identifies sender-level patterns (e.g., "you delete 97 of 100 emails from this sender") and folder routing patterns (e.g., "you always move emails from this sender to Archive")
  2. Confidence scoring applies asymmetric thresholds: 98%+ for delete suggestions, 85%+ for move suggestions -- with bonuses for large sample sizes and penalties for recent behavior shifts
  3. Pattern suggestion cards on the Patterns page show confidence percentage, sample size, exception count, and sample evidence -- and the user can approve, reject, or customize each suggestion
  4. Rejected patterns enter a 30-day cooldown before being re-suggested, and the daily pattern analysis BullMQ job runs at 2 AM without blocking other background jobs
**Plans**: TBD

Plans:
- [ ] 05-01: Pattern detection engine (sender-level, folder routing), confidence scorer
- [ ] 05-02: Pattern analysis BullMQ job, pattern API endpoints
- [ ] 05-03: Patterns page UI with cards, confidence visualization, approve/reject/customize

### Phase 6: Automation & Safety
**Goal**: Approved patterns are converted into executable rules that the system evaluates against incoming email -- with a staging folder grace period, kill switch enforcement, whitelist protection, undo capability, and full audit logging ensuring no automated action is irreversible
**Depends on**: Phase 5
**Requirements**: AUTO-01, AUTO-02, AUTO-03, AUTO-04, SAFE-01, SAFE-02, SAFE-03, SAFE-04, SAFE-05, PAGE-03, PAGE-04, PAGE-05
**Success Criteria** (what must be TRUE):
  1. User approves a pattern and a multi-action rule is created (e.g., move + mark read + categorize) with priority ordering, and the rule appears on the Rules page where it can be reordered via drag-and-drop, enabled/disabled, and shows per-rule execution stats
  2. When the rule engine matches an incoming email, destructive actions route to the "MSEDB Staging" folder with a 24-hour grace period -- the Staging page shows countdown timers, and the user can rescue individual emails or batch-rescue before the staging processor executes them
  3. The kill switch (automationPaused) stops all rule evaluation across all mailboxes immediately, the whitelist prevents automation on protected senders/domains (per-mailbox and org-wide), and rule evaluation follows the correct order: check kill switch, check whitelist, evaluate rules by priority (first-match-wins)
  4. User can undo any automated action within 48 hours (soft-delete only, never permanentDelete), and the audit log page shows filterable history (by mailbox, rule, action type, date range) with an undo button on each row
  5. Socket.IO pushes notifications when emails enter staging, and the staging count badge appears on the dashboard and navigation
**Plans**: TBD

Plans:
- [ ] 06-01: Rule engine, pattern-to-rule conversion, rule CRUD API
- [ ] 06-02: Staging manager, staging processor BullMQ job, undo service
- [ ] 06-03: Rules page, Staging page, Audit log page

### Phase 7: Polish, Notifications & Admin
**Goal**: The remaining UI pages are complete -- settings for user preferences and mailbox management, admin panel for user and org-wide rule management, and an in-app notification system that keeps users informed without requiring them to check the dashboard
**Depends on**: Phase 6
**Requirements**: DASH-03, PAGE-06, PAGE-07
**Success Criteria** (what must be TRUE):
  1. Settings page allows user to manage preferences (working hours, automation aggressiveness), view per-mailbox connection status and token health, manage sender/domain whitelists, and export or delete their data
  2. Admin panel lets the admin invite/deactivate users, assign roles, create org-wide rules, and view aggregate analytics and system health (webhook subscription status per mailbox, token health per user)
  3. In-app notification system (bell icon with unread count) delivers alerts for pattern suggestions, rule executions, staging alerts, and system events -- with read/unread state management
**Plans**: TBD

Plans:
- [ ] 07-01: Settings page, notification system (bell icon, Socket.IO push)
- [ ] 07-02: Admin panel (user management, org-wide rules, system health)

### Phase 8: Outlook Add-in
**Goal**: Users can whitelist or blacklist senders and domains directly from within Outlook via context menu or taskpane, with actions syncing to the MSEDB backend and affecting automation rules in real time
**Depends on**: Phase 6 (whitelist API from SAFE-04, rule API from AUTO-02), Phase 2 (Azure AD app registration)
**Requirements**: PLUG-01, PLUG-02, PLUG-03, PLUG-04
**Success Criteria** (what must be TRUE):
  1. Outlook Add-in loads via sideload with a taskpane and context menu commands, styled consistently with the MSEDB dashboard
  2. User right-clicks an email (or uses taskpane) to mark a sender as "never delete" (whitelist) or "always delete" (blacklist), and the action syncs to the MSEDB backend whitelist and creates/updates automation rules within seconds
  3. Same workflow works at the domain level -- user can whitelist or blacklist an entire domain (e.g., @newsletter.com)
  4. Add-in authenticates via Azure AD SSO using `Office.js getAccessTokenAsync()` against the same Azure AD app registration, with the backend validating the token without requiring a separate login
**Plans**: TBD

Plans:
- [ ] 08-01: Add-in scaffolding, manifest, Office.js setup, Azure AD SSO
- [ ] 08-02: Sender/domain whitelist/blacklist actions, backend API integration

## Phase Ordering Rationale

1. **Infrastructure before auth**: MongoDB and Redis must exist for MSAL cache persistence and BullMQ. Token storage requires a database.
2. **Auth before observation**: Every Graph API call requires a per-user authenticated client. Token management must be proven reliable before creating webhook subscriptions.
3. **Observation before frontend**: Events must be flowing into MongoDB before the dashboard has anything to display. Building observation first validates the data pipeline with real traffic.
4. **Frontend shell in Phase 4 (not deferred)**: Provides immediate visual validation that the observation pipeline works. Developers need to see events arriving in real-time to catch pipeline bugs early.
5. **Intelligence before automation**: Patterns drive rule suggestions. The pattern engine must be stable and producing quality suggestions before the rule engine acts on them.
6. **Automation last among core phases**: Writing to user mailboxes is the riskiest operation. Building automation only after observation and intelligence are stable minimizes the chance of incorrect automated actions.
7. **Polish after core pipeline**: Settings, admin, and notifications improve the experience but do not affect the core observation-to-automation pipeline.
8. **Outlook Add-in last**: Depends on the whitelist API (Phase 6) and auth infrastructure (Phase 2) being complete. It is a separate Office.js + React package that consumes backend endpoints.

## Critical Pitfalls by Phase

| Phase | Pitfall | Prevention |
|-------|---------|------------|
| 1 | Redis `allkeys-lru` silently evicts BullMQ job keys | Complete    | 2026-02-17 | 2 | MSAL token cache lost on container restart | Complete    | 2026-02-17 | 3 | Webhook subscriptions silently expire | `lifecycleNotificationUrl` on every subscription; renewal on startup + every 2h |
| 3 | Webhook handler blocks beyond 3 seconds | Return 202 immediately; zero Graph API calls in handler; process via BullMQ |
| 5 | Pattern false positives destroy trust | Asymmetric thresholds (98% delete, 85% move); surface exceptions; 14-day minimum observation |
| 6 | Staging folder becomes invisible black hole | Socket.IO push on staging entry; dashboard badge; rescue links; 7-day inactivity alert |

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Infrastructure Foundation | 0/3 | Not started | - |
| 2. Authentication & Token Management | 0/3 | Not started | - |
| 3. Email Observation Pipeline | 0/3 | Not started | - |
| 4. Frontend Shell & Observation UI | 0/3 | Not started | - |
| 5. Pattern Intelligence | 0/3 | Not started | - |
| 6. Automation & Safety | 0/3 | Not started | - |
| 7. Polish, Notifications & Admin | 0/2 | Not started | - |
| 8. Outlook Add-in | 0/2 | Not started | - |
