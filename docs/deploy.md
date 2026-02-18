# Deployment Guide — MSEDB

Step-by-step guide to deploy MSEDB on a server with Docker Compose.

**Target environment:** DGX server (or any Linux host with Docker)
**Estimated time:** 30-45 minutes

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Azure AD App Registration](#azure-ad-app-registration)
3. [Server Setup](#server-setup)
4. [Environment Configuration](#environment-configuration)
5. [Docker Compose Deployment](#docker-compose-deployment)
6. [Cloudflare Tunnel (Webhooks)](#cloudflare-tunnel-webhooks)
7. [First Login & Mailbox Connection](#first-login--mailbox-connection)
8. [Outlook Add-in Sideload](#outlook-add-in-sideload)
9. [Verification Checklist](#verification-checklist)
10. [Operational Procedures](#operational-procedures)
11. [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Docker** >= 24.0 and **Docker Compose** v2
- **Git** for cloning the repository
- A **Microsoft 365 tenant** with admin access
- A **domain** (for Cloudflare Tunnel HTTPS — required for webhooks)
- Network access: outbound HTTPS to `login.microsoftonline.com` and `graph.microsoft.com`

### Port Requirements

| Port | Service | Access |
|------|---------|--------|
| 3010 | Frontend (nginx) | LAN / public via tunnel |
| 8010 | Backend API | LAN / public via tunnel |
| 27020 | MongoDB | LAN only (debugging) |
| 6382 | Redis | LAN only (debugging) |

Ensure these ports don't conflict with other services on the host.

---

## Azure AD App Registration

### Step 1: Create the App

1. Go to [Azure Portal](https://portal.azure.com) → **Azure Active Directory** → **App registrations** → **New registration**
2. Name: `MSEDB`
3. Supported account types: **Accounts in this organizational directory only** (Single tenant)
4. Redirect URI: **Web** — `http://<YOUR_SERVER_IP>:8010/auth/callback`
   - Example: `http://172.16.219.222:8010/auth/callback`
5. Click **Register**

### Step 2: Note the IDs

From the app's **Overview** page, copy:
- **Application (client) ID** → `AZURE_AD_CLIENT_ID`
- **Directory (tenant) ID** → `AZURE_AD_TENANT_ID`

### Step 3: Create a Client Secret

1. Go to **Certificates & secrets** → **New client secret**
2. Description: `MSEDB Production`
3. Expiry: **24 months**
4. Copy the **Value** (not the Secret ID) → `AZURE_AD_CLIENT_SECRET`

### Step 4: Configure API Permissions

Go to **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions**:

| Permission | Purpose |
|------------|---------|
| `User.Read` | Read user profile for authentication |
| `Mail.ReadWrite` | Read, move, delete, and update emails |
| `Mail.Send` | Send emails (daily digest, future) |
| `MailboxSettings.ReadWrite` | Read/write mailbox rules |
| `offline_access` | Obtain refresh tokens |

Click **Grant admin consent for [Your Org]**.

### Step 5: Configure Token Settings

1. Go to **Authentication**
2. Implicit grant and hybrid flows: **Leave both unchecked**
3. Allow public client flows: **No**

### Step 6 (Optional): Add-in Permissions

If deploying the Outlook Add-in, add an additional scope:

1. Go to **Expose an API**
2. Set Application ID URI: `api://<CLIENT_ID>`
3. Add scope: `access_as_user`
   - Admins and users can consent
   - Display name: "Access MSEDB as user"
4. Under **Authorized client applications**, add:
   - `ea5a67f6-b6f3-4338-b240-c655ddc3cc8e` (Outlook desktop)
   - `d3590ed6-52b3-4102-aeff-aad2292ab01c` (Outlook mobile)
   - `08e18876-6177-487e-b8b5-cf950c1e598c` (Outlook web)
   - `93d53678-613d-4013-afc1-62e9e444a0a5` (Office web)

---

## Server Setup

### Clone the Repository

```bash
git clone <repository-url>
cd MSEDB
```

### Verify Docker

```bash
docker --version    # >= 24.0
docker compose version  # v2.x
```

---

## Environment Configuration

### Generate Secrets

```bash
# Generate cryptographic secrets
openssl rand -hex 32   # → ENCRYPTION_KEY (64 hex chars)
openssl rand -hex 64   # → JWT_SECRET (128 hex chars)
openssl rand -hex 32   # → SESSION_SECRET (64 hex chars)
```

### Create .env File

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# Azure AD (from App Registration)
AZURE_AD_TENANT_ID=your-tenant-id
AZURE_AD_CLIENT_ID=your-client-id
AZURE_AD_CLIENT_SECRET=your-client-secret

# Security (generated above)
ENCRYPTION_KEY=your-64-char-hex
JWT_SECRET=your-128-char-hex
SESSION_SECRET=your-64-char-hex

# URLs (adjust IP/domain for your server)
APP_URL=http://172.16.219.222:3010
API_URL=http://172.16.219.222:8010
ADDIN_URL=https://localhost:3000

# Webhook (set after Cloudflare Tunnel is configured)
GRAPH_WEBHOOK_URL=

# Admin
ADMIN_EMAIL=your-admin@company.com

# Database (defaults work with Docker Compose)
MONGODB_URI=mongodb://msedb-mongo:27017/msedb
REDIS_HOST=msedb-redis
REDIS_PORT=6379

# Runtime
NODE_ENV=production
PORT=8010
LOG_LEVEL=info
```

**Important:** MongoDB and Redis URIs use Docker service names (`msedb-mongo`, `msedb-redis`), not `localhost`. The host-mapped ports (27020, 6382) are for external debugging tools only.

---

## Docker Compose Deployment

### Build and Start

```bash
# Build all images and start in detached mode
docker compose up -d --build
```

### Verify Services

```bash
# Check all 4 containers are running and healthy
docker compose ps

# Expected output:
# msedb-backend    running (healthy)
# msedb-frontend   running (healthy)
# msedb-mongo      running (healthy)
# msedb-redis      running (healthy)
```

### Check Health Endpoint

```bash
curl http://localhost:8010/api/health | jq
```

Expected response:
```json
{
  "status": "healthy",
  "services": {
    "mongodb": "connected",
    "redis": "connected"
  },
  "queues": { "count": 6 },
  "subscriptions": { "active": 0 },
  "tokens": { "healthy": 0 }
}
```

### Service Startup Order

Docker Compose manages dependencies automatically:
1. **MongoDB** starts first (health check: `mongosh --eval db.adminCommand('ping')`)
2. **Redis** starts first (health check: `redis-cli ping`)
3. **Backend** starts after MongoDB + Redis are healthy
4. **Frontend** starts after Backend is healthy

### Resource Allocation

| Service | CPU | Memory | Purpose |
|---------|-----|--------|---------|
| msedb-backend | 2.0 cores | 2GB | API + BullMQ workers |
| msedb-frontend | 0.5 cores | 512MB | nginx static serving + reverse proxy |
| msedb-mongo | 2.0 cores | 2GB | Data storage |
| msedb-redis | 0.5 cores | 512MB | Job queues + rate limiting + caching |
| **Total** | **5.0 cores** | **5GB** | |

---

## Cloudflare Tunnel (Webhooks)

Microsoft Graph webhook subscriptions require a publicly-accessible HTTPS endpoint. Cloudflare Tunnel provides this without opening inbound ports.

### Install cloudflared

```bash
# Download and install
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

# Authenticate
cloudflared tunnel login
```

### Create Tunnel

```bash
cloudflared tunnel create msedb
```

### Configure Tunnel

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: ~/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: msedb.yourdomain.com
    service: http://localhost:3010
  - hostname: msedb-api.yourdomain.com
    service: http://localhost:8010
  - service: http_status:404
```

### Create DNS Records

```bash
cloudflared tunnel route dns msedb msedb.yourdomain.com
cloudflared tunnel route dns msedb msedb-api.yourdomain.com
```

### Run as Service

```bash
cloudflared service install
systemctl start cloudflared
systemctl enable cloudflared
```

### Update Environment

Edit `.env`:
```env
GRAPH_WEBHOOK_URL=https://msedb-api.yourdomain.com/webhooks/graph
APP_URL=https://msedb.yourdomain.com
API_URL=https://msedb-api.yourdomain.com
```

Restart the backend:
```bash
docker compose restart msedb-backend
```

### Update Azure AD Redirect URI

In the Azure portal, update the redirect URI to:
`https://msedb-api.yourdomain.com/auth/callback`

---

## First Login & Mailbox Connection

### Step 1: Access the Dashboard

Open `http://<YOUR_SERVER_IP>:3010` (or `https://msedb.yourdomain.com` if tunnel is configured).

### Step 2: Sign In

1. Click **Sign in with Microsoft**
2. Authenticate with your Microsoft 365 account
3. Grant the requested permissions (Mail.ReadWrite, MailboxSettings.ReadWrite, etc.)
4. You'll be redirected to the Dashboard

The email matching `ADMIN_EMAIL` in `.env` is automatically assigned the `admin` role on first login.

### Step 3: Connect a Mailbox

1. Go to **Settings** → **Mailboxes**
2. Click **Connect Mailbox**
3. Authenticate with the mailbox you want to monitor (can be different from your login)
4. The system will:
   - Store encrypted OAuth tokens
   - Create Graph API webhook subscriptions (if `GRAPH_WEBHOOK_URL` is set)
   - Start delta sync for existing emails
   - Begin observing email actions

### Step 4: Verify Observation

After connecting, check:
- **Dashboard** shows stats updating
- **Email Activity** shows recent events
- **Admin** → **System Health** shows healthy webhooks and tokens

---

## Outlook Add-in Sideload

### Step 1: Update manifest.xml

Edit `addin/manifest.xml` and replace all instances of `YOUR_AZURE_AD_CLIENT_ID` with your actual Azure AD Client ID.

### Step 2: Build the Add-in

```bash
cd addin
npm install
npm run build
```

### Step 3: Sideload in Outlook

**Outlook Desktop (Windows):**
1. Open Outlook → **Get Add-ins** (ribbon) → **My add-ins**
2. Click **Add a custom add-in** → **Add from file**
3. Select `addin/manifest.xml`

**Outlook Web:**
1. Go to outlook.office.com
2. Click the gear icon → **Manage integrations** → **Upload custom apps**
3. Upload `addin/manifest.xml`

### Step 4: Use the Add-in

1. Open any email
2. Click the **MSEDB** ribbon button
3. The taskpane shows sender and domain actions
4. Use **Never Delete** (whitelist) or **Always Delete** (blacklist) for the sender/domain

---

## Verification Checklist

After deployment, verify each component:

- [ ] `docker compose ps` shows all 4 containers healthy
- [ ] `curl localhost:8010/api/health` returns `"status": "healthy"`
- [ ] Dashboard loads at `:3010` and shows the login page
- [ ] Azure AD SSO login succeeds
- [ ] First user gets admin role (matches `ADMIN_EMAIL`)
- [ ] Mailbox connection completes (Settings → Mailboxes)
- [ ] Webhook subscriptions appear in Admin → System Health
- [ ] Email events appear in Email Activity page within 15 minutes
- [ ] Pattern analysis runs (check logs or trigger manually)
- [ ] Kill switch toggles in the top navigation bar

---

## Operational Procedures

### Viewing Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f msedb-backend

# Backend log files (inside container)
docker exec msedb-backend cat /app/logs/error.log
docker exec msedb-backend cat /app/logs/combined.log
```

### Restarting Services

```bash
# Restart a single service
docker compose restart msedb-backend

# Restart everything
docker compose down && docker compose up -d
```

### Updating

```bash
git pull
docker compose up -d --build
```

### Database Backup

```bash
# MongoDB dump (run from host)
docker exec msedb-mongo mongodump --db=msedb --out=/dump
docker cp msedb-mongo:/dump ./backup-$(date +%Y%m%d)

# Redis snapshot
docker exec msedb-redis redis-cli BGSAVE
docker cp msedb-redis:/data/dump.rdb ./backup-$(date +%Y%m%d)/redis-dump.rdb
```

### Database Restore

```bash
# MongoDB restore
docker cp ./backup-20260218 msedb-mongo:/dump
docker exec msedb-mongo mongorestore --db=msedb /dump/msedb

# Redis restore (requires restart)
docker compose stop msedb-redis
docker cp ./backup-20260218/redis-dump.rdb msedb-redis:/data/dump.rdb
docker compose start msedb-redis
```

### Automated Backup (Cron)

Create `/opt/msedb-backup.sh`:

```bash
#!/bin/bash
BACKUP_DIR="/opt/msedb-backups/$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"

# MongoDB
docker exec msedb-mongo mongodump --db=msedb --out=/dump --quiet
docker cp msedb-mongo:/dump/msedb "$BACKUP_DIR/mongodb"

# Redis
docker exec msedb-redis redis-cli BGSAVE
sleep 5
docker cp msedb-redis:/data/dump.rdb "$BACKUP_DIR/redis-dump.rdb"

# Cleanup backups older than 30 days
find /opt/msedb-backups -maxdepth 1 -mtime +30 -exec rm -rf {} +
```

Add to crontab:
```bash
chmod +x /opt/msedb-backup.sh
crontab -e
# Add: 0 3 * * * /opt/msedb-backup.sh
```

### Secret Rotation Schedule

| Secret | Rotation | Impact |
|--------|----------|--------|
| `AZURE_AD_CLIENT_SECRET` | Every 24 months | Must update in Azure portal + `.env` |
| `JWT_SECRET` | Annually | All active sessions invalidated |
| `SESSION_SECRET` | Annually | All active sessions invalidated |
| `ENCRYPTION_KEY` | Rarely | **All stored tokens become unreadable** — requires re-authentication of all mailboxes |

After rotating any secret, restart the backend:
```bash
docker compose restart msedb-backend
```

---

## Troubleshooting

### Container Won't Start

```bash
# Check logs for startup errors
docker compose logs msedb-backend --tail=50

# Common issues:
# - MongoDB connection refused: mongo container not healthy yet (wait for retry)
# - Missing env vars: check .env file exists and is complete
# - Port conflict: another service using 3010/8010/27020/6382
```

### Health Check Returns "degraded"

```bash
curl http://localhost:8010/api/health | jq '.services'

# If mongodb: "disconnected"
docker compose restart msedb-mongo
# Wait 30s for health check, then restart backend
docker compose restart msedb-backend

# If redis: "disconnected"
docker compose restart msedb-redis
docker compose restart msedb-backend
```

### OAuth Login Fails

- Verify `AZURE_AD_CLIENT_ID`, `AZURE_AD_TENANT_ID`, `AZURE_AD_CLIENT_SECRET` in `.env`
- Check redirect URI in Azure portal matches `<API_URL>/auth/callback` exactly
- Ensure admin consent has been granted for all permissions
- Check backend logs: `docker compose logs msedb-backend | grep -i auth`

### Webhooks Not Working

- Verify `GRAPH_WEBHOOK_URL` is set and publicly accessible
- Test: `curl https://msedb-api.yourdomain.com/webhooks/graph` (should return 200)
- Check Cloudflare Tunnel status: `cloudflared tunnel info msedb`
- Graph webhook subscriptions expire every 3 days — renewal job handles this automatically
- Check Admin → System Health for subscription status

### No Email Events Appearing

- If webhooks aren't configured, events arrive via delta sync (every 15 minutes)
- Check that the mailbox is connected (Settings → Mailboxes shows green status)
- Verify token health in Admin → System Health
- Force a delta sync: the system runs automatically every 15 minutes

### Outlook Add-in Not Loading

- Verify `manifest.xml` has the correct Client ID (not `YOUR_AZURE_AD_CLIENT_ID`)
- Check that `ADDIN_URL` in `.env` matches the add-in's served URL
- Add-in requires HTTPS — use `webpack-dev-server` with `--https` for development
- Check browser console for CORS errors (backend must allow the add-in origin)

### Redis Memory Issues

```bash
# Check Redis memory usage
docker exec msedb-redis redis-cli INFO memory | grep used_memory_human

# Redis is configured with noeviction policy (required for BullMQ)
# If approaching 384MB limit, clear completed/failed jobs:
docker exec msedb-redis redis-cli FLUSHDB  # CAUTION: clears all Redis data
```

### MongoDB Disk Usage

```bash
# Check database size
docker exec msedb-mongo mongosh msedb --eval "db.stats()"

# EmailEvents have 90-day TTL — old events are automatically deleted
# Notifications have 30-day TTL
# StagedEmails have 7-day cleanup TTL after expiry
```
