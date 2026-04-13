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

## Architecture

- Next.js (React + TS) frontend, Express.js backend
- Microsoft Graph API: `Mail.Read`, `Mail.ReadWrite`, `MailboxSettings.ReadWrite`
- Auth: MSAL OAuth 2.0 authorization code grant
- All Graph calls: `https://graph.microsoft.com/v1.0/`
- No mailbox rule created without explicit user approval
- TypeScript strict mode across both frontend and backend

## Commands

```bash
# Start
cd ~/claude/MSEDB && docker compose up -d --build

# Logs
docker compose logs -f msedb-backend
docker compose logs -f msedb-frontend

# Stop (keep data — preferred)
docker compose down

# NEVER: docker compose down -v (shared MongoDB — destroys JTCRM data too)
```

## Architecture

Express.js backend connects to Microsoft Graph API via MSAL OAuth. Monitors M365 mailboxes, detects repetitive email actions (e.g., always moving emails from X to folder Y), and surfaces suggested inbox rules. No rules are created without explicit user approval via UI. Frontend is Next.js served by nginx with HTTPS (self-signed certs in `certs/`). Office Add-in is a separate build (`addin/`) served at `/addin` path. Desktop app (`desktop/`) runs natively, not in Docker. Shared Qdrant (from AX1 at port 6333) for vector search on emails.

## Entry Points

| What | Path |
|------|------|
| Backend entry | `backend/src/index.ts` |
| Graph API client | `backend/src/graph/` |
| Auth (MSAL) | `backend/src/auth/` |
| Rule engine | `backend/src/rules/` |
| MongoDB models | `backend/src/models/` |
| Frontend entry | `frontend/src/pages/_app.tsx` |
| Office Add-in | `addin/src/` — built separately |
| Desktop app | `desktop/` — runs on host, not Docker |
| Tests | `backend/src/__tests__/` or `backend/tests/` |
| Runbook | `RUNBOOK.md` ← read before starting/stopping |

## Gotchas

- **Shared MongoDB container** — port 27020 is shared with JTCRM. Never `down -v` on MSEDB
- **HTTPS frontend** — nginx uses self-signed certs from `certs/` — browser will warn; use tunnel URL
- **Qdrant dependency** — AX1's Qdrant at port 6333 must be running before MSEDB backend starts
- **Office Add-in** — must be built separately (`cd addin && npm run build`) before it appears in frontend
- **Desktop app** — runs natively on host (not in Docker) — has different build and deploy process
- **MSAL token refresh** — Microsoft tokens expire; backend handles refresh automatically via MSAL
- **No mailbox rules without approval** — core UX contract: show suggestion → user approves → create rule

## Always Use Docker

NEVER run `node` or `next dev` directly on host.
ALWAYS: `docker compose up -d --build`
See RUNBOOK.md for full startup procedure.
