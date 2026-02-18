# MSEDB — Microsoft Email Dashboard

A self-hosted email intelligence portal that connects to Microsoft 365 mailboxes, observes email behavior in real-time, detects repetitive patterns, and automates email actions with explicit user approval.

**Version:** v1.0 MVP | **Codebase:** 19,644 LOC TypeScript/TSX/CSS across 296 files

## Core Value

Users never lose control of their email. The system observes, learns, suggests, and only acts with explicit approval — and every action can be undone.

## How It Works

```
┌─────────────┐    Webhooks     ┌─────────────┐    Patterns    ┌─────────────┐
│ Microsoft   │ ──────────────> │   MSEDB     │ ────────────> │  Dashboard  │
│ Graph API   │ <────────────── │   Backend   │ <──────────── │  (React)    │
└─────────────┘   Delta Sync    └──────┬──────┘   Approve     └─────────────┘
                                       │
                                ┌──────┴──────┐
                                │  MongoDB +  │
                                │    Redis    │
                                └─────────────┘
```

1. **Observe** — Webhooks and delta queries capture email actions (delete, move, archive, flag) in real-time
2. **Detect** — Pattern engine analyzes sender-level and folder routing behaviors with confidence scoring
3. **Suggest** — Patterns exceeding confidence thresholds appear as suggestion cards in the dashboard
4. **Approve** — User reviews, customizes, and explicitly approves each automation rule
5. **Execute** — Rules run automatically with staging folder protection, kill switch, and 48-hour undo

## Features

| Category | Features |
|----------|----------|
| **Authentication** | Azure AD OAuth 2.0 SSO, multi-mailbox per user, encrypted token storage (AES-256-GCM) |
| **Observation** | Graph API webhooks with delta query fallback (15-min intervals), metadata-only (no email body) |
| **Intelligence** | Sender + folder routing pattern detection, asymmetric confidence (98% delete / 85% move) |
| **Automation** | Multi-action rules (move + mark read + categorize), priority ordering, per-rule stats |
| **Safety** | Staging folder (24h grace), kill switch, undo (48h), whitelist protection, audit logging |
| **Dashboard** | 7 pages with Socket.IO real-time updates, in-app notifications, admin panel |
| **Add-in** | Outlook Add-in with NAA SSO, sender/domain whitelist/blacklist from reading pane |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 6, Tailwind CSS 4, shadcn/ui, TanStack Query, Zustand, Recharts |
| Backend | Express 5, Node.js 22, TypeScript (strict), Socket.IO |
| Database | MongoDB 7 (Mongoose 8), Redis 7 (ioredis) |
| Jobs | BullMQ 5 — 6 queues, 5 scheduled jobs |
| Auth | MSAL Node 2.x (Azure AD OAuth 2.0), JWT httpOnly cookies |
| Add-in | Office.js, MSAL Browser (NAA), Webpack 5 |
| Infrastructure | Docker Compose, nginx, tini |

## Dashboard Pages

| Page | Description |
|------|-------------|
| **Dashboard** | Stats cards, activity feed, pending pattern suggestions |
| **Email Activity** | Filterable event log, timeline chart, sender domain breakdown |
| **Patterns** | Pattern cards with confidence visualization, approve/reject/customize |
| **Rules** | Drag-and-drop priority ordering, enable/disable, execution stats |
| **Staging** | Countdown timers, rescue (undo) or execute immediately |
| **Audit Log** | Filterable action history with undo buttons (48h window) |
| **Settings** | Preferences, mailbox management, whitelists, data export/delete |
| **Admin** | User management, org-wide rules, analytics, system health |

## Project Structure

```
MSEDB/
├── backend/                    Express 5 API + BullMQ jobs
│   ├── src/
│   │   ├── auth/               MSAL, JWT middleware, SSO validation, token manager
│   │   ├── config/             Database, Redis, Socket.IO, logger, env config
│   │   ├── jobs/               6 BullMQ queues + 5 scheduled processors
│   │   ├── middleware/         Security (Helmet, CORS), rate limiting, error handling
│   │   ├── models/             9 Mongoose models (User, Mailbox, EmailEvent, etc.)
│   │   ├── routes/             13 route modules (auth, health, webhooks, CRUD)
│   │   ├── services/           Pattern engine, rule engine, Graph client, staging, undo
│   │   └── server.ts           App startup with retry + graceful shutdown
│   └── Dockerfile              Multi-stage Node 22 Alpine + tini
├── frontend/                   React 19 SPA
│   ├── src/
│   │   ├── api/                13 API client modules
│   │   ├── components/         Feature components + 30+ shadcn/ui primitives
│   │   ├── hooks/              14 custom hooks (data fetching, Socket.IO, state)
│   │   ├── pages/              9 page components
│   │   ├── stores/             3 Zustand stores (auth, notifications, UI)
│   │   └── App.tsx             Router + TanStack QueryProvider
│   ├── nginx.conf              Reverse proxy (API, WebSocket, SPA fallback)
│   └── Dockerfile              Multi-stage build → nginx-unprivileged
├── addin/                      Outlook Add-in
│   ├── src/
│   │   ├── auth/               MSAL NAA config + token helpers
│   │   ├── api/                Backend client with Bearer auth
│   │   ├── taskpane/           React UI (sender/domain whitelist/blacklist)
│   │   └── commands/           Ribbon command handlers
│   ├── manifest.xml            Office Add-in manifest
│   └── webpack.config.cjs      Webpack 5 (dual entry: taskpane + commands)
├── docker-compose.yml          4 services, bridge network, resource limits
├── docs/                       Detailed documentation
│   ├── requirements.md         All requirements with traceability
│   ├── deploy.md               Step-by-step deployment guide
│   └── infrastructure.md       Architecture, database, jobs, security
└── .env.example                Environment variable template
```

## Quick Start

### Prerequisites

- Docker and Docker Compose
- An Azure AD tenant with an app registration ([setup guide](docs/deploy.md#azure-ad-app-registration))
- A public HTTPS endpoint for webhooks (Cloudflare Tunnel recommended)

### Deploy

```bash
# Clone and configure
git clone <repository-url>
cd MSEDB
cp .env.example .env
# Edit .env with Azure AD credentials and secrets (see docs/deploy.md)

# Start all services
docker compose up -d

# Verify health
curl http://localhost:8010/api/health
```

The dashboard is available at `http://localhost:3010`. See [docs/deploy.md](docs/deploy.md) for the complete deployment guide including Azure AD setup, Cloudflare Tunnel configuration, and first-login walkthrough.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AZURE_AD_TENANT_ID` | Yes | Azure AD tenant ID |
| `AZURE_AD_CLIENT_ID` | Yes | Azure AD application (client) ID |
| `AZURE_AD_CLIENT_SECRET` | Yes | Azure AD client secret |
| `ENCRYPTION_KEY` | Yes | AES-256-GCM key (64 hex chars) |
| `JWT_SECRET` | Yes | JWT signing secret (128 hex chars) |
| `SESSION_SECRET` | Yes | Session secret (64 hex chars) |
| `ADMIN_EMAIL` | Yes | Email of the first admin user |
| `APP_URL` | No | Frontend URL (default: `http://localhost:3010`) |
| `API_URL` | No | Backend URL (default: `http://localhost:8010`) |
| `GRAPH_WEBHOOK_URL` | No | Public HTTPS URL for Graph webhooks |
| `MONGODB_URI` | No | MongoDB connection (default: `mongodb://msedb-mongo:27017/msedb`) |
| `REDIS_HOST` | No | Redis host (default: `msedb-redis`) |

See [.env.example](.env.example) for the full list with defaults.

## API Overview

All API routes are prefixed with `/api/` except auth (`/auth/`) and webhooks (`/webhooks/`).

| Route Group | Key Endpoints | Auth |
|-------------|---------------|------|
| Auth | `GET /auth/login`, `GET /auth/callback`, `GET /auth/me` | Public / SSO+Cookie |
| Health | `GET /api/health` | None |
| Dashboard | `GET /api/dashboard/stats`, `GET /api/dashboard/activity` | Cookie |
| Events | `GET /api/events`, `GET /api/events/timeline`, `GET /api/events/sender-breakdown` | Cookie |
| Patterns | `GET /api/patterns`, `POST /api/patterns/:id/approve`, `POST /api/patterns/:id/reject` | Cookie |
| Rules | `GET /api/rules`, `POST /api/rules`, `PUT /api/rules/reorder` | Cookie |
| Staging | `GET /api/staging`, `POST /api/staging/:id/rescue`, `POST /api/staging/:id/execute` | Cookie |
| Audit | `GET /api/audit`, `POST /api/audit/:id/undo` | Cookie |
| Mailboxes | `GET /api/mailboxes`, `POST /api/mailboxes/connect`, `PUT /api/mailboxes/:id/whitelist` | Cookie |
| Admin | `GET /api/admin/users`, `GET /api/admin/health`, `POST /api/admin/org-rules` | Admin |

Full endpoint documentation: [docs/infrastructure.md](docs/infrastructure.md#api-endpoints)

## Background Jobs

| Job | Schedule | Purpose |
|-----|----------|---------|
| Webhook Events | On-demand (queue) | Process Graph change notifications |
| Webhook Renewal | Every 2 hours | Renew expiring subscriptions (3-day max) |
| Delta Sync | Every 15 minutes | Catch events missed by webhooks |
| Pattern Analysis | Daily at 2 AM | Detect sender + folder routing patterns |
| Staging Processor | Every 30 minutes | Execute expired staged emails (24h grace) |
| Token Refresh | Every 45 minutes | Proactive MSAL token refresh |

## Security

- **Encryption**: AES-256-GCM for all stored OAuth tokens (unique IV per encryption)
- **Authentication**: Azure AD OAuth 2.0 with JWT httpOnly cookies (24h expiry)
- **Authorization**: Role-based access control (admin/user), query-level data isolation
- **Rate limiting**: Redis-backed (auth: 5/min, API: 100/min)
- **Headers**: Helmet security headers, CORS restricted to dashboard + add-in origins
- **Privacy**: Email body content is never stored — metadata only
- **Containers**: Non-root users, tini for PID 1, resource limits enforced
- **Graph API**: `$select` on all queries to minimize data exposure

## Documentation

- [Requirements](docs/requirements.md) — All 42 v1.0 requirements with traceability
- [Deployment Guide](docs/deploy.md) — Step-by-step setup and operational procedures
- [Infrastructure](docs/infrastructure.md) — Architecture, database schemas, jobs, security details
- [Setup Guide](MSEDB-Setup-Guide.md) — Azure AD and server configuration reference
- [PRD](MSEDB-PRD.md) — Product Requirements Document (v1.1 Final)

## License

This project is licensed under the MIT License — see [LICENSE.md](LICENSE.md) for details.
