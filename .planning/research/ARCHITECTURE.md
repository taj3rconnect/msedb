# Architecture Research

**Domain:** Microsoft Graph email intelligence and automation portal
**Researched:** 2026-02-16
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
                          EXTERNAL
 ┌─────────────────────────────────────────────────────────┐
 │  Microsoft Graph API         Cloudflare Tunnel          │
 │  (graph.microsoft.com)       (HTTPS termination)        │
 └──────┬───────────────────────────────┬──────────────────┘
        │                               │
        │  OAuth + REST + Webhooks      │  Inbound webhooks
        │                               │
 ═══════╪═══════════════════════════════╪══════════════════════
        │           DGX SERVER (Docker Compose)             │
 ┌──────┴───────────────────────────────┴──────────────────┐
 │                                                         │
 │  ┌───────────────────────────────────────────────────┐  │
 │  │              INGRESS LAYER                        │  │
 │  │  ┌──────────────┐    ┌─────────────────────────┐  │  │
 │  │  │ Webhook      │    │ REST API                │  │  │
 │  │  │ Receiver     │    │ (Express.js routes)     │  │  │
 │  │  │ POST /webhooks│   │ /api/* /auth/*          │  │  │
 │  │  │ (< 3s resp)  │    │                         │  │  │
 │  │  └──────┬───────┘    └───────────┬─────────────┘  │  │
 │  └─────────┼────────────────────────┼────────────────┘  │
 │            │                        │                    │
 │  ┌─────────┴────────────────────────┴────────────────┐  │
 │  │            EVENT PROCESSING LAYER                 │  │
 │  │  ┌─────────────┐  ┌────────────┐  ┌───────────┐  │  │
 │  │  │ Event       │  │ Rule       │  │ Token     │  │  │
 │  │  │ Collector   │  │ Engine     │  │ Manager   │  │  │
 │  │  │ + Metadata  │  │ (evaluate  │  │ (MSAL +   │  │  │
 │  │  │ Extractor   │  │  & execute)│  │ encrypted │  │  │
 │  │  └──────┬──────┘  └─────┬──────┘  │ storage)  │  │  │
 │  │         │               │         └───────────┘  │  │
 │  └─────────┼───────────────┼────────────────────────┘  │
 │            │               │                            │
 │  ┌─────────┴───────────────┴────────────────────────┐  │
 │  │          INTELLIGENCE LAYER                      │  │
 │  │  ┌─────────────────┐  ┌────────────────────┐    │  │
 │  │  │ Pattern         │  │ Staging Manager    │    │  │
 │  │  │ Detection       │  │ (grace period,     │    │  │
 │  │  │ Engine          │  │  rescue, execute)  │    │  │
 │  │  │ (analyze,       │  └────────────────────┘    │  │
 │  │  │  score,         │  ┌────────────────────┐    │  │
 │  │  │  suggest)       │  │ Undo Service       │    │  │
 │  │  └─────────────────┘  └────────────────────┘    │  │
 │  └──────────────────────────────────────────────────┘  │
 │                                                         │
 │  ┌──────────────────────────────────────────────────┐  │
 │  │          BACKGROUND JOB LAYER (BullMQ)           │  │
 │  │  ┌──────────┐ ┌──────────┐ ┌────────────────┐   │  │
 │  │  │ Webhook  │ │ Delta    │ │ Pattern        │   │  │
 │  │  │ Renewal  │ │ Sync     │ │ Analysis       │   │  │
 │  │  │ (2h)     │ │ (15m)    │ │ (daily 2AM)    │   │  │
 │  │  ├──────────┤ ├──────────┤ ├────────────────┤   │  │
 │  │  │ Staging  │ │ Token    │ │ Daily Digest   │   │  │
 │  │  │ Process  │ │ Refresh  │ │ (daily 8AM)    │   │  │
 │  │  │ (30m)    │ │ (45m)    │ │                │   │  │
 │  │  └──────────┘ └──────────┘ └────────────────┘   │  │
 │  └──────────────────────────────────────────────────┘  │
 │                                                         │
 │  ┌──────────────────────────────────────────────────┐  │
 │  │          REAL-TIME LAYER                         │  │
 │  │  ┌────────────────────────────────────────────┐  │  │
 │  │  │ Socket.IO Server                           │  │  │
 │  │  │ (JWT-authenticated, per-user rooms)        │  │  │
 │  │  │ Events: email:event, automation:executed,  │  │  │
 │  │  │ staging:added, pattern:new, notification   │  │  │
 │  │  └────────────────────────────────────────────┘  │  │
 │  └──────────────────────────────────────────────────┘  │
 │                                                         │
 │  ┌──────────────────────────────────────────────────┐  │
 │  │          PERSISTENCE LAYER                       │  │
 │  │  ┌──────────────────┐  ┌──────────────────────┐ │  │
 │  │  │ MongoDB 7        │  │ Redis 7              │ │  │
 │  │  │ - users          │  │ - BullMQ job queues  │ │  │
 │  │  │ - email_events   │  │ - Delta link cache   │ │  │
 │  │  │ - patterns       │  │ - Session store      │ │  │
 │  │  │ - rules          │  │ - Rate limit counters│ │  │
 │  │  │ - staged_emails  │  │ - Socket.IO adapter  │ │  │
 │  │  │ - audit_logs     │  │                      │ │  │
 │  │  │ - webhook_subs   │  │                      │ │  │
 │  │  │ - notifications  │  │                      │ │  │
 │  │  └──────────────────┘  └──────────────────────┘ │  │
 │  └──────────────────────────────────────────────────┘  │
 │                                                         │
 │  ┌──────────────────────────────────────────────────┐  │
 │  │          FRONTEND (nginx container)              │  │
 │  │  React 18 + Vite + Tailwind + shadcn/ui         │  │
 │  │  ┌──────────┐ ┌──────────┐ ┌────────────────┐   │  │
 │  │  │ Zustand  │ │ TanStack │ │ Socket.IO      │   │  │
 │  │  │ (auth,   │ │ Query    │ │ Client         │   │  │
 │  │  │ notifs)  │ │ (server  │ │ (real-time)    │   │  │
 │  │  │          │ │  state)  │ │                │   │  │
 │  │  └──────────┘ └──────────┘ └────────────────┘   │  │
 │  └──────────────────────────────────────────────────┘  │
 └─────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|----------------|-------------------|
| **Webhook Receiver** | Accept Graph notifications within 3s, validate clientState, queue for async processing | Graph API (inbound), BullMQ (enqueue), Event Collector |
| **REST API (Express)** | All authenticated HTTP endpoints for dashboard, patterns, rules, settings, admin | Frontend, MongoDB, Redis, Token Manager |
| **Token Manager** | Encrypted storage of OAuth refresh tokens, proactive token refresh, MSAL acquireTokenSilent | MSAL, MongoDB (encrypted tokens), Graph API |
| **Event Collector** | Process webhook and delta query payloads into normalized EmailEvent documents, dedup | Webhook Receiver, Delta Sync, Metadata Extractor, MongoDB, Socket.IO |
| **Metadata Extractor** | Parse email headers (List-Unsubscribe, X-Auto-Response-Suppress), normalize subjects, extract sender domain | Event Collector (called by) |
| **Pattern Detection Engine** | Analyze EmailEvents to find repetitive behaviors (sender, subject, folder, time, composite patterns), score confidence | MongoDB (read events, write patterns), Notification Service, Socket.IO |
| **Rule Engine** | Evaluate incoming emails against active rules in priority order, first-match-wins, route to staging or direct execution | Event Collector (triggered by), Graph API (execute actions), Staging Manager, Audit Log |
| **Staging Manager** | Hold emails in grace period before executing destructive actions, allow rescue | Graph API (move to staging folder, execute), MongoDB (staged_emails), Socket.IO |
| **Undo Service** | Reverse automated actions within 48h window | Graph API (reverse move/delete), MongoDB (audit_logs) |
| **BullMQ Jobs** | Scheduled background tasks: webhook renewal, delta sync, pattern analysis, staging processor, token refresh, daily digest | Redis (queues), all services (orchestration target) |
| **Socket.IO Server** | Push real-time updates to authenticated dashboard clients in per-user rooms | Frontend clients, Event Collector, Rule Engine, Staging Manager |
| **MongoDB** | Primary persistence: users, events, patterns, rules, staged emails, audit logs, webhook subscriptions, notifications | All backend services |
| **Redis** | Job queues (BullMQ), delta link cache, rate limit counters, Socket.IO adapter state | BullMQ, Delta Sync, Rate Limiter, Socket.IO |
| **Frontend (React)** | Dashboard UI, pattern review/approval, rule management, staging rescue, audit log, admin panel | REST API (TanStack Query), Socket.IO (real-time updates) |
| **Cloudflare Tunnel** | HTTPS termination for webhook endpoint, public accessibility for Microsoft Graph callbacks | Microsoft Graph (inbound), Backend (proxy to :8010) |

## Recommended Project Structure

```
msedb/
├── docker-compose.yml              # Production stack (4 containers)
├── docker-compose.dev.yml          # Dev overrides (hot reload)
├── .env.example                    # Template for required env vars
├── .env                            # Actual secrets (gitignored)
│
├── backend/
│   ├── Dockerfile                  # Multi-stage: node:20-alpine builder → runtime
│   ├── .dockerignore
│   ├── package.json
│   └── src/
│       ├── server.js               # Express + Socket.IO entry point
│       │
│       ├── config/                 # Configuration loading
│       │   ├── index.js            # Centralized env var loading with defaults
│       │   ├── database.js         # MongoDB connection with retry logic
│       │   ├── redis.js            # Redis client (shared by BullMQ + cache)
│       │   └── socket.js           # Socket.IO init with JWT auth
│       │
│       ├── auth/                   # Authentication boundary
│       │   ├── azureAd.js          # MSAL ConfidentialClientApplication
│       │   ├── tokenManager.js     # AES-256-GCM encrypted token store + refresh
│       │   ├── middleware.js        # requireAuth, requireAdmin JWT verification
│       │   └── routes.js           # /auth/login, /auth/callback, /auth/me, /auth/logout
│       │
│       ├── models/                 # Mongoose schemas + indexes
│       │   ├── User.js
│       │   ├── EmailEvent.js       # TTL index: 90 days
│       │   ├── Pattern.js
│       │   ├── Rule.js
│       │   ├── StagedEmail.js
│       │   ├── AuditLog.js
│       │   ├── Notification.js
│       │   └── WebhookSubscription.js
│       │
│       ├── services/               # Business logic boundary
│       │   ├── graph/              # Microsoft Graph API abstraction
│       │   │   ├── graphClient.js          # Authenticated client factory
│       │   │   ├── mailService.js          # Mail operations (get, move, delete, batch)
│       │   │   ├── subscriptionService.js  # Webhook subscription CRUD + renewal
│       │   │   └── deltaService.js         # Delta query sync + link caching
│       │   │
│       │   ├── collector/          # Event ingestion pipeline
│       │   │   ├── eventCollector.js       # Webhook + delta → normalized events
│       │   │   └── metadataExtractor.js    # Header parsing, subject normalization
│       │   │
│       │   ├── analyzer/           # Pattern detection engine
│       │   │   ├── patternDetector.js      # Sender, subject, folder, composite analysis
│       │   │   ├── confidenceScorer.js     # Statistical confidence calculation
│       │   │   └── subjectNormalizer.js    # Variable replacement + similarity
│       │   │
│       │   ├── automation/         # Rule execution engine
│       │   │   ├── ruleEngine.js           # Priority-ordered rule matching + execution
│       │   │   ├── stagingManager.js       # Grace period management
│       │   │   └── undoService.js          # Action reversal within 48h
│       │   │
│       │   ├── notification/       # User notification system
│       │   │   ├── notificationService.js  # In-app notifications + Socket.IO push
│       │   │   └── digestBuilder.js        # Daily email digest compilation
│       │   │
│       │   └── admin/              # Admin-only operations
│       │       ├── userManagement.js       # Invite, deactivate, role management
│       │       └── orgRules.js             # Org-wide override rules
│       │
│       ├── jobs/                   # BullMQ job definitions
│       │   ├── queue.js            # Queue + worker setup, error handling, retries
│       │   ├── webhookRenewal.js   # Cron: every 2h — renew expiring subscriptions
│       │   ├── deltaSync.js        # Cron: every 15m — catch missed webhook events
│       │   ├── patternAnalysis.js  # Cron: daily 2AM — full pattern recalculation
│       │   ├── stagingProcessor.js # Cron: every 30m — execute expired staged actions
│       │   ├── tokenRefresh.js     # Cron: every 45m — proactive token refresh
│       │   └── dailyDigest.js      # Cron: daily 8AM — email action summaries
│       │
│       ├── routes/                 # Express route handlers
│       │   ├── index.js            # Route registration
│       │   ├── webhookRoutes.js    # POST /webhooks/graph
│       │   ├── dashboardRoutes.js  # GET /api/dashboard/*
│       │   ├── patternRoutes.js    # GET/POST /api/patterns/*
│       │   ├── ruleRoutes.js       # CRUD /api/rules/*
│       │   ├── stagingRoutes.js    # GET/POST /api/staging/*
│       │   ├── auditRoutes.js      # GET/POST /api/audit/*
│       │   ├── settingsRoutes.js   # GET/PUT /api/settings/*
│       │   └── adminRoutes.js      # Admin-only /api/admin/*
│       │
│       ├── middleware/             # Express middleware
│       │   ├── auth.js             # JWT verification
│       │   ├── rbac.js             # Role-based access control
│       │   ├── rateLimiter.js      # Per-user rate limiting via Redis
│       │   └── errorHandler.js     # Global error handler + Graph API error mapping
│       │
│       └── utils/                  # Shared utilities
│           ├── logger.js           # Winston structured logging
│           ├── graphHelpers.js     # Graph API retry, batch, throttle handling
│           └── dateUtils.js        # UTC conversions, timezone helpers
│
├── frontend/
│   ├── Dockerfile                  # Multi-stage: node:20-alpine build → nginx:alpine serve
│   ├── .dockerignore
│   ├── nginx.conf                  # Reverse proxy to backend for /api, /auth, /webhooks, /socket.io
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── src/
│       ├── main.jsx                # App entry point
│       ├── App.jsx                 # Router + providers
│       ├── api/
│       │   └── client.js           # Axios with JWT interceptor + refresh
│       ├── auth/
│       │   ├── AuthProvider.jsx    # Auth context + auto-check
│       │   ├── ProtectedRoute.jsx  # Route guard (optional requireAdmin)
│       │   └── LoginPage.jsx       # Microsoft sign-in
│       ├── layouts/
│       │   ├── MainLayout.jsx      # Sidebar + topbar + content
│       │   └── Sidebar.jsx         # Collapsible navigation
│       ├── pages/                  # Route-level components
│       │   ├── Dashboard.jsx       # Stats, activity feed, charts
│       │   ├── EmailActivity.jsx   # Event table + heatmap
│       │   ├── Patterns.jsx        # Pattern cards + approve/reject
│       │   ├── Rules.jsx           # Drag-sort rule list + wizard
│       │   ├── Staging.jsx         # Grace period items + rescue
│       │   ├── AuditLog.jsx        # Action history + undo
│       │   ├── Settings.jsx        # User preferences + connections
│       │   └── admin/
│       │       ├── UserManagement.jsx
│       │       └── OrgSettings.jsx
│       ├── components/             # Reusable UI components
│       │   ├── ui/                 # shadcn/ui primitives
│       │   ├── PatternCard.jsx
│       │   ├── RuleRow.jsx
│       │   ├── StagingItem.jsx
│       │   ├── StatsCard.jsx
│       │   ├── ActivityFeed.jsx
│       │   ├── ConfidenceBadge.jsx
│       │   ├── KillSwitch.jsx
│       │   ├── EmptyState.jsx
│       │   ├── ConfirmModal.jsx
│       │   └── DataTable.jsx
│       ├── hooks/                  # Custom React hooks
│       │   ├── useAuth.js
│       │   ├── usePatterns.js
│       │   ├── useRules.js
│       │   └── useWebSocket.js
│       ├── stores/                 # Zustand state stores
│       │   ├── authStore.js
│       │   └── notificationStore.js
│       └── utils/
│           ├── constants.js
│           └── formatters.js
│
└── scripts/
    ├── seed.js                     # Development seed data
    ├── migrate.js                  # Database migrations
    └── backup.sh                   # MongoDB backup to host
```

### Structure Rationale

- **backend/src/services/**: Organized by domain (graph, collector, analyzer, automation, notification, admin) because each domain has distinct responsibilities and dependencies. The graph/ subdirectory isolates all Microsoft Graph API calls behind a clean abstraction, making it possible to mock for testing and to centralize retry/throttle logic.
- **backend/src/jobs/**: Separated from services because jobs are scheduling concerns that invoke services. Each file is a single cron-scheduled BullMQ worker, keeping the orchestration layer thin.
- **backend/src/routes/**: Express routes are thin wrappers that validate input, call services, and format responses. Business logic lives in services, not routes.
- **frontend/src/pages/ vs components/**: Pages are route-level containers that compose components. Components are reusable UI building blocks. This separation maps cleanly to React Router routes.
- **frontend/src/stores/ vs hooks/**: Zustand stores hold client-only state (auth, notifications). TanStack Query hooks manage server state (patterns, rules, events). This avoids the common mistake of duplicating server state in a client store.

## Architectural Patterns

### Pattern 1: Webhook-First with Delta Query Fallback

**What:** Use Microsoft Graph webhook subscriptions as the primary real-time event source. Run delta query sync every 15 minutes as a safety net to catch any events missed by webhooks (throttled, dropped, or during subscription gaps).

**When to use:** Always. This is the Microsoft-recommended approach for reliable email monitoring.

**Trade-offs:** Webhooks give near-real-time (<1 min latency for mail) but are unreliable by themselves. Delta queries guarantee eventual consistency but add 15 min latency. Together they provide the best of both: fast response with guaranteed completeness.

**How it works:**

```
REAL-TIME PATH (Webhook):
  Microsoft Graph → POST /webhooks/graph
    → Validate clientState
    → Return 202 Accepted (< 3 seconds)
    → Enqueue to BullMQ "webhook-events" queue
    → Worker: fetch message via Graph API
    → EventCollector.processMessage()
    → Store EmailEvent (dedup by userId + messageId + eventType)
    → RuleEngine.evaluateRules() if new arrival
    → Socket.IO emit to user room

FALLBACK PATH (Delta Query):
  BullMQ cron job (every 15 min) per user:
    → Load deltaLink from Redis (or start fresh)
    → GET /me/mailFolders/{id}/messages/delta
    → Follow @odata.nextLink pagination until @odata.deltaLink
    → Save new deltaLink to Redis
    → For each changed message:
      → EventCollector.processMessage() (same pipeline as webhooks)
      → Dedup ensures no double-processing
```

**Key implementation details from Microsoft docs:**
- Webhook endpoint MUST respond within 3 seconds or Microsoft Graph starts throttling/dropping. Return 202 and queue everything.
- If endpoint responses exceed 10 seconds for >10% of requests in a 10-min window, the endpoint is marked "slow" and notifications are delayed 10 seconds.
- If >15% exceed 10 seconds, notifications are DROPPED for up to 10 minutes.
- Delta query is per-folder. Track Inbox at minimum; optionally track Sent Items and key folders.
- Delta query supports `$select` to limit fields, `$filter=receivedDateTime+ge+{value}` for scoping.
- Removed items appear with `@removed: { reason: "deleted" }` annotation.
- Store deltaLink per-user per-folder in Redis (fast read, survives restart with AOF persistence).

**Confidence:** HIGH (verified via official Microsoft Graph documentation)

### Pattern 2: Lifecycle-Aware Subscription Management

**What:** Subscribe to both change notifications AND lifecycle notifications when creating webhook subscriptions. Handle three lifecycle event types: `reauthorizationRequired`, `subscriptionRemoved`, and `missed`.

**When to use:** Always. Lifecycle notifications are critical for production reliability.

**Trade-offs:** Adds implementation complexity (separate lifecycle handler) but prevents the silent subscription death problem where you stop receiving notifications without knowing it.

**How it works:**

```
SUBSCRIPTION CREATION:
  POST /subscriptions
  {
    "changeType": "created,updated,deleted",
    "notificationUrl": "https://{tunnel}/webhooks/graph",
    "lifecycleNotificationUrl": "https://{tunnel}/webhooks/graph/lifecycle",
    "resource": "/me/mailFolders('inbox')/messages",
    "expirationDateTime": "{now + 6 days}",  // max 7 days (10,080 min)
    "clientState": "{per-user-secret-uuid}"
  }

LIFECYCLE HANDLING:
  reauthorizationRequired → POST /subscriptions/{id}/reauthorize
                           OR PATCH /subscriptions/{id} with new expiration
  subscriptionRemoved     → Create brand new subscription + delta sync catch-up
  missed                  → Run immediate delta sync for affected user

PROACTIVE RENEWAL (BullMQ cron every 2h):
  Find subscriptions expiring within 4 hours
  PATCH /subscriptions/{id} with new expirationDateTime
  On failure: delete + recreate subscription
```

**Key implementation details from Microsoft docs:**
- Outlook message subscription max lifetime: 10,080 minutes (under 7 days). Rich notifications (with resource data): 1,440 minutes (under 1 day). MSEDB uses basic notifications, so 7-day max applies.
- `lifecycleNotificationUrl` MUST be set at subscription creation time. It CANNOT be added to an existing subscription via update -- you must delete and recreate.
- `reauthorizationRequired` is sent when access token approaches expiry. Microsoft sends these at decreasing intervals: every `TokenTimeToExpiration/2` when >60min remaining, every 15 min when <60 min remaining.
- After `subscriptionRemoved` or `missed`, use delta query to catch up on any events during the gap.
- clientState is validated on every notification. Use a per-user UUID stored in the database.
- Any request with expirationDateTime under 45 minutes from now is automatically set to 45 minutes.

**Confidence:** HIGH (verified via official Microsoft Graph documentation)

### Pattern 3: Async-First Event Processing Pipeline

**What:** Every inbound event (webhook notification, delta sync result, lifecycle event) is immediately enqueued to BullMQ and processed asynchronously. The webhook HTTP handler does zero business logic beyond validation and queuing.

**When to use:** Whenever webhook response time requirements are strict (3-second deadline for Graph webhooks).

**Trade-offs:** Adds Redis dependency and job processing latency (typically <1 second with BullMQ), but guarantees webhook response compliance and provides automatic retry with exponential backoff on failures.

**Example:**

```typescript
// webhookRoutes.js — thin handler
router.post('/webhooks/graph', async (req, res) => {
  // Validation request (subscription creation)
  if (req.query.validationToken) {
    return res.status(200).contentType('text/plain').send(req.query.validationToken);
  }

  // Change notifications — return 202 immediately, process async
  res.status(202).send();

  const notifications = req.body.value || [];
  for (const notification of notifications) {
    // Validate clientState against stored per-user secret
    const sub = await WebhookSubscription.findOne({
      subscriptionId: notification.subscriptionId
    });
    if (!sub || sub.clientState !== notification.clientState) {
      logger.warn('Invalid clientState, ignoring notification');
      continue;
    }

    // Enqueue for async processing
    await webhookQueue.add('process-notification', {
      userId: sub.userId,
      changeType: notification.changeType,
      resourceUrl: notification.resource,
      subscriptionId: notification.subscriptionId
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 }
    });
  }
});
```

**Confidence:** HIGH (Microsoft explicitly recommends 202 + async processing pattern)

### Pattern 4: Statistical Pattern Detection with Threshold Gating

**What:** Analyze email events using statistical aggregation over sliding time windows. Group by sender domain, normalized subject, and folder routing. Calculate action distributions and confidence scores. Only surface patterns that meet minimum sample size (10 events) and consistency thresholds (70%+ dominant action).

**When to use:** For the core pattern detection engine that converts raw email events into actionable rule suggestions.

**Trade-offs:** Deterministic and explainable (users can see "97 of 100 emails from this sender were deleted"). Simpler than ML approaches but sufficient for Phase 1 MVP. Can be enhanced with ML in later phases.

**How it works:**

```
ANALYSIS PIPELINE (daily job + on-demand):

1. QUERY: Load EmailEvents from last 30 days for user
   → Use compound index: { userId: 1, timestamp: -1 }

2. SENDER ANALYSIS:
   → Group by sender.domain
   → For each domain with >= 10 events:
     → Count action distribution: { deleted: N, moved: N, read_no_action: N, ... }
     → If dominant action >= 85% → candidate pattern

3. SUBJECT ANALYSIS:
   → Normalize subjects: replace numbers, dates, UUIDs, emails with tokens
   → Group by normalizedSubject
   → For each group with >= 10 events:
     → Same distribution analysis as sender

4. FOLDER ROUTING ANALYSIS:
   → Filter to 'moved' events
   → Group by sender + toFolder
   → If consistently routed to same folder → candidate pattern

5. COMPOSITE ANALYSIS:
   → Cross-tabulate: sender x dayOfWeek x action
   → Detect conditional patterns (e.g., weekend LinkedIn → delete)

6. CONFIDENCE SCORING:
   → Base: (dominant_action_count / total_count) * 100
   → Bonuses: +5 if sampleSize > 50, +3 if > 20
   → Bonuses: +5 if timeSpan > 14 days (stable behavior)
   → Penalties: -10 if sampleSize < 15, -5 if recent behavior shift
   → Clamp to [0, 100]

7. PATTERN UPSERT:
   → Create new patterns or update existing
   → Merge with existing: update confidence, sampleSize, lastSeen
   → Skip patterns user has rejected (30-day cooldown)
   → Notify user of new high-confidence patterns via Socket.IO
```

**Confidence:** HIGH (standard statistical approach, well-suited to the domain)

### Pattern 5: Safety-First Rule Execution with Grace Period

**What:** All destructive rule actions (delete, move) flow through a staging layer by default. Emails are moved to an "MSEDB Staging" folder and held for a configurable grace period (default 24h) before the final action executes. Users can rescue any email from staging.

**When to use:** Always for automated actions. Users can opt out of grace period per-rule for trusted, high-confidence rules.

**Trade-offs:** Adds 24h latency to automated actions but dramatically reduces the risk of false-positive deletions. The staging folder is created per-user via Graph API, so emails remain in the user's mailbox and are visible in Outlook.

**How it works:**

```
RULE EXECUTION FLOW:

Email arrives → Event collected
  → Check user.automationPaused → skip if true
  → Check whitelist (sender domain/email) → skip if whitelisted
  → Load active rules sorted by priority (ascending)
  → First rule whose conditions ALL match (AND logic) wins
  → No match → done (event logged, no automation)

IF MATCH:
  → rule.safetyConfig.useGracePeriod?
    YES → Ensure "MSEDB Staging" folder exists (create via Graph if not)
        → Move email to staging folder via Graph API
        → Create StagedEmail doc (executeAt = now + gracePeriodHours)
        → Socket.IO: staging:added event to user
        → BullMQ stagingProcessor cron picks up expired items
    NO  → Execute action directly via Graph API
        → Create AuditLog entry (undoAvailableUntil = now + 48h)
        → Socket.IO: automation:executed event to user

STAGING PROCESSOR (every 30 min):
  → Find StagedEmail where status='pending' AND executeAt <= now
  → For each: execute via Graph API → update status → create AuditLog

RESCUE:
  → User clicks rescue → move email back to Inbox → status='rescued'

UNDO (within 48h):
  → Reverse Graph action (move back, undelete, mark unread)
  → Mark AuditLog as undone, increment rule.stats.undoneByUser
```

**Confidence:** HIGH (PRD-specified design, standard safety pattern for automation systems)

### Pattern 6: Proactive Token Lifecycle Management

**What:** MSAL manages token refresh internally via `acquireTokenSilent`, but MSEDB adds a proactive layer: a BullMQ cron job (every 45 min) iterates all connected users and ensures their tokens are fresh. Refresh tokens are encrypted at rest (AES-256-GCM) in MongoDB.

**When to use:** Always for multi-user systems with background Graph API access. Background jobs need valid tokens even when users are not actively browsing.

**Trade-offs:** Proactive refresh avoids token expiry failures during background operations (delta sync, webhook processing, rule execution). The 45-minute interval ensures tokens are always refreshed well before the default 1-hour access token expiry.

**How it works:**

```
TOKEN STORAGE:
  User document stores encrypted refresh token:
  {
    encryptedRefreshToken: <AES-256-GCM ciphertext>,
    tokenIV: <initialization vector>,
    tokenTag: <authentication tag>
  }
  Encryption key from ENCRYPTION_KEY env var.

TOKEN ACQUISITION (per-request):
  tokenManager.getAccessToken(userId):
    → Retrieve encrypted refresh token from MongoDB
    → Decrypt with AES-256-GCM
    → MSAL acquireTokenByRefreshToken() or acquireTokenSilent()
    → If MSAL returns new refresh token → re-encrypt and store
    → Return access token

PROACTIVE REFRESH (BullMQ cron every 45 min):
  → For each user with graphConnected=true:
    → Call getAccessToken(userId) to trigger MSAL refresh
    → On failure: mark user as needing re-auth
    → Create notification: 'token_expiring' if refresh fails

GRAPH CLIENT FACTORY:
  graphClient.js creates per-user Microsoft Graph client:
    → authProvider calls tokenManager.getAccessToken(userId)
    → 401 response → refresh token once and retry
    → Still 401 → mark graphConnected=false, notify user
```

**Important notes from MSAL docs:**
- MSAL for Node.js does NOT expose raw refresh tokens by default. Use `acquireTokenByRefreshToken()` for confidential clients OR implement a custom cache serialization plugin.
- For confidential clients (which MSEDB is), you MUST implement persistent token caching. MSAL's in-memory cache does not survive process restarts. Use a MongoDB-backed or Redis-backed cache plugin.
- Encrypt the cache/tokens at rest. MSAL docs explicitly recommend this for confidential client deployments.

**Confidence:** MEDIUM (MSAL token handling patterns verified via official docs, but implementation details of custom cache serialization vary by MSAL version -- validate during build phase)

## Data Flow

### Primary Data Flow: Email Event to Automated Action

```
[Email arrives in user's O365 mailbox]
    │
    ├──── REAL-TIME PATH ──────────────────────────────┐
    │                                                   │
    ▼                                                   │
[Microsoft Graph detects change]                        │
    │                                                   │
    ▼                                                   │
[POST /webhooks/graph]                                  │
    │                                                   │
    ▼                                                   │
[Validate clientState → Return 202]                     │
    │                                                   │
    ▼                                                   │
[Enqueue to BullMQ]                                     │
    │                                                   │
    ▼                                                   │
[Worker: GET /me/messages/{id}] ◄── Token Manager       │
    │              (Graph API)      (fresh access token) │
    ▼                                                   │
[MetadataExtractor.extract()]                           │
    │  - Parse headers                                  │
    │  - Normalize subject                              │
    │  - Extract sender domain                          │
    ▼                                                   │
[EventCollector.processMessage()]                       │
    │  - Dedup check (userId + messageId + eventType)   │
    │  - Create EmailEvent in MongoDB                   │
    │  - Increment user.stats.totalEventsCollected      │
    ▼                                                   │
[Socket.IO → email:event to user room]                  │
    │                                                   │
    ▼                                                   │
[RuleEngine.evaluateRules(userId, message)]             │
    │  - Check automationPaused                         │
    │  - Check whitelist                                │
    │  - Load active rules by priority                  │
    │  - First match wins                               │
    │                                                   │
    ├── No match → done                                 │
    │                                                   │
    ▼                                                   │
[Grace period check]                                    │
    │                                                   │
    ├── useGracePeriod=true                             │
    │   │                                               │
    │   ▼                                               │
    │   [Move to "MSEDB Staging" folder via Graph]      │
    │   [Create StagedEmail doc]                        │
    │   [Socket.IO → staging:added]                     │
    │   │                                               │
    │   ▼  (after grace period expires)                 │
    │   [StagingProcessor executes action]              │
    │                                                   │
    ├── useGracePeriod=false                            │
    │   │                                               │
    │   ▼                                               │
    │   [Execute action via Graph API immediately]      │
    │                                                   │
    ▼                                                   │
[Create AuditLog entry (undoAvailableUntil = +48h)]     │
[Update rule.stats]                                     │
[Socket.IO → automation:executed]                       │
    │                                                   │
    │                                                   │
    ├──── FALLBACK PATH ───────────────────────────────┘
    │  (Delta query every 15 min catches same events)
    │  (Dedup ensures no double-processing)
    │
    ▼
[Dashboard reflects all events and actions in real-time]
```

### Pattern Discovery Flow

```
[BullMQ cron: daily at 2 AM]
    │
    ▼
[For each active user:]
    │
    ▼
[Query EmailEvents from last 30 days]
    │  Compound index: { userId: 1, timestamp: -1 }
    │
    ├──► [Sender Analysis]
    │      Group by sender.domain → action distribution
    │
    ├──► [Subject Analysis]
    │      Normalize → group → action distribution
    │
    ├──► [Folder Routing Analysis]
    │      Filter moved events → sender + folder consistency
    │
    ├──► [Composite Analysis]
    │      Cross-tabulate sender x time x action
    │
    ▼
[Confidence Scoring]
    │  Base consistency + sample size bonuses/penalties
    │
    ▼
[Upsert Patterns in MongoDB]
    │  - New patterns: status='suggested'
    │  - Existing: update confidence, sampleSize, lastSeen
    │  - Skip recently rejected patterns (30-day cooldown)
    │
    ▼
[Notify user of new high-confidence patterns]
    │  Socket.IO → pattern:new
    │  In-app notification
    │
    ▼
[User reviews on Patterns page]
    │
    ├── Approve → Create Rule from pattern
    ├── Customize → Modify conditions → Create Rule
    └── Reject → Suppress for 30 days
```

### Token Lifecycle Flow

```
[User signs in via Azure AD OAuth]
    │
    ▼
[MSAL exchanges auth code for tokens]
    │  access_token (1h), refresh_token, id_token
    │
    ▼
[TokenManager.storeTokens()]
    │  Encrypt refresh token: AES-256-GCM
    │  Store: encryptedRefreshToken, tokenIV, tokenTag in User doc
    │  Issue JWT to frontend (session token, not Graph token)
    │
    ▼
[Background: any service needs Graph access]
    │
    ▼
[TokenManager.getAccessToken(userId)]
    │
    ├── MSAL cache has valid token → return immediately
    │
    ├── Token expired → MSAL refreshes via refresh token
    │   │  New refresh token? → re-encrypt and store
    │   └── Return new access token
    │
    └── Refresh token expired/revoked
        │  Mark user graphConnected=false
        │  Create notification: 'token_expiring'
        └── User must re-authenticate via OAuth

[BullMQ cron: every 45 min]
    │  Proactively refresh tokens for all connected users
    │  Ensures tokens are fresh before background operations need them
```

### Webhook Subscription Lifecycle Flow

```
[User connects O365 account]
    │
    ▼
[SubscriptionService.createSubscription(userId)]
    │  POST /subscriptions
    │  - resource: /me/mailFolders('inbox')/messages
    │  - changeType: created,updated,deleted
    │  - expirationDateTime: now + 6 days (max 7)
    │  - notificationUrl + lifecycleNotificationUrl
    │  - clientState: per-user UUID
    │
    ▼
[Graph validates endpoint (POST with validationToken)]
    │  Respond 200 with token as plain text within 10 sec
    │
    ▼
[Subscription active → store in webhook_subscriptions collection]
    │
    │  ┌──── PROACTIVE RENEWAL (every 2h) ────┐
    │  │  Find subs expiring within 4h          │
    │  │  PATCH /subscriptions/{id}             │
    │  │  with new expirationDateTime           │
    │  │  On failure → delete + recreate        │
    │  └────────────────────────────────────────┘
    │
    │  ┌──── LIFECYCLE: reauthorizationRequired ─┐
    │  │  Respond 202 Accepted                    │
    │  │  POST /subscriptions/{id}/reauthorize    │
    │  │  OR PATCH with new expiration            │
    │  └──────────────────────────────────────────┘
    │
    │  ┌──── LIFECYCLE: subscriptionRemoved ──────┐
    │  │  Respond 202 Accepted                     │
    │  │  Create new subscription                  │
    │  │  Run delta sync to catch gap              │
    │  └───────────────────────────────────────────┘
    │
    │  ┌──── LIFECYCLE: missed ───────────────────┐
    │  │  Respond 202 Accepted                     │
    │  │  Run immediate delta sync for user        │
    │  └───────────────────────────────────────────┘
```

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-10 users (MVP target) | Single Docker Compose stack. BullMQ concurrency=1 per queue. Single MongoDB instance. All services in one backend container. Resource limits as specified (5 CPU, 5GB total). |
| 10-50 users | Increase BullMQ concurrency for delta-sync and webhook-events queues. Add MongoDB indexes for common query patterns. Monitor Redis memory (256MB cap). Consider separating BullMQ workers into their own container for isolation. |
| 50-200 users | Separate BullMQ workers container from API server container. Add MongoDB replica set for read scaling. Redis may need more memory (upgrade from 512MB). Batch Graph API calls (up to 20 per batch request). Delta sync jobs become the bottleneck -- consider staggering per-user sync times. |
| 200+ users | Multiple backend API replicas behind nginx load balancer. Redis adapter for Socket.IO to share events across instances. Dedicated MongoDB for events (sharded by userId). Consider Graph API Data Connect for bulk extraction instead of per-user delta queries. Token refresh job needs work distribution (partition users across workers). |

### Scaling Priorities

1. **First bottleneck: Graph API rate limits.** Microsoft Graph throttles per-app and per-user. With 50 users doing delta sync every 15 min + webhook-triggered fetches + rule execution, you can hit throttle limits. **Fix:** Respect `Retry-After` headers, implement exponential backoff in graphHelpers.js, use `$select` to minimize payload size, batch operations (up to 20 per batch), and stagger delta sync times across users.

2. **Second bottleneck: BullMQ job throughput.** Pattern analysis for users with 10,000+ events takes time. If all users' pattern analysis jobs run at 2 AM simultaneously, it creates a burst. **Fix:** Distribute pattern analysis across a time window (2 AM - 4 AM). Use BullMQ rate limiting to cap concurrent Graph API calls.

3. **Third bottleneck: MongoDB event volume.** EmailEvents accumulate fast (hundreds per user per day). The 90-day TTL index handles cleanup, but query performance degrades without proper indexing. **Fix:** Compound indexes on `{ userId: 1, sender.domain: 1, timestamp: -1 }` and `{ userId: 1, eventType: 1, timestamp: -1 }`. Consider time-bucketed collections if volume exceeds expectations.

## Anti-Patterns

### Anti-Pattern 1: Synchronous Webhook Processing

**What people do:** Process the Graph webhook notification inline -- fetch the message, evaluate rules, execute actions -- all before responding to the webhook HTTP request.

**Why it's wrong:** Microsoft Graph requires a response within 3 seconds. If processing takes longer, the endpoint gets throttled (10% >10s = "slow" state). If >15% exceed 10s, notifications are DROPPED for 10 minutes. Once notifications are dropped, they cannot be recovered.

**Do this instead:** Return 202 Accepted immediately after validating clientState. Enqueue the notification to BullMQ for async processing. The worker can take as long as needed.

### Anti-Pattern 2: Polling Instead of Delta Query

**What people do:** Periodically fetch all messages from a folder and compare with a local cache to detect changes.

**Why it's wrong:** Extremely inefficient. A user with 10,000 inbox messages would transfer massive payloads every 15 minutes. Graph API rate limits would be consumed quickly. No reliable way to detect deletions.

**Do this instead:** Use delta query with stored deltaLink tokens. Only changed messages are returned. Deleted items are explicitly marked with `@removed`. Store deltaLink per-user per-folder in Redis.

### Anti-Pattern 3: Storing MSAL Tokens in Application State

**What people do:** Keep tokens in memory (Node.js process state, global variables) without persistence. Works in development, breaks in production when the process restarts.

**Why it's wrong:** MSAL's in-memory cache is lost on process restart, container restart, or deployment. All users would need to re-authenticate. Background jobs would fail.

**Do this instead:** Implement a custom MSAL cache serialization plugin that persists to MongoDB or Redis. Encrypt at rest with AES-256-GCM. The tokenManager.js module handles this.

### Anti-Pattern 4: Creating Rules Without User Approval

**What people do:** Automatically create and activate rules based on detected patterns without user review.

**Why it's wrong:** False positives in pattern detection can cause important emails to be deleted. Users lose trust immediately. One bad auto-rule can be catastrophic.

**Do this instead:** Patterns are always surfaced as suggestions. Users explicitly approve, customize, or reject. The staging/grace period provides an additional safety net even after approval. The "kill switch" allows instant pause of all automation.

### Anti-Pattern 5: Single Webhook Subscription for All Change Types

**What people do:** Create one subscription with `resource: "/me/messages"` and try to detect what type of change happened after the fact.

**Why it's wrong:** The webhook notification payload only tells you the messageId and changeType. For "updated" events, you must fetch the message and compare with previous state to know what changed (folder move vs. read status vs. flag change). Without tracking previous state, you cannot distinguish a move from a read.

**Do this instead:** Subscribe to `created,updated,deleted` and implement proper change detection in the event collector. For "updated" notifications, fetch the current message state and compare with the stored last-known state. The delta query fallback naturally handles this since delta responses include the full updated state.

### Anti-Pattern 6: Ignoring Lifecycle Notifications

**What people do:** Create webhook subscriptions without providing a `lifecycleNotificationUrl`. Rely solely on the proactive renewal cron job.

**Why it's wrong:** If a subscription is silently removed (admin revokes permissions, token expiry), you won't know until the renewal job runs and fails. During the gap, all events are missed and unrecoverable.

**Do this instead:** Always set `lifecycleNotificationUrl` at subscription creation time (it CANNOT be added via update). Handle all three lifecycle event types: `reauthorizationRequired` (reauthorize the subscription), `subscriptionRemoved` (recreate + delta sync catch-up), `missed` (immediate delta sync).

## Integration Points

### External Services

| Service | Integration Pattern | Key Constraints |
|---------|---------------------|-----------------|
| **Microsoft Graph API** | REST via `@microsoft/microsoft-graph-client` with per-user auth | Rate limits per-app and per-user. Batch up to 20 requests. Always use `$select`. Respect `Retry-After` header. Mail subscription max 7 days. |
| **Azure AD / MSAL** | OAuth 2.0 auth code grant via `@azure/msal-node` ConfidentialClientApplication | Access tokens expire in ~1h. Refresh tokens are long-lived but can be revoked. Client secret expires (set 24-month rotation). |
| **Cloudflare Tunnel** | systemd service on host, proxies HTTPS to localhost:8010 | Required for webhook HTTPS endpoint. Must be running before subscriptions are created. Health: `curl https://msedb-api.{domain}/health`. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| **Frontend <-> Backend** | REST API (Axios + TanStack Query) + Socket.IO (real-time events) | All API calls include JWT in Authorization header. Socket.IO authenticated via JWT handshake. nginx proxies /api, /auth, /webhooks, /socket.io to backend. |
| **Backend <-> MongoDB** | Mongoose ODM over TCP (msedb-mongo:27017 internal) | All queries scoped by userId for data isolation. TTL indexes for event cleanup. Compound indexes for pattern analysis queries. |
| **Backend <-> Redis** | ioredis client over TCP (msedb-redis:6379 internal) | BullMQ queues, delta link cache, rate limit counters. AOF persistence enabled. Max memory 256MB with allkeys-lru eviction. |
| **Services <-> BullMQ** | Job producer/consumer via Redis-backed queues | Each job type in its own queue. 3 retries with exponential backoff. Cron schedules for periodic jobs. Workers run in-process in backend container (separate in scale-out). |
| **Event Collector <-> Rule Engine** | Direct function call (same process) | When eventCollector processes a new email arrival, it synchronously calls ruleEngine.evaluateRules(). If rules need to call Graph API for execution, that is async. |
| **All Services <-> Socket.IO** | Import shared Socket.IO instance, emit to user rooms | Pattern: `io.to('user:' + userId).emit('event:type', payload)`. Frontend receives via useWebSocket hook. |

## Build Order (Dependency-Driven)

Build order is dictated by dependencies between components. Each milestone should produce a testable system.

```
PHASE 1: INFRASTRUCTURE (no Graph API needed)
  1. Docker Compose + Dockerfiles + project scaffolding
  2. MongoDB connection + Redis connection + health endpoint
  3. Mongoose models with indexes
  WHY FIRST: Everything depends on persistence and containers.

PHASE 2: AUTHENTICATION (Graph API connection)
  4. MSAL ConfidentialClientApplication setup
  5. OAuth flow: /auth/login → callback → JWT → /auth/me
  6. Token manager with encrypted storage
  7. requireAuth + requireAdmin middleware
  WHY SECOND: All Graph API calls and all API routes require auth.

PHASE 3: EMAIL OBSERVATION (read-only Graph access)
  8. Graph client factory (per-user, authenticated)
  9. Mail service (getMessages, getMessage, getMailFolders)
  10. Webhook subscription service + handler (POST /webhooks/graph)
  11. Event collector + metadata extractor
  12. Delta sync service + BullMQ delta-sync job
  13. Webhook renewal BullMQ job
  14. Token refresh BullMQ job
  WHY THIRD: Before detecting patterns, you need events. Observation is read-only and safe.
  DEPENDS ON: Phase 2 (tokens for Graph API access).

PHASE 4: FRONTEND SHELL + OBSERVATION UI
  15. React + Vite + Tailwind + shadcn/ui setup
  16. Auth flow (login page, JWT storage, protected routes)
  17. Layout (sidebar, topbar, navigation)
  18. Dashboard (stats cards, activity feed — static then live)
  19. Email Activity page (events table, filters)
  20. Socket.IO integration (useWebSocket hook, real-time events)
  WHY FOURTH: Gives visual feedback for observation phase. Developers can verify events are being collected.
  DEPENDS ON: Phase 2 (auth), Phase 3 (events to display).

PHASE 5: INTELLIGENCE (pattern detection)
  21. Subject normalizer
  22. Confidence scorer
  23. Pattern detector (sender, subject, folder, composite)
  24. Pattern analysis BullMQ job (daily cron)
  25. Frontend: Patterns page (view, approve, reject, customize)
  WHY FIFTH: Patterns require accumulated events to analyze.
  DEPENDS ON: Phase 3 (EmailEvents in MongoDB).

PHASE 6: AUTOMATION (write actions via Graph API)
  26. Rule engine (priority matching, condition evaluation)
  27. Staging manager (grace period, MSEDB Staging folder)
  28. Staging processor BullMQ job
  29. Undo service
  30. Frontend: Rules page (list, reorder, create wizard)
  31. Frontend: Staging page (countdown, rescue, execute)
  32. Frontend: Audit log (history, undo button)
  WHY SIXTH: Automation is the riskiest component (writes to user mailbox). Should be built after observation and patterns are stable.
  DEPENDS ON: Phase 5 (patterns → rules), Phase 3 (Graph write operations).

PHASE 7: POLISH
  33. Frontend: Settings page (preferences, whitelist, connection)
  34. Frontend: Admin panel (user management, org rules, health)
  35. Notification system (in-app + Socket.IO push)
  36. Daily digest BullMQ job
  37. Error handling hardening, rate limit handling
  38. docker-compose.dev.yml with hot reload
  WHY LAST: Settings and notifications are non-critical-path features.
  DEPENDS ON: All previous phases.
```

## Sources

- [Microsoft Graph Webhook Delivery via Webhooks](https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks) -- HIGH confidence. Official documentation on subscription creation, validation handshake, notification delivery, throttling behavior, and response time requirements.
- [Microsoft Graph Lifecycle Notifications](https://learn.microsoft.com/en-us/graph/change-notifications-lifecycle-events) -- HIGH confidence. Official documentation on reauthorizationRequired, subscriptionRemoved, and missed lifecycle events.
- [Microsoft Graph Subscription Resource Type](https://learn.microsoft.com/en-us/graph/api/resources/subscription?view=graph-rest-1.0) -- HIGH confidence. Official documentation on maximum subscription lifetimes (Outlook message: 10,080 min / ~7 days), latency expectations (mail: <1 min average, 3 min max).
- [Microsoft Graph Delta Query for Messages](https://learn.microsoft.com/en-us/graph/delta-query-messages) -- HIGH confidence. Official documentation on per-folder delta sync, nextLink/deltaLink pagination, `@removed` annotations, and `$select`/`$filter` support.
- [Microsoft Graph Throttling Guidance](https://learn.microsoft.com/en-us/graph/throttling) -- HIGH confidence. Official documentation on rate limiting, Retry-After header handling, and batching (up to 20 requests per batch).
- [MSAL Node Token Caching](https://learn.microsoft.com/en-us/entra/msal/javascript/node/caching) -- HIGH confidence. Official documentation on persistent token caching for confidential clients, encryption recommendations.
- [MSAL Token Lifetimes](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/token-lifetimes) -- MEDIUM confidence. Official docs but browser-focused; Node.js confidential client has similar but not identical behavior.
- [BullMQ Documentation](https://docs.bullmq.io) -- HIGH confidence. Official BullMQ docs for job queues, cron scheduling, retry logic, parent-child jobs.
- [Microsoft Graph Change Notifications for Outlook](https://learn.microsoft.com/en-us/graph/outlook-change-notifications-overview) -- HIGH confidence. Outlook-specific subscription and notification details.

---
*Architecture research for: Microsoft Graph email intelligence and automation portal*
*Researched: 2026-02-16*
