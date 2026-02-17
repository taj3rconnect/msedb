# Requirements: MSEDB

**Defined:** 2026-02-16
**Core Value:** Users never lose control of their email. The system observes, learns, suggests, and only acts with explicit approval — and every action can be undone.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Authentication

- [ ] **AUTH-01**: User authenticates via Azure AD OAuth 2.0 SSO (MSAL) — no separate account creation. Redirect to Microsoft login, handle callback, issue JWT session
- [ ] **AUTH-02**: JWT session management with httpOnly cookies, persists across browser refresh. requireAuth middleware on all protected routes
- [ ] **AUTH-03**: Admin can invite users by email; role-based access control (Admin, User). requireAdmin middleware for admin-only routes
- [ ] **AUTH-04**: Encrypted token storage (AES-256-GCM) with proactive refresh every 45 min. MSAL cache persisted to MongoDB across container restarts via custom ICachePlugin
- [ ] **AUTH-05**: Token lifecycle management — handle expiry gracefully, background job monitors token health, re-auth flow when refresh token expires
- [ ] **AUTH-06**: Multi-mailbox per user — a single user can connect multiple Microsoft 365 mailboxes (e.g., taj@aptask.com, taj@jobtalk.ai, taj@yenom.ai). Each mailbox maintains its own OAuth tokens, webhook subscription, delta sync, pattern detection, and rules. UI clearly labels which mailbox activity belongs to

### Observation

- [ ] **OBSV-01**: Real-time email event observation via Graph API webhooks (created, updated, moved, deleted events) per mailbox. Webhook subscriptions include lifecycleNotificationUrl. Renewal job runs on startup and every 2 hours
- [ ] **OBSV-02**: Delta query fallback every 15 min per mailbox per folder to catch missed webhook events. deltaLink cached in Redis per user per mailbox per folder
- [ ] **OBSV-03**: Email metadata extraction and storage — sender, subject, folder, timestamps, action type. Never store body content. Data model includes optional content fields for future use without populating them now
- [ ] **OBSV-04**: Event deduplication via userId + mailboxId + messageId + eventType compound index. Webhook handler returns 202 immediately, processes via BullMQ (zero blocking in handler)

### Patterns

- [ ] **PATN-01**: Sender-level pattern detection — detect when user consistently performs the same action on emails from a specific sender (e.g., "always deletes emails from sender X")
- [ ] **PATN-02**: Folder routing pattern detection — detect when user consistently moves emails from a sender or domain to a specific folder
- [ ] **PATN-03**: Confidence scoring based on sample size + action consistency. Asymmetric thresholds: 98%+ for delete suggestions, 85%+ for move suggestions. Minimum 14-day observation period before first suggestions
- [ ] **PATN-04**: Pattern suggestion UI with approve/reject/customize workflow. Shows confidence %, sample size, exception count, and sample evidence ("You deleted 97 of 100 emails from this sender")

### Automation

- [ ] **AUTO-01**: Multi-action automation rules — a single rule can perform multiple actions (move + mark read + categorize) via Graph API messageRuleActions
- [ ] **AUTO-02**: Rule management — CRUD with priority ordering (first-match-wins), enable/disable toggle, per-rule execution stats
- [ ] **AUTO-03**: Rule engine evaluation order: check automationPaused (kill switch) → check whitelist → evaluate rules in priority order. Per-mailbox rule sets
- [ ] **AUTO-04**: Pattern-to-rule conversion — approved patterns converted to Graph API messageRule JSON with appropriate conditions and actions, submitted to user's mailbox

### Safety

- [ ] **SAFE-01**: Staging folder with 24-hour grace period — automated destructive actions (delete) routed to "MSEDB Staging" folder first. BullMQ stagingProcessor executes expired items every 30 min
- [ ] **SAFE-02**: Kill switch — single toggle to pause ALL automation across all mailboxes. Visible in persistent top navigation on every page, not buried in settings
- [ ] **SAFE-03**: Undo any automated action within 48 hours. Soft-delete only (move to Deleted Items), never permanentDelete in v1
- [ ] **SAFE-04**: Sender/domain whitelist — protected senders and domains are never auto-acted on. Manageable per-mailbox and org-wide by admin
- [ ] **SAFE-05**: Audit log of all automated actions — timestamp, rule ID, mailbox, message metadata, action taken, result, and undo button per entry

### Dashboard

- [ ] **DASH-01**: Dashboard home with stats cards (emails processed, rules fired, patterns pending, staging count), activity feed, and pending suggestions. Per-mailbox and aggregate views
- [ ] **DASH-02**: Real-time updates via Socket.IO — email events, pattern detections, rule executions, staging changes appear live
- [ ] **DASH-03**: In-app notification system (bell icon) with read/unread state for pattern suggestions, rule executions, staging alerts, and system events

### Pages

- [ ] **PAGE-01**: Email activity page with per-mailbox filters, event timeline, and sender breakdown
- [ ] **PAGE-02**: Patterns page with card-based layout, confidence visualization, sample evidence, approve/reject/customize actions
- [ ] **PAGE-03**: Rules page with priority ordering (drag-and-drop reorder), enable/disable toggle, per-rule execution stats, per-mailbox view
- [ ] **PAGE-04**: Staging page with countdown timers, batch rescue/execute actions, per-mailbox filtering
- [ ] **PAGE-05**: Audit log page with filterable history (by mailbox, rule, action type, date range) and undo capability on each row
- [ ] **PAGE-06**: Settings page — preferences, working hours, automation aggressiveness, per-mailbox connection status and management, whitelist management, data export/delete
- [ ] **PAGE-07**: Admin panel — user invite/deactivate/role management, org-wide rules, aggregate analytics, system health (webhook status, token health, subscription expiry)

### Infrastructure

- [ ] **INFR-01**: Fully containerized Docker Compose stack — frontend (React 19 + Vite + nginx), backend (Node.js 22 + Express 5), MongoDB 7, Redis 7. Resource limits: 5 CPU / 5GB RAM total across 4 containers
- [ ] **INFR-02**: Cloudflare Tunnel for public HTTPS webhook endpoint. Bot protection configured to allow Graph API webhook POSTs on /webhooks/graph path
- [ ] **INFR-03**: Background jobs via BullMQ with Redis (noeviction policy): webhook renewal (2h), delta sync (15m), pattern analysis (daily 2AM), staging processor (30m), token refresh (45m). removeOnComplete/removeOnFail with age limits on all queues
- [ ] **INFR-04**: Security hardening — AES-256-GCM token encryption, user data isolation at query level, rate limiting on all endpoints (5/min auth, 100/min API), non-root containers, $select on all Graph API calls
- [ ] **INFR-05**: Health endpoints reporting container status, MongoDB connectivity, Redis connectivity, webhook subscription status per mailbox, token health per user

### Outlook Add-in

- [ ] **PLUG-01**: Outlook Add-in shell — Office Add-in with taskpane and context menu commands, deployed via sideload, communicates with MSEDB backend API
- [ ] **PLUG-02**: Sender whitelist/blacklist from Outlook — right-click or taskpane action to mark sender as "never delete" or "always delete". Syncs to MSEDB whitelist and creates/updates automation rules
- [ ] **PLUG-03**: Domain whitelist/blacklist from Outlook — same as PLUG-02 at domain level (e.g., mark all @newsletter.com as always delete)
- [ ] **PLUG-04**: Plugin auth integration — authenticates via Azure AD SSO using Office.js getAccessTokenAsync(), backend validates token against same Azure AD app registration

## v2 Requirements

Deferred to future releases. Tracked but not in current roadmap.

### Pattern Intelligence

- **PATN-05**: Subject pattern normalization and detection — replace numbers, dates, UUIDs, order IDs with wildcards to detect subject-based patterns
- **PATN-06**: Time-based pattern detection — detect weekday vs weekend behavior, time-of-day patterns, bulk actions on specific days
- **PATN-07**: Composite pattern detection — combine sender + subject + time conditions for nuanced rules (e.g., "LinkedIn notifications on weekends → delete")

### Automation Enhancements

- **AUTO-05**: Rule health monitoring — track undo rate per rule, auto-pause rules whose undo rate exceeds threshold (e.g., >10%), notify user
- **AUTO-06**: Automation aggressiveness knob — conservative (95%+), balanced (85%+), aggressive (70%+) confidence thresholds for pattern surfacing
- **AUTO-07**: Rule import/export as JSON — backup, sharing, and migration capability
- **AUTO-08**: Admin aggregate analytics — org-wide time saved, most automated senders, rule adoption rates

### Notifications

- **DASH-04**: Daily email digest with actionable rescue links for staged emails (requires Mail.Send or external email service)
- **SAFE-06**: Org-wide "never delete" rules — admin-managed protection for client domains and critical senders

### Outlook Add-in Enhancements

- **PLUG-05**: Email tracking — user selects which outgoing emails to track with tracking pixel. Shows open/read/delete/never-opened status and open count
- **PLUG-06**: AI email rewrite — rewrite selected email draft using AI assistance
- **PLUG-07**: AI email compose — create new email from natural language prompt
- **PLUG-08**: Email templates — save, manage, and apply reusable email templates from within Outlook

### Future Platform

- **PLAT-01**: Auto-responses / email drafting — template-based auto-replies with guard rails against reply storms (requires Mail.Send)
- **PLAT-02**: AI-powered email categorization via LLM — advanced intelligence beyond metadata heuristics
- **PLAT-03**: Shared/team mailbox support — application-level Graph API permissions, separate data model

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Email body content analysis | Privacy boundary — metadata only. Model accommodates future optional content fields |
| Auto-unsubscribe from newsletters | Phishing vectors, legal liability. Detect and auto-archive instead |
| Auto-rule creation without user approval | Destroys trust — the core value proposition requires explicit approval |
| Real-time sub-second rule execution | Graph API webhooks have inherent latency (seconds to minutes). Target 5-min SLA |
| Cross-user pattern sharing | Privacy design required. Admin org-wide rules are the safe alternative |
| Mobile app | Web-first. Responsive design covers mobile browsers |
| Multi-language support | English only for initial release |
| Non-Microsoft email providers | Microsoft 365 only via Graph API |
| Calendar/meeting integration | messageRulePredicates supports isMeetingRequest — use that, skip full calendar API |
| SaaS multi-tenant billing | Self-hosted single-org deployment for now |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 2: Authentication & Token Management | Pending |
| AUTH-02 | Phase 2: Authentication & Token Management | Pending |
| AUTH-03 | Phase 2: Authentication & Token Management | Pending |
| AUTH-04 | Phase 2: Authentication & Token Management | Pending |
| AUTH-05 | Phase 2: Authentication & Token Management | Pending |
| AUTH-06 | Phase 2: Authentication & Token Management | Pending |
| OBSV-01 | Phase 3: Email Observation Pipeline | Pending |
| OBSV-02 | Phase 3: Email Observation Pipeline | Pending |
| OBSV-03 | Phase 3: Email Observation Pipeline | Pending |
| OBSV-04 | Phase 3: Email Observation Pipeline | Pending |
| PATN-01 | Phase 5: Pattern Intelligence | Pending |
| PATN-02 | Phase 5: Pattern Intelligence | Pending |
| PATN-03 | Phase 5: Pattern Intelligence | Pending |
| PATN-04 | Phase 5: Pattern Intelligence | Pending |
| AUTO-01 | Phase 6: Automation & Safety | Pending |
| AUTO-02 | Phase 6: Automation & Safety | Pending |
| AUTO-03 | Phase 6: Automation & Safety | Pending |
| AUTO-04 | Phase 6: Automation & Safety | Pending |
| SAFE-01 | Phase 6: Automation & Safety | Pending |
| SAFE-02 | Phase 6: Automation & Safety | Pending |
| SAFE-03 | Phase 6: Automation & Safety | Pending |
| SAFE-04 | Phase 6: Automation & Safety | Pending |
| SAFE-05 | Phase 6: Automation & Safety | Pending |
| DASH-01 | Phase 4: Frontend Shell & Observation UI | Pending |
| DASH-02 | Phase 4: Frontend Shell & Observation UI | Pending |
| DASH-03 | Phase 7: Polish, Notifications & Admin | Pending |
| PAGE-01 | Phase 4: Frontend Shell & Observation UI | Pending |
| PAGE-02 | Phase 5: Pattern Intelligence | Pending |
| PAGE-03 | Phase 6: Automation & Safety | Pending |
| PAGE-04 | Phase 6: Automation & Safety | Pending |
| PAGE-05 | Phase 6: Automation & Safety | Pending |
| PAGE-06 | Phase 7: Polish, Notifications & Admin | Pending |
| PAGE-07 | Phase 7: Polish, Notifications & Admin | Pending |
| INFR-01 | Phase 1: Infrastructure Foundation | Pending |
| INFR-02 | Phase 1: Infrastructure Foundation | Pending |
| INFR-03 | Phase 1: Infrastructure Foundation | Pending |
| INFR-04 | Phase 1: Infrastructure Foundation | Pending |
| INFR-05 | Phase 1: Infrastructure Foundation | Pending |
| PLUG-01 | Phase 8: Outlook Add-in | Pending |
| PLUG-02 | Phase 8: Outlook Add-in | Pending |
| PLUG-03 | Phase 8: Outlook Add-in | Pending |
| PLUG-04 | Phase 8: Outlook Add-in | Pending |

**Coverage:**
- v1 requirements: 42 total
- Mapped to phases: 42/42
- Unmapped: 0

---
*Requirements defined: 2026-02-16*
*Last updated: 2026-02-16 after roadmap creation -- all requirements mapped to phases*
