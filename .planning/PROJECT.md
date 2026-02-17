# MSEDB — Microsoft Email DashBoard

## What This Is

A self-hosted, containerized email management portal that connects to Microsoft 365 via Microsoft Graph API, passively observes how users handle their email (delete, move, archive, flag), detects repetitive behavioral patterns, and — with explicit user approval — creates automation rules to handle those actions automatically. Built as a Docker Compose stack running on a DGX server alongside other services.

## Core Value

Users never lose control of their email. The system observes, learns, suggests, and only acts with explicit approval — and every action can be undone.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

- [ ] Azure AD OAuth 2.0 authentication for Microsoft 365 accounts
- [ ] Admin can invite users by email; role-based access (Admin, User)
- [ ] Each user connects their own mailbox via OAuth consent flow
- [ ] Real-time email observation via Graph API webhooks (created, updated, moved, deleted events)
- [ ] Delta query fallback (every 15 min) to catch missed webhook events
- [ ] Email metadata extraction and storage (sender, subject, folder, timestamps — never body content)
- [ ] Subject normalization (replace numbers, dates, IDs with wildcards)
- [ ] Pattern detection: sender-level patterns (v1)
- [ ] Pattern detection: folder routing patterns (v1)
- [ ] Confidence scoring (sample size + consistency-based)
- [ ] Pattern suggestion UI with approve/reject/customize workflow
- [ ] Multi-action automation rules (move + mark read + categorize in one rule)
- [ ] Safety: staging folder with 24-hour grace period before destructive actions
- [ ] Safety: kill switch to pause all automation
- [ ] Safety: undo any automated action within 48 hours
- [ ] Safety: sender/domain whitelist (never auto-act)
- [ ] Dashboard with stats cards, activity feed, pending suggestions
- [ ] Email activity page with filters, timeline, heatmap
- [ ] Patterns page with card-based layout and confidence visualization
- [ ] Rules page with priority ordering, enable/disable, stats
- [ ] Staging page with countdown timers and rescue/execute actions
- [ ] Audit log of all automated actions with undo capability
- [ ] Settings page (preferences, working hours, whitelist, data export/delete)
- [ ] Admin panel (user management, org-wide rules, aggregate analytics, system health)
- [ ] In-app notifications (bell icon) and optional daily email digest
- [ ] Real-time dashboard updates via Socket.IO
- [ ] Background jobs: webhook renewal, delta sync, pattern analysis, staging processor, token refresh, daily digest
- [ ] Fully containerized Docker Compose stack (frontend, backend, MongoDB, Redis)
- [ ] Cloudflare Tunnel for public HTTPS webhook endpoint
- [ ] All tokens encrypted at rest (AES-256-GCM)
- [ ] User data isolation enforced at query level
- [ ] Rate limiting on all endpoints

### Out of Scope

- Auto-responses / auto-reply drafting — Phase 2
- Email body content analysis — privacy boundary (data model will accommodate future optional content fields)
- AI-powered email summarization — Phase 3
- Shared/team mailbox support — future
- Mobile app — web-first
- Multi-language support — English only for now
- Non-Microsoft email providers — Microsoft 365 only
- Calendar integration — future
- SaaS multi-tenant billing — Phase 4
- Pattern types: time-based, subject, composite — will add iteratively after sender + folder routing prove out

## Context

- **Deployment target:** DGX server at 172.16.219.222 alongside TZMonitor (:3002/:8002) and AiChatDesk (:3005/:8005)
- **MSEDB ports:** Frontend :3010, Backend :8010, MongoDB :27020, Redis :6382
- **Resource cap:** 5 CPU cores, 5GB RAM total across all 4 containers
- **Infrastructure state:** Azure AD app registration and Cloudflare Tunnel not yet set up — need to be created as part of Phase 1
- **Initial user:** Taj (admin) — solo testing before wider rollout
- **Existing code:** Project scaffolding and documentation only — no application code yet
- **PRD status:** v1.1 Final, approved — detailed spec in `MSEDB-PRD.md`
- **Setup guide:** Infrastructure setup documented in `MSEDB-Setup-Guide.md`

## Constraints

- **Tech stack**: React 18 + Vite + Tailwind + shadcn/ui frontend, Express.js + Node.js 20 backend, MongoDB 7, Redis 7, Docker Compose — as specified in PRD
- **TypeScript**: Strict mode across frontend and backend
- **Privacy**: Email body content never stored (metadata only). Data model should accommodate optional content fields for future use without storing them now
- **Security**: AES-256-GCM token encryption, non-root containers, rate limiting, user data isolation at query level
- **Infrastructure**: Zero host dependencies — everything runs in Docker containers. No Node.js/npm/Redis/MongoDB installed on host
- **Network**: Must coexist with other Docker services on same host without port or network conflicts
- **Graph API**: Webhook subscriptions expire every 3 days max — need reliable renewal. Microsoft Graph rate limits apply
- **Authentication**: Azure AD OAuth 2.0 only — no local/password auth

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Start with sender + folder routing patterns only | Highest value, lowest complexity. Add subject/time/composite iteratively | — Pending |
| Multi-action rules from day 1 | Single-action model is hard to refactor later. Design data model for multiple actions per rule | — Pending |
| Email body never stored, but model accommodates future content fields | Privacy boundary now, but don't paint ourselves into a corner architecturally | — Pending |
| Query-level user data isolation (not separate databases) | Sufficient for single-org deployment. Simpler than database-per-tenant | — Pending |
| Request Mail.Send scope upfront even though Phase 1 doesn't use it | Avoids re-consent when Phase 2 adds auto-responses | — Pending |
| BullMQ + Redis for background jobs | Already need Redis for caching; BullMQ adds reliable job processing with minimal overhead | — Pending |
| Cloudflare Tunnel for webhook exposure | Avoids opening ports on DGX; provides HTTPS for Graph API webhook requirements | — Pending |

---
*Last updated: 2026-02-16 after initialization*
