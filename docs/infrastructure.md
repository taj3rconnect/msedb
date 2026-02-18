# Infrastructure — MSEDB

Detailed technical reference for MSEDB's architecture, database schemas, background jobs, networking, and security.

---

## Table of Contents

1. [Container Architecture](#container-architecture)
2. [Network Configuration](#network-configuration)
3. [Backend Architecture](#backend-architecture)
4. [Database Schemas](#database-schemas)
5. [Redis Data Patterns](#redis-data-patterns)
6. [Background Jobs (BullMQ)](#background-jobs-bullmq)
7. [API Endpoints](#api-endpoints)
8. [Authentication Architecture](#authentication-architecture)
9. [Security Architecture](#security-architecture)
10. [Real-time Communication](#real-time-communication)
11. [Data Lifecycle](#data-lifecycle)
12. [Health Monitoring](#health-monitoring)
13. [Scaling Considerations](#scaling-considerations)

---

## Container Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Docker Host                                │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    msedb-network (bridge)                    │ │
│  │                                                              │ │
│  │  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐    │ │
│  │  │  msedb-      │   │  msedb-      │   │  msedb-      │    │ │
│  │  │  frontend    │──>│  backend     │──>│  mongo       │    │ │
│  │  │  (nginx)     │   │  (Express 5) │──>│  (MongoDB 7) │    │ │
│  │  │  :8080       │   │  :8010       │   │  :27017      │    │ │
│  │  │  0.5C/512M   │   │  2.0C/2GB    │   │  2.0C/2GB    │    │ │
│  │  └──────────────┘   └──────┬───────┘   └──────────────┘    │ │
│  │                            │                                 │ │
│  │                     ┌──────┴───────┐                        │ │
│  │                     │  msedb-      │                        │ │
│  │                     │  redis       │                        │ │
│  │                     │  (Redis 7)   │                        │ │
│  │                     │  :6379       │                        │ │
│  │                     │  0.5C/512M   │                        │ │
│  │                     └──────────────┘                        │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  Host ports: 3010 → frontend:8080                                │
│              8010 → backend:8010                                  │
│              27020 → mongo:27017                                  │
│              6382 → redis:6379                                    │
└──────────────────────────────────────────────────────────────────┘
```

| Container | Base Image | Process Manager | User | Volumes |
|-----------|-----------|-----------------|------|---------|
| msedb-backend | `node:22-alpine` | tini (PID 1) | appuser:1001 | `msedb-logs:/app/logs` |
| msedb-frontend | `nginxinc/nginx-unprivileged:alpine` | nginx | nginx (built-in) | — |
| msedb-mongo | `mongo:7` | mongod | mongodb (built-in) | `msedb-mongo-data:/data/db` |
| msedb-redis | `redis:7-alpine` | redis-server | redis (built-in) | `msedb-redis-data:/data` |

---

## Network Configuration

### Internal Network

All containers communicate over the `msedb-network` bridge network using service names:

| From | To | Service Name | Port |
|------|----|-------------|------|
| Frontend (nginx) | Backend | `msedb-backend` | 8010 |
| Backend | MongoDB | `msedb-mongo` | 27017 |
| Backend | Redis | `msedb-redis` | 6379 |

### Nginx Reverse Proxy Rules

The frontend nginx container proxies API and WebSocket traffic to the backend:

| Path | Upstream | Notes |
|------|----------|-------|
| `/socket.io/` | `http://msedb-backend:8010/socket.io/` | WebSocket upgrade, 86400s timeout |
| `/api/` | `http://msedb-backend:8010/api/` | API proxy |
| `/webhooks/` | `http://msedb-backend:8010/webhooks/` | Graph webhook proxy |
| `/auth/` | `http://msedb-backend:8010/auth/` | OAuth flow proxy |
| `/*` | Local SPA | `try_files $uri $uri/ /index.html` |

Gzip compression enabled for HTML, JSON, CSS, JS (minimum 256 bytes).

### External Network Requirements

| Destination | Port | Purpose |
|-------------|------|---------|
| `login.microsoftonline.com` | 443 | Azure AD OAuth |
| `graph.microsoft.com` | 443 | Microsoft Graph API |
| Cloudflare Tunnel | 7844 | Tunnel connection (if configured) |

### Host Port Coexistence

MSEDB is designed to run alongside other Docker services:

| Port Range | Service |
|------------|---------|
| 3002 / 8002 | TZMonitor |
| 3005 / 8005 | AiChatDesk |
| 3010 / 8010 / 27020 / 6382 | **MSEDB** |

---

## Backend Architecture

### Startup Sequence

`server.ts` orchestrates startup in this order:

1. **MongoDB connection** — Up to 10 retries with exponential backoff (1s base, 30s max cap)
2. **Redis verification** — Single ping check
3. **Security middleware** — Helmet, CORS, compression, body parsing
4. **Rate limiters** — Auth (5/min) and API (100/min), Redis-backed
5. **Route mounting** — Auth, webhooks, health, API routes
6. **Error handler** — Global error middleware (last)
7. **BullMQ schedulers** — 5 scheduled jobs initialized via `upsertJobScheduler`
8. **Webhook sync** — Syncs subscriptions for all connected mailboxes
9. **Socket.IO server** — Attached to HTTP server
10. **HTTP listen** — Port 8010

### Graceful Shutdown

On SIGTERM/SIGINT:
1. Close all BullMQ workers (drain pending jobs)
2. Close all BullMQ queues
3. Disconnect Mongoose
4. Quit Redis client

### Error Handling

Error class hierarchy:
```
AppError (base, 500)
├── ValidationError (400)
├── UnauthorizedError (401)
├── ForbiddenError (403)
├── NotFoundError (404)
└── ConflictError (409)
```

- Development: Full stack traces in response
- Production: Generic "Internal server error" for 500s

### Logging

Winston with two file transports:
- `/app/logs/error.log` — Error level only, 10MB max, 5 rotation files
- `/app/logs/combined.log` — All levels, 10MB max, 10 rotation files
- Console: Colorized simple (dev) or JSON (production)

---

## Database Schemas

### User (`users`)

| Field | Type | Notes |
|-------|------|-------|
| `email` | String | Unique, required |
| `microsoftId` | String | Unique, sparse |
| `displayName` | String | |
| `role` | Enum | `admin` or `user` (default: `user`) |
| `isActive` | Boolean | Default: `true` |
| `preferences.automationPaused` | Boolean | Kill switch (default: `false`) |
| `preferences.workingHoursStart` | Number | Default: 9 |
| `preferences.workingHoursEnd` | Number | Default: 17 |
| `preferences.aggressiveness` | Enum | `conservative`, `moderate`, `aggressive` (default: `moderate`) |
| `encryptedTokens.accessToken` | String | AES-256-GCM encrypted |
| `encryptedTokens.refreshToken` | String | AES-256-GCM encrypted |
| `encryptedTokens.expiresAt` | Date | |
| `msalCache` | String | MSAL serialized cache |
| `invitedBy` | ObjectId | Ref: User |
| `lastLoginAt` | Date | |

**Indexes:** `{ email: 1 }` (unique), `{ microsoftId: 1 }` (unique, sparse)

### Mailbox (`mailboxes`)

| Field | Type | Notes |
|-------|------|-------|
| `userId` | ObjectId | Ref: User, required |
| `email` | String | Required |
| `displayName` | String | |
| `tenantId` | String | |
| `homeAccountId` | String | Unique, sparse |
| `isConnected` | Boolean | Default: `true` |
| `encryptedTokens` | Object | Same structure as User |
| `msalCache` | String | |
| `lastSyncAt` | Date | |
| `deltaLinks` | Map<String, String> | Per-folder delta query tokens |
| `settings.automationPaused` | Boolean | Per-mailbox kill switch |
| `settings.whitelistedSenders` | [String] | Per-mailbox sender whitelist |
| `settings.whitelistedDomains` | [String] | Per-mailbox domain whitelist |

**Indexes:** `{ userId: 1, email: 1 }` (unique), `{ userId: 1 }`, `{ homeAccountId: 1 }` (unique, sparse)

### EmailEvent (`emailevents`)

| Field | Type | Notes |
|-------|------|-------|
| `userId` | ObjectId | Required |
| `mailboxId` | ObjectId | Required |
| `messageId` | String | Graph message ID |
| `internetMessageId` | String | RFC 2822 message ID |
| `eventType` | Enum | `arrived`, `deleted`, `moved`, `read`, `flagged`, `categorized` |
| `timestamp` | Date | Required |
| `sender.name` | String | |
| `sender.email` | String | |
| `sender.domain` | String | Extracted from email |
| `subject` | String | |
| `subjectNormalized` | String | Lowercased, trimmed |
| `receivedAt` | Date | |
| `timeToAction` | Number | Milliseconds from received to action |
| `fromFolder` | String | Source folder ID |
| `toFolder` | String | Destination folder ID (for moves) |
| `importance` | String | |
| `hasAttachments` | Boolean | |
| `conversationId` | String | |
| `categories` | [String] | |
| `isRead` | Boolean | |
| `metadata.hasListUnsubscribe` | Boolean | Newsletter indicator |
| `metadata.isNewsletter` | Boolean | |
| `metadata.isAutomated` | Boolean | |
| `metadata.automatedByRule` | ObjectId | Which rule processed this |

**Indexes:**
- `{ userId: 1, 'sender.domain': 1, timestamp: -1 }` — Pattern analysis queries
- `{ userId: 1, eventType: 1, timestamp: -1 }` — Event filtering
- `{ userId: 1, mailboxId: 1, messageId: 1, eventType: 1 }` (unique) — Deduplication
- `{ timestamp: 1 }` (TTL: 90 days) — Auto-cleanup

### Pattern (`patterns`)

| Field | Type | Notes |
|-------|------|-------|
| `userId` | ObjectId | Required |
| `mailboxId` | ObjectId | Required |
| `patternType` | Enum | `sender`, `folder-routing` |
| `status` | Enum | `detected`, `suggested`, `approved`, `rejected`, `expired` |
| `confidence` | Number | 0-100 |
| `sampleSize` | Number | Total observations |
| `exceptionCount` | Number | Counter-examples |
| `condition.senderEmail` | String | |
| `condition.senderDomain` | String | |
| `condition.fromFolder` | String | |
| `condition.subjectPattern` | String | |
| `suggestedAction.actionType` | Enum | `delete`, `move`, `archive`, `markRead` |
| `suggestedAction.toFolder` | String | Target folder ID |
| `suggestedAction.category` | String | |
| `evidence` | [Object] | Max 10 items |
| `rejectedAt` | Date | |
| `rejectionCooldownUntil` | Date | 30 days after rejection |
| `approvedAt` | Date | |
| `lastAnalyzedAt` | Date | |

**Indexes:**
- `{ userId: 1, mailboxId: 1, status: 1 }`
- `{ userId: 1, patternType: 1, 'condition.senderDomain': 1 }`
- `{ rejectionCooldownUntil: 1 }` (sparse)

### Rule (`rules`)

| Field | Type | Notes |
|-------|------|-------|
| `userId` | ObjectId | Required |
| `mailboxId` | ObjectId | Optional (null for org rules) |
| `name` | String | Required |
| `sourcePatternId` | ObjectId | Ref: Pattern |
| `isEnabled` | Boolean | Default: `true` |
| `priority` | Number | Lower = higher priority |
| `conditions.senderEmail` | String | Case-insensitive match |
| `conditions.senderDomain` | String | Case-insensitive match |
| `conditions.subjectContains` | String | Case-insensitive substring |
| `conditions.fromFolder` | String | Exact parentFolderId match |
| `actions` | [Object] | `{ actionType, toFolder, category, order }` |
| `stats.totalExecutions` | Number | Default: 0 |
| `stats.lastExecutedAt` | Date | |
| `stats.emailsProcessed` | Number | Default: 0 |
| `graphRuleId` | String | Reserved for Graph rule sync |
| `scope` | Enum | `user`, `org` |
| `createdBy` | ObjectId | |

**Indexes:**
- `{ userId: 1, mailboxId: 1, isEnabled: 1, priority: 1 }`
- `{ graphRuleId: 1 }` (sparse)

### StagedEmail (`stagedemails`)

| Field | Type | Notes |
|-------|------|-------|
| `userId` | ObjectId | Required |
| `mailboxId` | ObjectId | Required |
| `ruleId` | ObjectId | Ref: Rule |
| `messageId` | String | Graph message ID |
| `originalFolder` | String | Folder ID before staging |
| `stagedAt` | Date | |
| `expiresAt` | Date | stagedAt + 24 hours |
| `cleanupAt` | Date | expiresAt + 7 days (TTL target) |
| `status` | Enum | `staged`, `executed`, `rescued`, `expired` |
| `actions` | [Object] | `{ actionType, toFolder }` |
| `executedAt` | Date | |
| `rescuedAt` | Date | |

**Indexes:**
- `{ userId: 1, status: 1, expiresAt: 1 }`
- `{ cleanupAt: 1 }` (TTL) — Auto-deletes documents 7 days after expiry

### AuditLog (`auditlogs`)

| Field | Type | Notes |
|-------|------|-------|
| `userId` | ObjectId | |
| `mailboxId` | ObjectId | |
| `action` | Enum | 13 types (see below) |
| `targetType` | Enum | `email`, `rule`, `pattern`, `settings` |
| `targetId` | String | |
| `details` | Mixed | Action-specific payload |
| `undoable` | Boolean | |
| `undoneAt` | Date | |
| `undoneBy` | ObjectId | |

**Action types:** `rule_created`, `rule_updated`, `rule_deleted`, `rule_executed`, `email_staged`, `email_rescued`, `email_executed`, `pattern_approved`, `pattern_rejected`, `automation_paused`, `automation_resumed`, `undo_action`, `whitelist_updated`

**Indexes:**
- `{ userId: 1, action: 1, createdAt: -1 }`
- `{ userId: 1, mailboxId: 1, createdAt: -1 }`
- `{ targetType: 1, targetId: 1 }`

### Notification (`notifications`)

| Field | Type | Notes |
|-------|------|-------|
| `userId` | ObjectId | Required |
| `type` | Enum | `pattern_detected`, `rule_executed`, `staging_alert`, `system`, `inactivity_warning`, `token_expiring` |
| `title` | String | |
| `message` | String | |
| `isRead` | Boolean | Default: `false` |
| `readAt` | Date | |
| `relatedEntity.entityType` | String | |
| `relatedEntity.entityId` | ObjectId | |
| `priority` | Enum | `low`, `normal`, `high` |

**Indexes:**
- `{ userId: 1, isRead: 1, createdAt: -1 }`
- `{ createdAt: 1 }` (TTL: 30 days)

### WebhookSubscription (`webhooksubscriptions`)

| Field | Type | Notes |
|-------|------|-------|
| `userId` | ObjectId | Required |
| `mailboxId` | ObjectId | Required |
| `subscriptionId` | String | Graph subscription ID, unique |
| `resource` | String | Graph resource path |
| `changeType` | String | `created,updated,deleted` |
| `expiresAt` | Date | Max 3 days from creation |
| `notificationUrl` | String | Public webhook endpoint |
| `lifecycleNotificationUrl` | String | |
| `clientState` | String | Validation token |
| `status` | Enum | `active`, `expired`, `failed` |
| `lastNotificationAt` | Date | |
| `errorCount` | Number | Default: 0 |

**Indexes:**
- `{ subscriptionId: 1 }` (unique)
- `{ userId: 1, mailboxId: 1 }`
- `{ expiresAt: 1, status: 1 }`

---

## Redis Data Patterns

### Configuration

```
--appendonly yes          # AOF persistence
--maxmemory 384mb         # Memory cap
--maxmemory-policy noeviction  # Required for BullMQ (never evict job keys)
```

### Key Patterns

| Key Pattern | Data Type | Purpose | TTL |
|-------------|-----------|---------|-----|
| `rl:auth:{ip}` | String | Auth rate limiter counter | 60s |
| `rl:api:{ip}` | String | API rate limiter counter | 60s |
| `org:whitelist:senders` | Set | Org-wide whitelisted sender emails | None |
| `org:whitelist:domains` | Set | Org-wide whitelisted domains | None |
| `bull:webhook-events:*` | Various | BullMQ queue data | Job-dependent |
| `bull:webhook-renewal:*` | Various | BullMQ queue data | Job-dependent |
| `bull:delta-sync:*` | Various | BullMQ queue data | Job-dependent |
| `bull:pattern-analysis:*` | Various | BullMQ queue data | Job-dependent |
| `bull:staging-processor:*` | Various | BullMQ queue data | Job-dependent |
| `bull:token-refresh:*` | Various | BullMQ queue data | Job-dependent |

### Connection Strategy

Three separate connection modes for Redis:
1. **General client** (ioredis singleton) — Rate limiting, org whitelist, health checks
2. **Queue connections** (plain config objects) — BullMQ queue creation (`enableOfflineQueue: false`)
3. **Worker connections** (plain config objects) — BullMQ workers (`maxRetriesPerRequest: null` for blocking)

---

## Background Jobs (BullMQ)

### Queue Configuration

All queues share these default job options:
- `removeOnComplete: { age: 3600, count: 200 }` — Keep completed jobs 1h or last 200
- `removeOnFail: { age: 86400, count: 1000 }` — Keep failed jobs 24h or last 1000

### Job Schedules

| Job | Type | Schedule | Retry | Backoff |
|-----|------|----------|-------|---------|
| Webhook Renewal | Cron | `0 */2 * * *` (every 2h) | 3 attempts | Exponential, 5s base |
| Delta Sync | Interval | 900,000ms (15min) | 3 attempts | Exponential, 5s base |
| Pattern Analysis | Cron | `0 2 * * *` (daily 2 AM) | 3 attempts | Exponential, 5s base |
| Staging Processor | Interval | 1,800,000ms (30min) | 3 attempts | Exponential, 5s base |
| Token Refresh | Interval | 2,700,000ms (45min) | 3 attempts | Exponential, 5s base |

### Job Processor Details

**Webhook Events (`processWebhookEvent`)**
- Input: Single Graph change notification
- Delegates to `eventCollector.processChangeNotification()`
- Extracts metadata, determines event type, stores EmailEvent
- Triggers rule evaluation for the affected email

**Webhook Renewal (`processWebhookRenewal`)**
- Two job types: `renew-webhooks` (periodic) and `lifecycle-event` (on-demand)
- Queries all connected mailboxes
- For each: checks if subscription exists and is expiring within 12h
- Creates new or renews existing subscription via Graph API
- Handles lifecycle events: `subscriptionRemoved`, `missed`, `reauthorizationRequired`

**Delta Sync (`processDeltaSync`)**
- Two job types: `run-delta-sync` (periodic) and `lifecycle-delta-sync` (triggered)
- Iterates all connected mailboxes
- For each mailbox: queries `deltaService.runDeltaSyncForMailbox()`
- Uses delta links for incremental sync (only new changes since last sync)

**Pattern Analysis (`processPatternAnalysis`)**
- Two job types: `run-pattern-analysis` (daily) and `on-demand-analysis` (API trigger)
- Calls `patternEngine.analyzeMailboxPatterns()` per mailbox
- Generates notifications for new pattern suggestions

**Staging Processor (`processStagingItems`)**
- Finds StagedEmails where `status === 'staged'` and `expiresAt <= now`
- Processes in chunks of 5 (prevents Graph API rate limiting)
- Executes pending actions via `actionExecutor`
- Handles 404 gracefully (message already deleted)
- Handles 429 by skipping (retry on next run)
- All deletes are soft-delete (move to Deleted Items)

**Token Refresh (`processTokenRefresh`)**
- Queries ALL connected mailboxes (MSAL handles caching internally)
- Calls `acquireTokenSilent()` per mailbox
- On `interaction_required`: sets `mailbox.isConnected = false`, creates high-priority notification
- On other errors: logs warning, continues to next mailbox

---

## API Endpoints

### Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/auth/login` | None | Redirects to Azure AD authorization |
| GET | `/auth/callback` | None | OAuth callback, sets JWT cookie |
| POST | `/auth/logout` | Cookie | Clears session cookie |
| GET | `/auth/me` | SSO or Cookie | Returns current user + mailboxes |

### Webhooks

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/webhooks/graph` | Client state | Graph webhook validation + change notifications |

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | None | Service health (MongoDB, Redis, queues) |

### Dashboard

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/dashboard/stats` | Cookie | Aggregate stats (emails, patterns, rules) |
| GET | `/api/dashboard/activity` | Cookie | Recent email events feed |

### Events

| Method | Path | Auth | Query Params | Description |
|--------|------|------|-------------|-------------|
| GET | `/api/events` | Cookie | `mailboxId, eventType, senderDomain, page, limit, sortBy, sortOrder` | Paginated events |
| GET | `/api/events/sender-breakdown` | Cookie | `mailboxId` | Top 20 domains |
| GET | `/api/events/timeline` | Cookie | `mailboxId` | Hourly (24h) or daily (30d) buckets |

### Patterns

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/patterns` | Cookie | List patterns (filter by mailbox, status) |
| POST | `/api/patterns/analyze` | Cookie | Trigger on-demand analysis |
| POST | `/api/patterns/:id/approve` | Cookie | Approve + auto-create rule |
| POST | `/api/patterns/:id/reject` | Cookie | Reject (30-day cooldown) |
| POST | `/api/patterns/:id/customize` | Cookie | Customize action + approve |

### Rules

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/rules` | Cookie | List rules (filter by mailbox) |
| POST | `/api/rules` | Cookie | Create manual rule |
| POST | `/api/rules/from-pattern` | Cookie | Convert approved pattern to rule |
| PUT | `/api/rules/reorder` | Cookie | Reorder rules (array of IDs) |
| PUT | `/api/rules/:id` | Cookie | Update rule |
| PATCH | `/api/rules/:id/toggle` | Cookie | Enable/disable |
| DELETE | `/api/rules/:id` | Cookie | Delete rule |

### Staging

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/staging` | Cookie | List staged emails |
| GET | `/api/staging/count` | Cookie | Active count (for badge) |
| POST | `/api/staging/:id/rescue` | Cookie | Rescue (undo staging) |
| POST | `/api/staging/batch-rescue` | Cookie | Batch rescue |
| POST | `/api/staging/:id/execute` | Cookie | Execute immediately |
| POST | `/api/staging/batch-execute` | Cookie | Batch execute |

### Audit

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/audit` | Cookie | Filterable audit log |
| POST | `/api/audit/:id/undo` | Cookie | Undo action (48h window) |

### Notifications

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/notifications` | Cookie | List notifications |
| GET | `/api/notifications/unread-count` | Cookie | Unread count |
| PATCH | `/api/notifications/read-all` | Cookie | Mark all read |
| PATCH | `/api/notifications/:id/read` | Cookie | Mark one read |

### Settings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/settings` | Cookie | User settings + mailbox status |
| GET | `/api/settings/export-data` | Cookie | Download all user data as JSON |
| DELETE | `/api/settings/delete-data` | Cookie | Delete account + all data |

### User

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| PATCH | `/api/user/preferences` | Cookie | Update preferences |

### Mailboxes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/mailboxes` | Cookie | List user's mailboxes |
| POST | `/api/mailboxes/connect` | Cookie | Start OAuth for new mailbox |
| DELETE | `/api/mailboxes/:id/disconnect` | Cookie | Disconnect mailbox |
| GET | `/api/mailboxes/:id/whitelist` | Cookie | Per-mailbox whitelist |
| PUT | `/api/mailboxes/:id/whitelist` | Cookie | Update per-mailbox whitelist |
| GET | `/api/mailboxes/org-whitelist` | Admin | Org-wide whitelist |
| PUT | `/api/mailboxes/org-whitelist` | Admin | Update org-wide whitelist |

### Admin

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/admin/invite` | Admin | Invite user by email |
| GET | `/api/admin/users` | Admin | List all users |
| PATCH | `/api/admin/users/:id/role` | Admin | Change user role |
| PATCH | `/api/admin/users/:id/deactivate` | Admin | Deactivate user |
| GET | `/api/admin/analytics` | Admin | Aggregate analytics |
| GET | `/api/admin/health` | Admin | Per-mailbox health details |
| POST | `/api/admin/org-rules` | Admin | Create org-wide rule |
| GET | `/api/admin/org-rules` | Admin | List org-wide rules |
| DELETE | `/api/admin/org-rules/:id` | Admin | Delete org-wide rule |

---

## Authentication Architecture

### Cookie-Based (Dashboard)

```
Browser → GET /auth/login → Azure AD → GET /auth/callback
                                              │
                                    ┌─────────┴─────────┐
                                    │ MSAL acquireToken  │
                                    │ Encrypt + store    │
                                    │ Sign JWT           │
                                    │ Set httpOnly cookie │
                                    └─────────┬─────────┘
                                              │
Browser ← 302 redirect to dashboard ──────────┘
                                              │
Browser → GET /api/* (cookie: msedb_session) ─┘
         └→ requireAuth middleware validates JWT
```

- JWT signed with `JWT_SECRET`, 24h expiry
- Cookie: `msedb_session`, httpOnly, sameSite=lax, secure in production
- JWT payload: `{ userId, email, role }`

### SSO Bearer Token (Outlook Add-in)

```
Add-in → MSAL NAA acquireTokenSilent → Azure AD
                                           │
Add-in ← Access Token ────────────────────┘
                                           │
Add-in → GET /auth/me (Authorization: Bearer <token>)
         └→ requireSsoAuth middleware:
            1. Extract token from header
            2. Decode header, get kid
            3. Fetch signing key from Azure AD JWKS endpoint
            4. Verify signature (RS256)
            5. Validate audience (api://<CLIENT_ID>)
            6. Validate issuer (login.microsoftonline.com/<TENANT_ID>)
            7. Check scp includes "access_as_user"
            8. Look up user by preferred_username (email)
```

### Composite Auth (`requireSsoOrCookieAuth`)

Used on `/auth/me` to support both dashboard and add-in:
1. Check for `Authorization: Bearer` header → try SSO validation
2. If no Bearer or SSO fails → fall back to cookie validation
3. If both fail → 401 Unauthorized

---

## Security Architecture

### Middleware Stack (applied in order)

1. **Helmet** — Security headers (X-Content-Type-Options, X-Frame-Options, etc.)
2. **CORS** — Multi-origin callback checking `[config.appUrl, config.addinUrl]`
3. **Compression** — gzip response compression
4. **Body parsing** — JSON + URL-encoded, 1MB limit
5. **Rate limiting** — Redis-backed, per-IP
6. **Authentication** — JWT cookie or Bearer token validation
7. **Authorization** — Role check (`requireAdmin` for admin routes)

### Encryption

All OAuth tokens stored in MongoDB are encrypted:
- **Algorithm:** AES-256-GCM
- **Key:** 256-bit from `ENCRYPTION_KEY` environment variable
- **IV:** 96-bit (12 bytes), cryptographically random per encryption
- **Auth tag:** 128-bit (16 bytes)
- **Storage format:** `{iv}:{authTag}:{ciphertext}` (hex-encoded)

### Data Isolation

- All database queries include `userId` filter (query-level isolation)
- No cross-user data access possible through the API
- Admin routes have separate authorization middleware
- Org-wide resources (whitelist, rules) explicitly scoped with admin checks

### Graph API Security

- All Graph API calls use `$select` to request only needed fields
- Email body content is never requested or stored
- Webhook validation uses `clientState` for notification authenticity
- Graph API tokens are stored encrypted, never exposed to frontend

---

## Real-time Communication

### Socket.IO Architecture

```
Frontend (React)                Backend (Express)
     │                                │
     ├─── connect ────────────────────┤
     │    (sends msedb_session cookie) │
     │                                ├── JWT middleware validates cookie
     │                                ├── Joins room: user:{userId}
     │                                │
     │<── notification:new ───────────┤ (notificationService creates notification)
     │<── email:event ────────────────┤ (eventCollector processes webhook)
     │<── staging:new ────────────────┤ (stagingManager creates staged email)
     │                                │
     ├── (TanStack Query invalidation)│
     │   email:event → ['dashboard', 'events']
     │   staging:new → ['staging-count', 'staging']
     │   notification:new → Zustand store + ['notifications']
```

### Event Delivery

Events are delivered to specific users via rooms:
```javascript
io.to(`user:${userId}`).emit('email:event', eventData);
```

---

## Data Lifecycle

### Automatic Cleanup (TTL Indexes)

| Collection | TTL | Trigger |
|------------|-----|---------|
| EmailEvent | 90 days | `timestamp` field |
| Notification | 30 days | `createdAt` field |
| StagedEmail | ~31 days | `cleanupAt` (expiresAt + 7 days) |

### Retention Summary

| Data | Retention | Location |
|------|-----------|----------|
| Email events | 90 days | MongoDB (TTL) |
| Patterns | Indefinite | MongoDB |
| Rules | Indefinite | MongoDB |
| Audit logs | Indefinite | MongoDB |
| Notifications | 30 days | MongoDB (TTL) |
| Staged emails | 24h active + 7d cleanup | MongoDB (TTL) |
| BullMQ completed jobs | 1 hour or last 200 | Redis |
| BullMQ failed jobs | 24 hours or last 1000 | Redis |
| Application logs | 10MB × 10 files (combined) | Volume mount |
| Error logs | 10MB × 5 files | Volume mount |

### User Data Deletion

`DELETE /api/settings/delete-data` removes:
- User document
- All mailboxes (disconnects webhooks)
- All email events
- All patterns
- All rules
- All staged emails
- All audit logs
- All notifications

---

## Health Monitoring

### `GET /api/health` (Public)

Returns overall system health:

```json
{
  "status": "healthy",       // or "degraded"
  "uptime": 86400.123,
  "timestamp": "2026-02-18T12:00:00.000Z",
  "version": "1.0.0",
  "services": {
    "mongodb": "connected",  // or "disconnected"
    "redis": "connected"     // or "disconnected" or "error"
  },
  "queues": { "count": 6 },
  "subscriptions": { "active": 3 },
  "tokens": { "healthy": 2 }
}
```

Status is `degraded` if MongoDB OR Redis is not connected.

### `GET /api/admin/health` (Admin Only)

Returns per-mailbox details:
- Webhook subscription status per mailbox
- Token expiry and refresh health per user
- Last sync timestamps

---

## Scaling Considerations

### Current Limits

- **Single-host deployment** — All 4 containers on one machine
- **5 CPU / 5GB RAM** — Hard limit from Docker resource constraints
- **384MB Redis** — Sufficient for job queues + rate limiting + org whitelist
- **MongoDB pool** — 50 max / 5 min connections
- **Rate limits** — 100 API requests/min per IP

### Bottleneck Analysis

| Component | Bottleneck Point | Mitigation |
|-----------|-----------------|------------|
| Graph API | 10,000 requests per 10 min per app | BullMQ serializes requests, staging processes in chunks of 5 |
| MongoDB | Email events ingestion rate | Compound indexes, 90-day TTL keeps collection bounded |
| Redis | Memory (384MB, noeviction) | Job retention limits (200 complete, 1000 failed) |
| Webhook processing | Burst notifications | 202 immediate response, BullMQ absorbs bursts |
| Pattern analysis | Large mailbox history | 90-day observation window, daily schedule (off-peak) |

### Horizontal Scaling Path (Future)

If scaling beyond single host:
1. **MongoDB** → Replica set (read scaling) or sharding (write scaling)
2. **Redis** → Redis Cluster or separate instances for jobs vs. caching
3. **Backend** → Multiple instances behind load balancer (sticky sessions for Socket.IO)
4. **Workers** → Separate BullMQ worker containers (decouple from API)
5. **Frontend** → CDN for static assets, multiple nginx instances
