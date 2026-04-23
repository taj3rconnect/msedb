# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# MSEDB

Microsoft Email Dashboard — monitors M365 mailboxes, detects repetitive actions, creates rules on approval.

## Infrastructure — DO NOT CHANGE

| Key | Value |
|-----|-------|
| **Server** | **DGX** |
| **Tunnel** | msedb (acdd721a) → **msedb.aptask.com** |
| **Docker subnet** | default bridge |
| **Registry** | See `~/claude/PORT_REGISTRY.json` for master port list |

## Ports — DO NOT CHANGE

| Service  | Host Port | Internal | Container | Notes |
|----------|-----------|----------|-----------|-------|
| Frontend | **3010**  | 8080     | msedb-frontend | React/Nginx |
| Backend  | **8010**  | 8010     | msedb-backend | Express |
| MongoDB  | **27020** | 27017    | msedb-mongo | mongo:7, db: msedb |
| Redis    | **6382**  | 6379     | msedb-redis | Redis 7 |
| Tunnel   | —         | —        | msedb-tunnel | cloudflare/cloudflared |

Shared: Uses AX1 Qdrant at port 6333.

## Commands

```bash
# Build and start all services
cd ~/claude/MSEDB && docker compose up -d --build

# Logs
docker compose logs -f msedb-backend
docker compose logs -f msedb-frontend

# Stop (keep data — preferred)
docker compose down

# NEVER: docker compose down -v (shared MongoDB — destroys JTCRM data too)
```

### Backend (inside container or local dev)
```bash
cd backend
yarn build          # tsc compile to dist/
yarn dev            # tsx watch src/server.ts (auto-reload)
yarn test           # vitest run (all tests once)
yarn test:watch     # vitest watch mode
```

### Run a single test file
```bash
cd backend && npx vitest run src/routes/__tests__/patterns-hasRule.test.ts
```

### Frontend (inside container or local dev)
```bash
cd frontend
yarn dev            # Vite dev server on :5173
yarn build          # tsc -b && vite build
yarn lint           # eslint .
```

### Office Add-in (separate build — not in Docker)
```bash
cd addin && npm run build   # output copied into frontend nginx path
```

## Architecture

React (Vite + TypeScript) frontend served by Nginx, Express 5 backend with TypeScript strict mode.

- **Auth**: MSAL OAuth 2.0 authorization code grant → JWT session cookie (`msedb_session`). Outlook add-in uses Azure AD Bearer token (NAA flow).
- **Graph API**: All calls via `https://graph.microsoft.com/v1.0/` with `Mail.Read`, `Mail.ReadWrite`, `MailboxSettings.ReadWrite`
- **Real-time**: Socket.IO server co-hosted on Express port 8010; frontend uses `useSocket()` hook
- **Core UX contract**: Never create a mailbox rule without explicit user approval — always show suggestion first

### Backend startup sequence (`backend/src/server.ts`)
1. Connect MongoDB (with retry) + verify Redis
2. Apply rate limiters (20 req/min `/auth`, 100 req/min `/api`)
3. Mount CSRF token endpoint + validation middleware on all non-GET routes
4. Initialize BullMQ job schedulers
5. Initialize tunnel config + sync Graph webhook subscriptions
6. Create Socket.IO server
7. Warm contacts cache (background)

### Job Queue Architecture (BullMQ + Redis)
11 independent queues, each with a dedicated worker in `backend/src/workers/`:

| Queue | Purpose |
|-------|---------|
| `webhook-events` | Process MS Graph change notifications |
| `webhook-renewal` | Refresh Graph webhook subscriptions |
| `delta-sync` | Incremental email fetch from Graph |
| `pattern-analysis` | ML pattern detection on email events |
| `staging-processor` | Apply rules to staged emails |
| `token-refresh` | Refresh expired MS Graph tokens |
| `email-embedding` | Generate Qdrant vector embeddings |
| `scheduled-email` | Send outbound scheduled emails |
| `contacts-sync` | Sync contacts from mailbox |
| `daily-report` | Generate daily analytics |
| `scheduled-email-cleanup` | Purge old scheduled emails |

### Route Structure

All routes require `requireAuth` middleware except `/health`, `/track`, and `/webhooks`.

| Route | Purpose |
|-------|---------|
| `GET /auth/login` | Redirect to Azure AD |
| `GET /auth/callback` | Exchange code, set JWT cookie |
| `POST /auth/logout` | Clear session |
| `/api/mailboxes` | Mailbox sync, folder cache, whitelist |
| `/api/patterns` | Pattern detection results |
| `/api/rules` | Create/approve/delete rules |
| `/api/staging` | Staged email review queue |
| `/api/events` | Email event timeline |
| `/api/ai-search` | Qdrant + Ollama semantic search |
| `/api/scheduled-emails` | Outbound scheduling |
| `/api/audit` | Audit log |
| `/api/reports` | Analytics reports |
| `/api/admin` | System admin ops |
| `/webhooks` | Graph API webhook endpoint (public) |
| `/track` | Email tracking pixel (public) |

### Core Services (`backend/src/services/`)

- **patternEngine** — Confidence-scored sender behavior analysis
- **ruleEngine** — Evaluates rule conditions against email events
- **actionExecutor** — Applies Graph API actions (delete, move, archive, mark read, flag, categorize)
- **deltaService** — Incremental Graph sync with delta tokens
- **graphClient** — MS Graph API wrapper
- **qdrantClient** — Vector DB client for semantic search
- **ollamaClient** — Local LLM (embeddings: `nomic-embed-text`, instruct: `qwen3:1.7b`, write: `qwen3.5:35b-a3b`)

### Frontend Stack

React 19 + React Router 7, Zustand (auth store), TanStack React Query + custom hooks per domain (`usePatterns`, `useRules`, `useMailboxes`, etc.), shadcn/ui + Radix UI + Tailwind CSS 4, Recharts, AG Grid + TanStack Table, Socket.IO client, Sonner notifications.

Path alias: `@/*` → `frontend/src/*`

## Entry Points

| What | Path |
|------|------|
| Backend entry | `backend/src/server.ts` |
| Backend config | `backend/src/config/index.ts` |
| Graph API client | `backend/src/graph/` |
| Auth (MSAL) | `backend/src/auth/` |
| Rule engine | `backend/src/rules/` |
| MongoDB models | `backend/src/models/` |
| BullMQ workers | `backend/src/workers/` |
| Frontend entry | `frontend/src/main.tsx` |
| Frontend pages | `frontend/src/pages/` |
| Office Add-in | `addin/src/` — built separately |
| Desktop app | `desktop/` — runs on host, not Docker |
| Tests | `backend/src/routes/__tests__/`, `backend/src/services/__tests__/` |
| Runbook | `RUNBOOK.md` ← read before starting/stopping |

## Gotchas

- **Shared MongoDB container** — port 27020 is shared with JTCRM. Never `down -v` on MSEDB
- **HTTPS frontend** — Nginx uses self-signed certs from `certs/` — browser will warn; use tunnel URL
- **Qdrant dependency** — AX1's Qdrant at port 6333 must be running before backend starts
- **Office Add-in** — must be built separately (`cd addin && npm run build`) before it appears in frontend
- **Desktop app** — runs natively on host (not in Docker) — different build/deploy process
- **MSAL token refresh** — handled automatically by backend; encrypted tokens stored per-user in MongoDB
- **CSRF** — all non-GET API requests require the `x-csrf-token` header obtained from `GET /auth/csrf-token`

## Always Use Docker

NEVER run `node` or `vite dev` directly on host.
ALWAYS: `docker compose up -d --build`
See RUNBOOK.md for full startup procedure.
