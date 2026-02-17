# MSEDB — Product Requirements Document (PRD)

## Microsoft Email DashBoard — Email Intelligence & Automation Portal

**Version:** 1.1 (Final)  
**Author:** Taj  
**Date:** February 16, 2026  
**Status:** Approved  
**Server:** DGX Server at `http://172.16.219.222/`

---

## 1. Executive Summary

MSEDB (Microsoft Email DashBoard) is a fully containerized, self-hosted, multi-tenant email management portal that connects to Microsoft 365 via Microsoft Graph API. It passively observes how users interact with their email — which messages they delete, move, archive, or keep — learns behavioral patterns over time, and then automates repetitive email management tasks with user approval.

The entire application runs as a Docker Compose stack on the DGX server, with zero software installed on the host. This ensures complete isolation from other services (TZMonitor, AiChatDesk) running on the same server.

This PRD covers the **Phase 1 MVP**: the Intelligent Email Cleanup feature. The platform is designed from the ground up to support future features including rule-based auto-responses, AI-powered email drafting, and more.

---

## 2. Problem Statement

Knowledge workers spend 2-3 hours per day managing email. A significant portion of that time is spent on repetitive, low-value actions: deleting the same newsletters, moving invoices to the same folder, ignoring the same notifications. Existing Outlook rules require manual setup and don't adapt to changing behavior. Users need a system that learns from their habits and automates email management intelligently.

---

## 3. Target Users

| User Type | Description |
|-----------|-------------|
| **Primary Admin (Taj)** | Platform owner, full access, manages tenant configuration and Azure AD app registration |
| **Company Users** | Employees of the staffing company who are invited by admin, connect their own O365 accounts, and get personalized automation |
| **Future: External Clients** | Potential SaaS offering for other businesses (out of scope for MVP) |

---

## 4. Product Vision & Phased Roadmap

### Phase 1 — Intelligent Email Cleanup (THIS PRD)
- Passive email behavior observation
- Pattern detection and rule suggestion
- User-approved automation (delete, move, archive)
- Multi-user support with admin management

### Phase 2 — Smart Auto-Responses (Future)
- Rule-based auto-reply templates
- AI-powered response drafting using Claude API
- Conditional response logic (time of day, sender, keywords)

### Phase 3 — Advanced Email Intelligence (Future)
- Email prioritization and smart inbox sorting
- Meeting/action item extraction
- Sender reputation scoring
- Cross-user pattern sharing (team-level rules)

### Phase 4 — SaaS Platform (Future)
- Multi-tenant architecture for external companies
- Billing and subscription management
- White-label options

---

## 5. Infrastructure & Deployment Architecture

### 5.1 Deployment Model

**Fully containerized Docker Compose stack.** Nothing is installed on the DGX host. All four services run in isolated containers on a dedicated Docker bridge network.

### 5.2 Container Architecture

| Container | Image Base | Port (Host) | Port (Container) | Resource Limits |
|-----------|-----------|-------------|-------------------|-----------------|
| `msedb-frontend` | node:20-alpine → nginx:alpine (multi-stage) | 3010 | 80 | 0.5 CPU, 512MB RAM |
| `msedb-backend` | node:20-alpine (multi-stage) | 8010 | 8010 | 2.0 CPU, 2GB RAM |
| `msedb-mongo` | mongo:7 | 27020 | 27017 | 2.0 CPU, 2GB RAM |
| `msedb-redis` | redis:7-alpine | 6382 | 6379 | 0.5 CPU, 512MB RAM |

### 5.3 Network Isolation

- All containers join a dedicated `msedb-network` (Docker bridge)
- Containers communicate using service names (e.g., `msedb-mongo:27017`)
- Only frontend (3010) and backend (8010) are exposed to the host network
- MongoDB (27020) and Redis (6382) exposed to host only for debugging — can be removed in production

### 5.4 Port Assignments

#### Reserved Ports (Other Applications — DO NOT USE)

| Port | Application |
|------|------------|
| 3002 | TZMonitor Frontend |
| 8002 | TZMonitor Backend |
| 3005 | AiChatDesk Frontend |
| 8005 | AiChatDesk Backend |
| 27017 | TZMonitor MongoDB |

#### MSEDB Ports

| Port | Service |
|------|---------|
| 3010 | MSEDB Frontend |
| 8010 | MSEDB Backend API + WebSocket |
| 27020 | MSEDB MongoDB (dedicated) |
| 6382 | MSEDB Redis |
| 9010 | BullMQ Dashboard (optional, runs inside backend) |

#### Future Reserved

| Port | Planned Use |
|------|------------|
| 8012 | MSEDB AI Service (Phase 2 — Claude API for auto-responses) |

### 5.5 Docker Design Principles

1. **Multi-stage builds** — Build dependencies in a builder stage, copy only production artifacts to slim runtime images. No dev tools in running containers.
2. **Non-root execution** — All containers run as non-root users.
3. **Resource limits** — CPU and memory caps on every container to protect other DGX workloads.
4. **Restart policy** — `restart: unless-stopped` on all containers for auto-recovery after reboots.
5. **Named volumes** — Persistent data (MongoDB, Redis, logs) stored in named Docker volumes.
6. **Health checks** — Every container has a Docker health check.
7. **Zero host dependencies** — No Node.js, npm, Python, Redis, or MongoDB installed on the DGX host.
8. **Clean teardown** — `docker-compose down -v` removes everything with no host artifacts.

### 5.6 Docker Volumes

| Volume Name | Container | Mount Point | Purpose |
|------------|-----------|-------------|---------|
| `msedb-mongo-data` | msedb-mongo | `/data/db` | Database storage |
| `msedb-redis-data` | msedb-redis | `/data` | Queue and cache persistence |
| `msedb-logs` | msedb-backend | `/app/logs` | Application logs |

---

## 6. Phase 1 Feature Specifications

### 6.1 User Management & Authentication

#### 6.1.1 Platform Authentication
- Users sign into MSEDB portal using their Microsoft 365 accounts via Azure AD OAuth 2.0
- Admin can invite users by email address
- Role-based access: Admin, User
- Admin can deactivate/remove users
- Users see only their own data; Admin can view aggregate analytics

#### 6.1.2 Microsoft Graph API Authorization
- Each user grants MSEDB access to their mailbox via OAuth consent flow
- Required Graph API permissions (delegated):
  - `Mail.ReadWrite` — Read and manage mail
  - `Mail.Send` — Send mail (for future auto-response feature)
  - `MailboxSettings.ReadWrite` — Read/write mailbox settings
  - `User.Read` — Basic profile info
  - `offline_access` — Refresh tokens for background access
- Token refresh handled automatically in the background
- Users can revoke access at any time from the portal

#### 6.1.3 User Profile & Preferences
- Display name, email, profile photo (from Graph API)
- Notification preferences (email digest, in-app, none)
- Automation aggressiveness setting (conservative / balanced / aggressive)
- Timezone and working hours configuration

### 6.2 Email Behavior Observation Engine

#### 6.2.1 Real-Time Monitoring via Webhooks
- Subscribe to Microsoft Graph change notifications for each user's mailbox
- Monitor these event types:
  - **Message created** — New email arrives in any folder
  - **Message updated** — Read/unread status change, flag change, category change
  - **Message moved** — Folder change detected (compare previous vs. current folder)
  - **Message deleted** — Moved to Deleted Items or permanently deleted

#### 6.2.2 Delta Query Fallback
- Run delta sync every 15 minutes per user as a safety net
- Catches any events missed by webhooks
- Full folder sync daily at off-peak hours (configurable)

#### 6.2.3 Event Data Model
Every observed action is stored as an `EmailEvent` document:

```json
{
  "_id": "ObjectId",
  "userId": "user_abc123",
  "messageId": "AAMkAG...",
  "internetMessageId": "<abc@example.com>",
  "eventType": "moved|deleted|read|flagged|categorized",
  "timestamp": "2026-02-16T10:30:00Z",
  "sender": {
    "name": "LinkedIn",
    "email": "notifications@linkedin.com",
    "domain": "linkedin.com"
  },
  "subject": "You have 5 new notifications",
  "subjectNormalized": "you have {number} new notifications",
  "receivedAt": "2026-02-16T10:00:00Z",
  "timeToAction": 1800,
  "fromFolder": "Inbox",
  "toFolder": "Deleted Items",
  "importance": "normal",
  "hasAttachments": false,
  "conversationId": "conv_xyz",
  "categories": [],
  "isRead": true,
  "metadata": {
    "headerListUnsubscribe": true,
    "isNewsletter": true,
    "isAutomated": true
  }
}
```

#### 6.2.4 Email Metadata Extraction
For each observed email, extract and store:
- Sender name, email, and domain
- Subject line (raw and normalized — replace numbers, dates, IDs with tokens)
- Received timestamp
- Importance level
- Has attachments flag
- Conversation thread ID
- Categories/labels
- List-Unsubscribe header presence (indicates newsletter/marketing)
- Mailing list headers
- Whether it was auto-generated (X-Auto-Response-Suppress header)

**CRITICAL: Email body content is NEVER stored — only metadata.**

### 6.3 Pattern Recognition Engine

#### 6.3.1 Pattern Types

**Type 1: Sender-Level Patterns**
- Track action distribution per sender domain and per sender email
- Example: "User deletes 97% of emails from promotions@store.com"
- Minimum sample size: 10 emails before generating a pattern

**Type 2: Subject Pattern Matching**
- Normalize subjects by replacing variable content (numbers, dates, order IDs) with wildcards
- Group emails by normalized subject pattern
- Example: "Your order #{id} has shipped" → always moved to "Orders" folder

**Type 3: Time-Based Patterns**
- Emails from certain senders consistently ignored for X days then bulk-deleted
- Emails arriving outside working hours treated differently than during hours

**Type 4: Folder Routing Patterns**
- Emails consistently moved from Inbox to a specific folder
- Example: "All emails from @company-invoices.com → Accounting folder"

**Type 5: Composite Patterns**
- Combinations of sender + subject + time patterns
- Example: "LinkedIn notification emails received on weekends → delete"

#### 6.3.2 Confidence Scoring

| Score Range | Label | Criteria |
|-------------|-------|----------|
| 90-100 | Very High | 95%+ consistency, 20+ samples |
| 75-89 | High | 85%+ consistency, 15+ samples |
| 50-74 | Medium | 70%+ consistency, 10+ samples |
| Below 50 | Low | Not enough data or inconsistent |

#### 6.3.3 Pattern Data Model
```json
{
  "_id": "ObjectId",
  "userId": "user_abc123",
  "patternType": "sender|subject|time|folder|composite",
  "criteria": {
    "senderDomain": "linkedin.com",
    "senderEmail": null,
    "subjectPattern": "you have * new notifications",
    "subjectContains": [],
    "importanceLevel": null,
    "hasAttachments": null,
    "timeCondition": null
  },
  "suggestedAction": "delete",
  "suggestedFolder": null,
  "confidence": 97,
  "sampleSize": 148,
  "actionDistribution": {
    "deleted": 145,
    "read_no_action": 2,
    "moved": 1
  },
  "sampleMessageIds": [],
  "firstSeen": "2026-01-01T00:00:00Z",
  "lastSeen": "2026-02-16T09:00:00Z",
  "status": "suggested|approved|rejected|expired",
  "rejectedUntil": null,
  "createdAt": "2026-02-16T12:00:00Z",
  "updatedAt": "2026-02-16T12:00:00Z"
}
```

### 6.4 Automation Rules Engine

#### 6.4.1 Rule Lifecycle
1. **Suggested** — Pattern detected, presented to user for review
2. **Approved** — User approves, rule becomes active
3. **Paused** — User temporarily disables rule
4. **Rejected** — User rejects, pattern is suppressed for 30 days
5. **Auto-Retired** — Rule accuracy drops below threshold, auto-paused

#### 6.4.2 Automation Actions
- **Delete** — Move to Deleted Items (never hard-delete in MVP)
- **Move to Folder** — Move to a specified folder
- **Archive** — Move to Archive folder
- **Mark as Read** — Auto-mark as read
- **Categorize** — Apply Outlook category/label
- **Do Nothing (Monitor)** — Continue observing without action

#### 6.4.3 Safety Mechanisms
- **Grace Period**: All automated deletions go to an "MSEDB Staging" folder first, held for 24 hours before moving to Deleted Items. User can rescue any email from staging.
- **Daily Digest**: Email summary of all automated actions taken that day.
- **Kill Switch**: One-click pause ALL automation from the dashboard.
- **Undo**: Any automated action can be undone within 48 hours.
- **Whitelist**: Users can whitelist senders/domains that should never be auto-acted upon.
- **Org-Level Override**: Admin can set organization-wide "never delete" rules (e.g., emails from clients).

#### 6.4.4 Rule Execution
- Rules are evaluated in priority order (user can reorder)
- First matching rule wins (no cascading)
- Rules execute within 5 minutes of email arrival (via webhook trigger)
- Failed executions are retried 3 times with exponential backoff
- All executions are logged in the audit trail

#### 6.4.5 Rule Data Model
```json
{
  "_id": "ObjectId",
  "userId": "user_abc123",
  "name": "Delete LinkedIn Notifications",
  "description": "Auto-generated from pattern: 97% delete rate",
  "sourcePatternId": "pattern_xyz",
  "isManual": false,
  "priority": 10,
  "conditions": {
    "senderDomain": "linkedin.com",
    "senderEmail": null,
    "subjectContains": ["notification"],
    "subjectPattern": null,
    "importance": null,
    "hasAttachments": null,
    "fromFolder": null
  },
  "action": {
    "type": "delete",
    "targetFolder": null,
    "category": null
  },
  "safetyConfig": {
    "useGracePeriod": true,
    "gracePeriodHours": 24,
    "notifyOnExecution": false
  },
  "status": "active|paused|retired",
  "stats": {
    "totalExecutions": 234,
    "successfulExecutions": 232,
    "failedExecutions": 2,
    "undoneByUser": 3,
    "lastExecutedAt": "2026-02-16T09:15:00Z"
  },
  "createdAt": "2026-02-01T00:00:00Z",
  "updatedAt": "2026-02-16T09:15:00Z"
}
```

### 6.5 Dashboard & User Interface

#### 6.5.1 Pages & Navigation

**Sidebar Navigation:**
- Dashboard (Home)
- Email Activity
- Patterns
- Automation Rules
- Staging Folder
- Audit Log
- Settings
- Admin Panel (admin only)

#### 6.5.2 Dashboard (Home)
- Welcome message with user name
- Stats cards: Total emails processed, Actions automated today/this week, Time saved estimate, Active rules count
- Recent automation activity feed (last 10 actions)
- Pending suggestions requiring approval (badge count)
- Quick action: Pause/Resume all automation toggle

#### 6.5.3 Email Activity Page
- Filterable, sortable table of all observed email events
- Filters: Date range, Sender/Domain, Action type, Folder
- Visual timeline of email activity
- Heatmap showing email volume by hour/day

#### 6.5.4 Patterns Page
- Card-based layout showing discovered patterns
- Each card displays: Pattern description, Confidence score (visual bar), Sample count, Action distribution chart, Suggested action
- Actions per card: Approve, Reject, Customize, View samples
- Filter by: Status, Confidence level, Action type

#### 6.5.5 Automation Rules Page
- List of all active, paused, and retired rules
- Drag-and-drop priority reordering
- Per-rule controls: Edit, Pause/Resume, Delete, View stats
- Rule creation wizard for manual rules
- Import/export rules (JSON format)

#### 6.5.6 Staging Folder Page
- List of emails currently in grace period
- Countdown timer showing time remaining before action executes
- Quick actions: Rescue (move back to Inbox), Execute immediately
- Batch operations: Rescue all, Execute all

#### 6.5.7 Audit Log
- Chronological log of all automated actions
- Filterable by: Rule, Action type, Date range
- Undo button (if within 48 hours)

#### 6.5.8 Settings Page
- Microsoft 365 connection status and reconnect option
- Notification preferences
- Automation aggressiveness level
- Working hours configuration
- Whitelist/Blacklist management
- Data retention, export, and deletion

#### 6.5.9 Admin Panel (Admin Only)
- User management: Invite, Deactivate, Remove users
- Organization-wide rules
- Aggregate analytics
- System health and webhook monitoring

### 6.6 Notification System
- **In-App Notifications**: Bell icon with unread count
- **Email Digest**: Daily summary of automated actions (opt-in)
- **Alerts**: Webhook failures, token expiration warnings, rule accuracy drops

---

## 7. Technical Architecture

### 7.1 Technology Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18 + Vite + Tailwind CSS + shadcn/ui |
| **Backend** | Node.js 20 + Express.js |
| **Database** | MongoDB 7 (Mongoose ODM) — dedicated container |
| **Cache/Queue** | Redis 7 + BullMQ — dedicated container |
| **Auth** | Azure AD OAuth 2.0 via @azure/msal-node |
| **Graph SDK** | @microsoft/microsoft-graph-client |
| **Real-time** | Socket.IO |
| **State Mgmt** | Zustand + TanStack Query |
| **Containerization** | Docker + Docker Compose (multi-stage builds) |
| **External Access** | Cloudflare Tunnel (webhooks) |
| **Logging** | Winston |

### 7.2 System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                  DGX Server: 172.16.219.222                  │
│                                                              │
│  ┌──────────── msedb-network (Docker bridge) ─────────────┐  │
│  │                                                        │  │
│  │  ┌──────────────────┐    ┌───────────────────────────┐ │  │
│  │  │ msedb-frontend   │    │ msedb-backend             │ │  │
│  │  │ nginx:alpine      │    │ node:20-alpine            │ │  │
│  │  │ :3010 → :80      │───→│ :8010                     │ │  │
│  │  │ 0.5 CPU / 512MB  │    │ 2.0 CPU / 2GB             │ │  │
│  │  └──────────────────┘    │ Express + Socket.IO        │ │  │
│  │                          │ BullMQ Workers             │ │  │
│  │                          └──────┬──────────┬──────────┘ │  │
│  │                                 │          │            │  │
│  │                    ┌────────────▼┐  ┌──────▼─────────┐  │  │
│  │                    │ msedb-mongo │  │ msedb-redis    │  │  │
│  │                    │ mongo:7     │  │ redis:7-alpine │  │  │
│  │                    │:27020→:27017│  │ :6382 → :6379  │  │  │
│  │                    │2.0CPU / 2GB │  │ 0.5 CPU / 512MB│  │  │
│  │                    └─────────────┘  └────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─────────────────────┐     ┌────────────────────────────┐  │
│  │ Cloudflare Tunnel   │────→│ :8010/webhooks/graph       │  │
│  │ (host systemd)      │     │ HTTPS ← Microsoft Graph    │  │
│  └─────────────────────┘     └────────────────────────────┘  │
│                                                              │
│  ┌──── OTHER SERVICES (isolated) ──────────────────────────┐ │
│  │ TZMonitor :3002/:8002  │  AiChatDesk :3005/:8005       │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### 7.3 API Endpoints

#### Authentication
```
GET    /auth/login                  → Redirect to Azure AD
GET    /auth/callback               → Handle OAuth callback
POST   /auth/refresh                → Refresh access token
POST   /auth/logout                 → Logout and clear session
GET    /auth/me                     → Current user profile
```

#### Dashboard
```
GET    /api/dashboard/stats         → Stats cards data
GET    /api/dashboard/activity      → Recent activity feed
GET    /api/dashboard/pending       → Pending suggestion count
```

#### Email Events
```
GET    /api/events                  → List events (paginated, filtered)
GET    /api/events/heatmap          → Activity heatmap data
GET    /api/events/stats/senders    → Top senders analytics
```

#### Patterns
```
GET    /api/patterns                → List patterns
GET    /api/patterns/:id            → Pattern detail with samples
POST   /api/patterns/:id/approve    → Approve → creates rule
POST   /api/patterns/:id/reject     → Reject pattern
POST   /api/patterns/:id/customize  → Modify and approve
```

#### Rules
```
GET    /api/rules                   → List all rules
POST   /api/rules                   → Create manual rule
PUT    /api/rules/:id               → Update rule
DELETE /api/rules/:id               → Delete rule
POST   /api/rules/:id/pause         → Pause rule
POST   /api/rules/:id/resume        → Resume rule
PUT    /api/rules/reorder           → Update priorities
POST   /api/rules/export            → Export as JSON
POST   /api/rules/import            → Import from JSON
```

#### Staging
```
GET    /api/staging                 → List staged emails
POST   /api/staging/:id/rescue      → Rescue to inbox
POST   /api/staging/:id/execute     → Execute immediately
POST   /api/staging/rescue-all      → Rescue all
POST   /api/staging/execute-all     → Execute all
```

#### Audit
```
GET    /api/audit                   → List entries (paginated)
POST   /api/audit/:id/undo         → Undo action
```

#### Settings
```
GET    /api/settings                → User settings
PUT    /api/settings                → Update settings
GET    /api/settings/whitelist      → Whitelist entries
POST   /api/settings/whitelist      → Add to whitelist
DELETE /api/settings/whitelist/:id  → Remove from whitelist
GET    /api/settings/connection     → Graph API connection status
POST   /api/settings/reconnect     → Re-authorize Graph API
POST   /api/settings/export-data   → Export all user data
POST   /api/settings/delete-data   → Delete all user data
```

#### Webhooks
```
POST   /webhooks/graph              → Microsoft Graph notifications
```

#### Admin
```
GET    /api/admin/users             → List all users
POST   /api/admin/users/invite      → Invite user
PUT    /api/admin/users/:id/role    → Change role
DELETE /api/admin/users/:id         → Remove user
GET    /api/admin/analytics         → Aggregate analytics
GET    /api/admin/health            → System health
PUT    /api/admin/org-rules         → Org-wide rules
```

### 7.4 Database Collections

```
users                    → User profiles, roles, preferences
email_events             → All observed email actions
patterns                 → Detected behavior patterns
rules                    → Active automation rules
staged_emails            → Emails in grace period
audit_logs               → All automated actions taken
notifications            → In-app notifications
org_settings             → Organization-wide configuration
webhook_subscriptions    → Active Graph API subscriptions
```

### 7.5 Background Jobs

| Job | Frequency | Description |
|-----|-----------|-------------|
| `webhook-renewal` | Every 2 hours | Renew Graph API subscriptions |
| `delta-sync` | Every 15 minutes | Catch missed webhook events |
| `pattern-analysis` | Daily at 2 AM | Generate/update patterns |
| `staging-processor` | Every 30 minutes | Execute expired staged actions |
| `daily-digest` | Daily at 8 AM (user TZ) | Send summary email |
| `token-refresh` | Every 45 minutes | Refresh OAuth tokens |
| `rule-health-check` | Weekly | Auto-retire degraded rules |

---

## 8. Security & Privacy

- All tokens encrypted at rest (AES-256-GCM)
- HTTPS via Cloudflare Tunnel for external access
- User data isolation enforced at query level
- Admin access logged in audit trail
- Email body content NEVER stored
- GDPR-style data export and deletion
- Session timeout after 24 hours
- Rate limiting on all endpoints
- Non-root container execution
- Docker network isolation

---

## 9. Performance Requirements

- Webhook processing: under 3 seconds
- Pattern analysis: under 5 minutes for 10,000 events
- Dashboard load: under 2 seconds
- Support 50 concurrent users
- Proper MongoDB indexes on all query paths

---

## 10. Success Metrics

| Metric | Target |
|--------|--------|
| Observation accuracy | 99%+ email actions captured |
| Pattern precision | 90%+ suggested patterns useful |
| User approval rate | 70%+ rules approved |
| Undo rate | Under 5% |
| Time saved per user | 30+ min/day after 1 month |
| User adoption | 80% active after 2 weeks |

---

## 11. Out of Scope for Phase 1

- Auto-responses / auto-reply drafting
- Email body content analysis
- Shared/team mailbox support
- Mobile app
- Multi-language support
- Non-Microsoft email providers
- AI-powered email summarization
- Calendar integration

---

## 12. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Graph API rate limiting | Batching, throttle headers, backoff |
| Webhook reliability | Delta query fallback every 15 min |
| Token expiration | Proactive refresh job + alerts |
| False positive deletions | Staging, undo, daily digest |
| User trust | Observation-only start, explicit approval |
| Data privacy | Never store bodies, export/delete |
| DGX resource impact | Docker resource limits on all containers |
| Container failure | Health checks, restart policies |
