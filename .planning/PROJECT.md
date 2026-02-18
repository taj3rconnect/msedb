# MSEDB — Microsoft Email DashBoard

## What This Is

A self-hosted, containerized email management portal that connects to Microsoft 365 via Microsoft Graph API, passively observes how users handle their email (delete, move, archive, flag), detects repetitive behavioral patterns with confidence scoring, and — with explicit user approval — creates automation rules to handle those actions automatically. Includes a React dashboard for management and an Outlook Add-in for inline sender/domain actions. Built as a Docker Compose stack (Express 5, React 19, MongoDB 7, Redis 7) running on a DGX server.

## Core Value

Users never lose control of their email. The system observes, learns, suggests, and only acts with explicit approval — and every action can be undone.

## Current State

**Version:** v1.0 MVP (shipped 2026-02-18)
**Codebase:** 19,644 LOC TypeScript/TSX/CSS across 296 files
**Stack:** Node.js 22, Express 5, React 19, Tailwind 4, Mongoose 8, BullMQ 5, MSAL Node 2.x

**What's shipped:**
- Full observation-to-automation pipeline (webhooks → patterns → rules → staging → execution)
- 7 dashboard pages (Dashboard, Email Activity, Patterns, Rules, Staging, Audit Log, Settings, Admin)
- 6 BullMQ background jobs (webhook renewal, delta sync, pattern analysis, staging processor, token refresh, daily digest)
- Multi-mailbox per user with independent tokens/webhooks/patterns/rules
- Safety: staging folder (24h grace), kill switch, undo (48h), whitelist protection, audit logging
- Outlook Add-in with NAA SSO and sender/domain whitelist/blacklist actions

**Known operational gaps:**
- Cloudflare Tunnel not yet configured (webhook subscriptions will fail until set up)
- Azure AD app registration requires manual configuration before first use

## Requirements

### Validated

- ✓ Azure AD OAuth 2.0 SSO with multi-mailbox support — v1.0
- ✓ Real-time email observation via Graph API webhooks + delta query fallback — v1.0
- ✓ Sender-level and folder routing pattern detection with confidence scoring — v1.0
- ✓ Multi-action automation rules with staging folder, kill switch, undo, whitelist — v1.0
- ✓ React dashboard with 7 pages and Socket.IO real-time updates — v1.0
- ✓ Settings, admin panel, and in-app notification system — v1.0
- ✓ Outlook Add-in with NAA SSO and sender/domain whitelist/blacklist — v1.0
- ✓ Containerized Docker Compose stack with BullMQ background jobs — v1.0
- ✓ AES-256-GCM token encryption, rate limiting, user data isolation — v1.0

### Active

(None — next milestone not yet planned)

### Out of Scope

- Auto-responses / auto-reply drafting — future milestone
- Email body content analysis — privacy boundary (metadata only)
- AI-powered email categorization — future milestone
- Shared/team mailbox support — future
- Mobile app — web-first (responsive covers mobile browsers)
- Multi-language support — English only
- Non-Microsoft email providers — Microsoft 365 only
- Calendar integration — future
- SaaS multi-tenant billing — future
- Time-based/subject/composite patterns — iterative addition after sender + folder prove out
- Outlook Add-in email tracking, AI rewrite/compose, templates — future

## Context

- **Deployment target:** DGX server at 172.16.219.222 alongside TZMonitor (:3002/:8002) and AiChatDesk (:3005/:8005)
- **MSEDB ports:** Frontend :3010, Backend :8010, MongoDB :27020, Redis :6382
- **Resource cap:** 5 CPU cores, 5GB RAM total across all 4 containers
- **Initial user:** Taj (admin) — solo testing before wider rollout
- **Multi-domain O365 tenant:** Multiple business domains (aptask.com, jobtalk.ai, yenom.ai, etc.) under one Azure AD tenant
- **PRD:** v1.1 Final in `MSEDB-PRD.md`
- **Setup guide:** `MSEDB-Setup-Guide.md`

## Constraints

- **Tech stack**: React 19 + Vite + Tailwind 4 + shadcn/ui frontend, Express 5 + Node.js 22 backend, MongoDB 7, Redis 7, Docker Compose
- **TypeScript**: Strict mode across frontend, backend, and add-in
- **Privacy**: Email body content never stored (metadata only)
- **Security**: AES-256-GCM token encryption, non-root containers, rate limiting, user data isolation at query level
- **Infrastructure**: Zero host dependencies — everything runs in Docker containers
- **Network**: Must coexist with other Docker services on same host
- **Graph API**: Webhook subscriptions expire every 3 days max — renewal job handles this
- **Authentication**: Azure AD OAuth 2.0 only — no local/password auth

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Start with sender + folder routing patterns only | Highest value, lowest complexity | ✓ Good — shipped in v1.0 |
| Multi-action rules from day 1 | Single-action model hard to refactor later | ✓ Good — works well |
| Email body never stored | Privacy boundary now, model accommodates future fields | ✓ Good |
| Query-level user data isolation | Sufficient for single-org deployment | ✓ Good |
| BullMQ + Redis for background jobs | Already need Redis for caching; adds reliable job processing | ✓ Good |
| Cloudflare Tunnel for webhook exposure | Avoids opening ports on DGX; provides HTTPS | — Pending (not configured) |
| Multi-mailbox per user (not 1:1) | Users have email across multiple domains | ✓ Good — clean data model |
| Outlook Add-in in v1 scope | Ties directly into safety features (whitelist/blacklist) | ✓ Good |
| Redis noeviction policy | Prevents BullMQ job key eviction | ✓ Good |
| MSAL cache in MongoDB via ICachePlugin | Survives container restarts | ✓ Good |
| Signed JWT as OAuth state parameter | No Redis nonce lookup required | ✓ Good |
| Webhook handler returns 202 immediately | Zero blocking; BullMQ processes events | ✓ Good |
| Vitest over Jest | Native ESM, no transforms needed | ✓ Good |
| Asymmetric confidence thresholds (98%/85%) | Higher bar for destructive actions | ✓ Good |
| NAA for Outlook Add-in SSO | Modern auth approach, no getAccessTokenAsync fallback | ✓ Good |
| webpack.config.cjs for add-in | ESM package.json needs CommonJS webpack config | ✓ Good |
| CORS origin callback for multi-origin | Supports dashboard + add-in origins | ✓ Good |

---
*Last updated: 2026-02-18 after v1.0 milestone*
