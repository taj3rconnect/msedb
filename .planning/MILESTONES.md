# Milestones: MSEDB

## v1.0 MVP

**Shipped:** 2026-02-18
**Timeline:** 2 days (2026-02-16 → 2026-02-18)
**Phases:** 1-8 (8 phases, 25 plans)
**Git range:** b2ad3eb..8561ce9 (112 commits, 49 feature commits)
**Codebase:** 19,644 LOC TypeScript/TSX/CSS across 296 files

**Delivered:** A self-hosted email intelligence portal that connects to Microsoft 365 mailboxes via Graph API, observes email behavior in real-time, detects repetitive patterns with confidence scoring, and automates email actions with explicit user approval — including a staging folder, kill switch, undo capability, and an Outlook Add-in for inline whitelist/blacklist actions.

**Key accomplishments:**

1. Containerized Docker Compose stack with Express 5, React 19, MongoDB 7, Redis 7, and BullMQ background jobs
2. Azure AD OAuth 2.0 SSO with multi-mailbox support, encrypted token storage (AES-256-GCM), and MSAL cache persistence across container restarts
3. Real-time email observation pipeline via Graph API webhooks with delta query fallback and event deduplication
4. React dashboard with Socket.IO real-time updates, email activity visualization (timeline + sender breakdown), and full app shell with sidebar navigation
5. Pattern detection engine with asymmetric confidence scoring (98% delete / 85% move thresholds), pattern suggestion cards with approve/reject/customize workflow
6. Automation rule engine with multi-action rules, staging folder (24h grace period), kill switch, whitelist protection, undo within 48h, and full audit logging
7. Settings page, admin panel (user management, org rules, system health), and in-app notification system
8. Outlook Add-in with NAA SSO authentication and sender/domain whitelist/blacklist actions syncing to backend

**Known gaps:**
- Cloudflare Tunnel not yet configured (webhook code ready, tunnel setup deferred by user)
- manifest.xml requires manual Azure AD client ID configuration before sideloading

**Archive:**
- Roadmap: `.planning/milestones/v1.0-ROADMAP.md`
- Requirements: `.planning/milestones/v1.0-REQUIREMENTS.md`
