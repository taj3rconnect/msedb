# Requirements — MSEDB v1.0

**Version:** v1.0 MVP (shipped 2026-02-18)
**Total Requirements:** 42 | **Complete:** 42/42

## Core Value

Users never lose control of their email. The system observes, learns, suggests, and only acts with explicit approval — and every action can be undone.

---

## Authentication (6 requirements)

| ID | Requirement | Phase | Status |
|----|-------------|-------|--------|
| AUTH-01 | User authenticates via Azure AD OAuth 2.0 SSO (MSAL) | 2 | Complete |
| AUTH-02 | JWT session management with httpOnly cookies (24h expiry) | 2 | Complete |
| AUTH-03 | Admin can invite users by email; role-based access control (admin/user) | 2 | Complete |
| AUTH-04 | Encrypted token storage (AES-256-GCM) with proactive refresh | 2 | Complete |
| AUTH-05 | Token lifecycle management with background monitoring (45-min refresh) | 2 | Complete |
| AUTH-06 | Multi-mailbox per user with independent tokens, webhooks, and rules | 2 | Complete |

**Implementation details:**
- MSAL ConfidentialClientApplication with MongoDB ICachePlugin for cache persistence
- Signed JWT as OAuth `state` parameter (no Redis nonce lookup)
- Token refresh via BullMQ scheduled job every 45 minutes
- `interaction_required` error triggers mailbox disconnect + high-priority notification

## Observation (4 requirements)

| ID | Requirement | Phase | Status |
|----|-------------|-------|--------|
| OBSV-01 | Real-time email event observation via Graph API webhooks | 3 | Complete |
| OBSV-02 | Delta query fallback every 15 min per mailbox per folder | 3 | Complete |
| OBSV-03 | Email metadata extraction and storage (never body content) | 3 | Complete |
| OBSV-04 | Event deduplication via compound index, 202 immediate response | 3 | Complete |

**Implementation details:**
- Webhook handler returns HTTP 202 immediately; BullMQ processes events asynchronously
- Compound unique index on `{ userId, mailboxId, messageId, eventType }` prevents duplicates
- Delta links stored per-folder in `Mailbox.deltaLinks` Map
- 90-day TTL on EmailEvent collection
- Tracked event types: `arrived`, `deleted`, `moved`, `read`, `flagged`, `categorized`

## Pattern Detection (4 requirements)

| ID | Requirement | Phase | Status |
|----|-------------|-------|--------|
| PATN-01 | Sender-level pattern detection | 5 | Complete |
| PATN-02 | Folder routing pattern detection | 5 | Complete |
| PATN-03 | Confidence scoring with asymmetric thresholds (98% delete, 85% move) | 5 | Complete |
| PATN-04 | Pattern suggestion UI with approve/reject/customize workflow | 5 | Complete |

**Implementation details:**
- Observation window: 90 days (configurable), minimum 14 days of data
- Minimum thresholds: 10 sender events, 5 folder moves
- Confidence formula accounts for recency (7-day window) and exception count
- Rejection imposes 30-day cooldown before re-suggestion
- Maximum 10 evidence items stored per pattern
- Asymmetric thresholds: delete=98%, move=85%, archive=85%, markRead=80%

## Automation (4 requirements)

| ID | Requirement | Phase | Status |
|----|-------------|-------|--------|
| AUTO-01 | Multi-action automation rules (move + mark read + categorize) | 6 | Complete |
| AUTO-02 | Rule management with priority ordering, enable/disable, per-rule stats | 6 | Complete |
| AUTO-03 | Rule engine evaluation order: kill switch → whitelist → priority rules | 6 | Complete |
| AUTO-04 | Pattern-to-rule conversion with auto-approval on customize | 6 | Complete |

**Implementation details:**
- First-match-wins: highest priority rule that matches all conditions fires
- Conditions are AND logic: senderEmail, senderDomain, subjectContains, fromFolder
- Actions have explicit ordering within a rule
- Rule stats track totalExecutions, lastExecutedAt, emailsProcessed
- `graphRuleId` field reserved for future Graph MailboxSettings rule sync

## Safety (5 requirements)

| ID | Requirement | Phase | Status |
|----|-------------|-------|--------|
| SAFE-01 | Staging folder with 24-hour grace period for destructive actions | 6 | Complete |
| SAFE-02 | Kill switch to pause all automation, visible in top navigation | 6 | Complete |
| SAFE-03 | Undo any automated action within 48 hours (soft-delete only) | 6 | Complete |
| SAFE-04 | Sender/domain whitelist per-mailbox and org-wide by admin | 6 | Complete |
| SAFE-05 | Audit log of all automated actions with undo capability | 6 | Complete |

**Implementation details:**
- Staging: StagedEmail model with 24h expiry, 7-day cleanup buffer (TTL)
- Kill switch: `user.preferences.automationPaused` flag checked before any rule evaluation
- Undo: `undoService` reverses move/delete actions via Graph API (48h window)
- Whitelists: per-mailbox in MongoDB (`mailbox.settings.whitelistedSenders/Domains`), org-wide in Redis Sets (`org:whitelist:senders`, `org:whitelist:domains`) for O(1) lookup
- Audit: 13 action types, `undoable` flag, `undoneAt`/`undoneBy` tracking
- Delete actions are always soft-delete (move to deleteditems, never permanentDelete)

## Dashboard (3 requirements)

| ID | Requirement | Phase | Status |
|----|-------------|-------|--------|
| DASH-01 | Dashboard with stats cards, activity feed, pending suggestions | 4 | Complete |
| DASH-02 | Real-time updates via Socket.IO | 4 | Complete |
| DASH-03 | In-app notification system (bell icon) with read/unread state | 7 | Complete |

**Implementation details:**
- Socket.IO events: `email:event`, `staging:new`, `notification:new`
- User-scoped rooms: `user:{userId}` for targeted delivery
- TanStack Query cache invalidation on Socket.IO events
- Notification types: pattern_detected, rule_executed, staging_alert, system, inactivity_warning, token_expiring
- 30-day TTL on notifications

## Pages (7 requirements)

| ID | Requirement | Phase | Status |
|----|-------------|-------|--------|
| PAGE-01 | Email activity page with filters, timeline, sender breakdown | 4 | Complete |
| PAGE-02 | Patterns page with cards, confidence visualization, approve/reject | 5 | Complete |
| PAGE-03 | Rules page with drag-and-drop priority ordering | 6 | Complete |
| PAGE-04 | Staging page with countdown timers and rescue/execute actions | 6 | Complete |
| PAGE-05 | Audit log page with filterable history and undo buttons | 6 | Complete |
| PAGE-06 | Settings page with preferences, mailboxes, whitelists, data export | 7 | Complete |
| PAGE-07 | Admin panel with user management, org rules, analytics, health | 7 | Complete |

**Implementation details:**
- Drag-and-drop via `@dnd-kit/core` + `@dnd-kit/sortable`
- Charts via Recharts (timeline, sender breakdown)
- Data tables via `@tanstack/react-table`
- Mailbox selector component for multi-mailbox switching across all pages
- Settings includes full data export (JSON download) and account deletion

## Infrastructure (5 requirements)

| ID | Requirement | Phase | Status |
|----|-------------|-------|--------|
| INFR-01 | Docker Compose stack (React 19, Express 5, MongoDB 7, Redis 7) | 1 | Complete |
| INFR-02 | Cloudflare Tunnel for webhook endpoint | 1 | Complete (code ready) |
| INFR-03 | BullMQ background jobs with Redis noeviction policy | 1 | Complete |
| INFR-04 | Security hardening (AES-256-GCM, rate limiting, $select on Graph) | 1 | Complete |
| INFR-05 | Health endpoints with service status reporting | 1 | Complete |

**Notes:**
- INFR-02: All webhook code is implemented and tested. Cloudflare Tunnel configuration deferred — webhook subscriptions will fail until the tunnel is operational.
- Resource limits: 5 CPU cores + 5GB RAM total across 4 containers.
- Redis: `--maxmemory 384mb --maxmemory-policy noeviction` (prevents BullMQ job key eviction).

## Outlook Add-in (4 requirements)

| ID | Requirement | Phase | Status |
|----|-------------|-------|--------|
| PLUG-01 | Outlook Add-in with taskpane and ribbon commands | 8 | Complete |
| PLUG-02 | Sender whitelist/blacklist from Outlook syncing to backend | 8 | Complete |
| PLUG-03 | Domain whitelist/blacklist from Outlook at domain level | 8 | Complete |
| PLUG-04 | Azure AD SSO via NAA with backend JWKS token validation | 8 | Complete |

**Notes:**
- PLUG-01: Originally specified "context menu commands" but Outlook doesn't support `ContextMenu` extension point for MailApps. Changed to ribbon buttons + taskpane (`MessageReadCommandSurface`).
- NAA uses `createNestablePublicClientApplication` from `@azure/msal-browser` v3.x.
- Backend validates add-in tokens via JWKS (`jwks-rsa`) with audience, issuer, and `access_as_user` scope checks.

---

## Traceability Matrix

| ID | Category | Phase | Delivered |
|----|----------|-------|-----------|
| AUTH-01 | Authentication | 2 | Yes |
| AUTH-02 | Authentication | 2 | Yes |
| AUTH-03 | Authentication | 2 | Yes |
| AUTH-04 | Authentication | 2 | Yes |
| AUTH-05 | Authentication | 2 | Yes |
| AUTH-06 | Authentication | 2 | Yes |
| OBSV-01 | Observation | 3 | Yes |
| OBSV-02 | Observation | 3 | Yes |
| OBSV-03 | Observation | 3 | Yes |
| OBSV-04 | Observation | 3 | Yes |
| PATN-01 | Patterns | 5 | Yes |
| PATN-02 | Patterns | 5 | Yes |
| PATN-03 | Patterns | 5 | Yes |
| PATN-04 | Patterns | 5 | Yes |
| AUTO-01 | Automation | 6 | Yes |
| AUTO-02 | Automation | 6 | Yes |
| AUTO-03 | Automation | 6 | Yes |
| AUTO-04 | Automation | 6 | Yes |
| SAFE-01 | Safety | 6 | Yes |
| SAFE-02 | Safety | 6 | Yes |
| SAFE-03 | Safety | 6 | Yes |
| SAFE-04 | Safety | 6 | Yes |
| SAFE-05 | Safety | 6 | Yes |
| DASH-01 | Dashboard | 4 | Yes |
| DASH-02 | Dashboard | 4 | Yes |
| DASH-03 | Dashboard | 7 | Yes |
| PAGE-01 | Pages | 4 | Yes |
| PAGE-02 | Pages | 5 | Yes |
| PAGE-03 | Pages | 6 | Yes |
| PAGE-04 | Pages | 6 | Yes |
| PAGE-05 | Pages | 6 | Yes |
| PAGE-06 | Pages | 7 | Yes |
| PAGE-07 | Pages | 7 | Yes |
| INFR-01 | Infrastructure | 1 | Yes |
| INFR-02 | Infrastructure | 1 | Partial |
| INFR-03 | Infrastructure | 1 | Yes |
| INFR-04 | Infrastructure | 1 | Yes |
| INFR-05 | Infrastructure | 1 | Yes |
| PLUG-01 | Add-in | 8 | Yes |
| PLUG-02 | Add-in | 8 | Yes |
| PLUG-03 | Add-in | 8 | Yes |
| PLUG-04 | Add-in | 8 | Yes |

---

## Out of Scope (v1.0)

| Feature | Reason |
|---------|--------|
| Auto-responses / auto-reply drafting | Future milestone |
| Email body content analysis | Privacy boundary — metadata only |
| AI-powered email categorization | Future milestone |
| Shared/team mailbox support | Future |
| Mobile app | Web-first (responsive covers mobile browsers) |
| Multi-language support | English only |
| Non-Microsoft email providers | Microsoft 365 only |
| Calendar integration | Future |
| SaaS multi-tenant billing | Future |
| Time-based/subject/composite patterns | Iterative addition after sender + folder prove out |
| Outlook Add-in email tracking, AI rewrite/compose, templates | Future |

## Future Considerations (v2.0+)

- **Composite patterns**: Time-based, subject-based, and multi-condition patterns
- **AI categorization**: LLM-powered email classification and suggested labels
- **Auto-responses**: Draft templates triggered by pattern rules
- **Team mailboxes**: Shared mailbox observation and shared rule sets
- **Multi-provider**: Gmail/Google Workspace support
- **Calendar integration**: Meeting-related email handling
