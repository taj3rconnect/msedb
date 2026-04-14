# RUNBOOK — MSEDB

> Single source of truth for starting, stopping, and debugging this app.
> Update this file whenever ports, services, or dependencies change.

---

## Quick Start

```bash
cd ~/claude/MSEDB

# 1. Copy env template (first time only)
cp .env.example .env
# Edit .env — set AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID, JWT_SECRET, MONGO_URI

# 2. Start all services
docker compose up -d --build

# 3. Verify running
docker compose ps
```

## Quick Stop

```bash
cd ~/claude/MSEDB

# Stop all (keep MongoDB data)
docker compose down

# Stop + wipe MongoDB data (DESTROYS ALL EMAIL RULE DATA)
docker compose down -v
```

---

## Services & Ports

| Service | Container | Host Port | Internal | URL |
|---------|-----------|-----------|----------|-----|
| Frontend | msedb-frontend | **3010** | 8080 | https://localhost:3010 |
| Backend | msedb-backend | **8010** | 8010 | http://localhost:8010 |
| MongoDB | msedb-mongo | **27020** | 27017 | localhost:27020 (shared) |
| Redis | msedb-redis | **6382** | 6379 | localhost:6382 |
| Cloudflare | msedb-tunnel | — | — | |

**Cloudflare tunnel:** msedb.aptask.com → localhost:3010
**Shared MongoDB:** port 27020 is shared with JTCRM — same container, different database

**Note:** Frontend serves HTTPS (self-signed certs in `certs/`). The addin is served from `/addin` path.

---

## Startup Order

```
1. msedb-mongo (waits for healthcheck)
2. msedb-redis (waits for healthcheck)
       ↓
3. msedb-backend (waits for mongo + redis healthy, ~30s start_period)
       ↓
4. msedb-frontend (nginx, waits for backend healthy)
5. msedb-tunnel (cloudflared)
```

---

## Dependencies

### System Requirements (DGX host)
- Docker + Docker Compose v2
- GPU: NO
- Azure AD App Registration (single-tenant, O365)
- Microsoft Graph API permissions: `Mail.Read`, `Mail.ReadWrite`, `MailboxSettings.ReadWrite`
- Shared Qdrant at port 6333 (from AX1 — must be running)

### Docker Images (auto-pulled)
| Image | Service | Notes |
|-------|---------|-------|
| mongo:7 | msedb-mongo | Shared with JTCRM on port 27020 |
| redis:7-alpine | msedb-redis | Port 6382 |
| node:20-alpine (Dockerfile) | msedb-backend | Express.js + TypeScript |
| node:20-alpine (Dockerfile) | msedb-frontend | Next.js served by nginx |
| cloudflare/cloudflared | msedb-tunnel | |

### External Dependency
- **AX1 Qdrant** at `localhost:6333` — must be running before MSEDB backend starts
  - Start AX1: `cd ~/claude/AX1 && docker compose up -d qdrant`

### Backend Dependencies (inside Docker, NOT host)
Key from `backend/package.json`:
```
express              # REST API
@azure/msal-node     # Microsoft OAuth
@microsoft/microsoft-graph-client  # Graph API
mongoose             # MongoDB ODM
redis                # Redis client
jsonwebtoken         # JWT auth
vitest               # Testing
```

---

## Database

| Property | Value |
|----------|-------|
| Engine | MongoDB 7 |
| Host (from backend container) | `msedb-mongo` (container name, shared) |
| Host (from DGX host) | `localhost` |
| Port | 27020 (host, shared with JTCRM) / 27017 (internal) |
| Database name | `msedb` |
| Volume | `msedb-mongo-data` |
| Wiped by | `docker compose down -v` ONLY |

**WARNING:** MongoDB container is shared with JTCRM. `docker compose down -v` on MSEDB WILL wipe JTCRM data too. Always use `docker compose down` (no `-v`).

```bash
# MongoDB shell
docker compose exec msedb-mongo mongosh msedb

# Check collections
docker compose exec msedb-mongo mongosh msedb --eval "db.getCollectionNames()"
```

---

## Authentication

| Auth Type | Where | Key Env Vars |
|-----------|-------|-------------|
| MSAL OAuth 2.0 | `backend/src/auth/` | `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID` |
| Microsoft Graph | `backend/src/graph/` | Same Azure app creds |
| JWT (internal) | `backend/src/middleware/` | `JWT_SECRET` |

### Microsoft Graph Auth Flow
1. User logs in via MSAL (authorization code grant)
2. Backend receives token → access Microsoft Graph
3. All Graph calls: `https://graph.microsoft.com/v1.0/`
4. No mailbox rule created without explicit user approval

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AZURE_CLIENT_ID` | YES | Azure AD App Registration client ID |
| `AZURE_CLIENT_SECRET` | YES | Azure AD App client secret |
| `AZURE_TENANT_ID` | YES | Azure AD tenant ID |
| `JWT_SECRET` | YES | Random 32+ char string |
| `MONGO_URI` | YES | `mongodb://msedb-mongo:27017/msedb` |
| `REDIS_URL` | YES | `redis://msedb-redis:6379` |
| `QDRANT_URL` | YES | `http://host.docker.internal:6333` |
| `FRONTEND_URL` | NO | `https://msedb.aptask.com` |

---

## Common Issues & Fixes

| Symptom | Cause | Fix |
|---------|-------|-----|
| Backend health check failing | MSAL init slow | Wait 30s (start_period in healthcheck) |
| Graph API 403 | Missing Azure permissions | Verify app registration has correct Graph scopes |
| Qdrant connection refused | AX1 not running | `cd ~/claude/AX1 && docker compose up -d qdrant` |
| Frontend HTTPS cert error | Self-signed cert | Expected — add exception in browser or use tunnel URL |
| MongoDB shared container conflict | Wipe with -v | Never use `down -v` — use `down` only |
| Addin not loading | Addin dist not built | `cd addin && npm run build` then restart frontend |

---

## Office Add-in (addin/)

The Office.js add-in is built separately and served by nginx from the frontend container.

```bash
# Build addin (must rebuild frontend after)
cd addin && npm run build

# The built files go to addin/dist/ which is volume-mounted into frontend container
# nginx serves addin at /addin path

# Restart frontend to pick up new addin build
docker compose restart msedb-frontend
```

---

## Desktop App (desktop/)

The desktop app (Electron or native) runs separately — not in Docker.

```bash
# Build desktop (on host, not in Docker)
cd desktop && npm install && npm run build
```

---

## Logs

```bash
cd ~/claude/MSEDB
docker compose logs -f msedb-backend
docker compose logs -f msedb-frontend
# Log files volume-mounted to msedb-logs volume
```

---

## Health Checks

```bash
# Backend API
curl http://localhost:8010/api/health

# Frontend (HTTPS self-signed)
curl -k https://localhost:3010

# MongoDB
docker compose exec msedb-mongo mongosh --eval "db.adminCommand('ping')"

# Redis
docker compose exec msedb-redis redis-cli ping

# Qdrant (external)
curl http://localhost:6333/healthz
```

---

## Backup & Restore

```bash
# Backup MongoDB (MSEDB database only — do NOT dump all)
docker compose exec msedb-mongo mongodump --db msedb --out /tmp/backup
docker cp msedb-mongo:/tmp/backup ./backup_$(date +%Y%m%d)

# Restore
docker cp ./backup_YYYYMMDD msedb-mongo:/tmp/restore
docker compose exec msedb-mongo mongorestore /tmp/restore/msedb --db msedb
```
