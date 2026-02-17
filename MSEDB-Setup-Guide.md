# MSEDB — Infrastructure Setup & Port Assignments

## Microsoft Email DashBoard — Setup Guide

**Version:** 1.1 (Final)  
**Server:** DGX Server at `http://172.16.219.222/`  
**Date:** February 16, 2026  
**Architecture:** Fully containerized — zero host dependencies

---

## 1. Port Assignments

### Occupied Ports (DO NOT USE)

| Port | Application | Type |
|------|------------|------|
| 3002 | TZMonitor | Frontend |
| 8002 | TZMonitor | Backend |
| 3005 | AiChatDesk | Frontend |
| 8005 | AiChatDesk | Backend |
| 27017 | TZMonitor | MongoDB |

### MSEDB Ports

| Port | Service | Container | Resource Limits |
|------|---------|-----------|-----------------|
| 3010 | React Frontend (nginx) | msedb-frontend | 0.5 CPU, 512MB |
| 8010 | Node.js Backend API + WebSocket | msedb-backend | 2.0 CPU, 2GB |
| 27020 | MongoDB (dedicated) | msedb-mongo | 2.0 CPU, 2GB |
| 6382 | Redis (cache + queues) | msedb-redis | 0.5 CPU, 512MB |
| 9010 | BullMQ Dashboard (optional) | Inside msedb-backend | Shared with backend |

**Total MSEDB resource cap: 5 CPU cores, 5GB RAM**

### Future Reserved Ports

| Port | Planned Use | Phase |
|------|------------|-------|
| 8012 | MSEDB AI Service (Claude API) | Phase 2 |

---

## 2. Azure AD App Registration

### 2.1 Create the App

1. Go to **Azure Portal** → [https://portal.azure.com](https://portal.azure.com)
2. Navigate to **Microsoft Entra ID** → **App registrations** → **New registration**
3. Fill in:
   - **Name:** `MSEDB`
   - **Supported account types:** `Accounts in this organizational directory only` (single tenant)
   - **Redirect URI:** Platform = **Web**, URI = `http://172.16.219.222:8010/auth/callback`
4. Click **Register**
5. **Save these values:**
   - **Application (client) ID** → `AZURE_AD_CLIENT_ID`
   - **Directory (tenant) ID** → `AZURE_AD_TENANT_ID`

### 2.2 Create Client Secret

1. Go to **Certificates & secrets** → **New client secret**
2. Description: `MSEDB Production Secret`
3. Expiry: **24 months** (set calendar reminder to rotate)
4. Click **Add** → **Copy the Value immediately** → `AZURE_AD_CLIENT_SECRET`

### 2.3 Configure API Permissions

Go to **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions**

Add these permissions:

| Permission | Purpose |
|-----------|---------|
| `User.Read` | Read user profile (name, email, photo) |
| `Mail.ReadWrite` | Read, move, delete, update emails |
| `Mail.Send` | Send emails (daily digest, future auto-responses) |
| `MailboxSettings.ReadWrite` | Read/write mailbox settings and rules |
| `offline_access` | Get refresh tokens for background access |

After adding all permissions, click **Grant admin consent for [Your Org]**.

### 2.4 Configure Authentication

1. Go to **Authentication**
2. Under **Web** → Redirect URIs, ensure these are listed:
   - `http://172.16.219.222:8010/auth/callback` (internal)
   - `https://msedb-api.yourdomain.com/auth/callback` (production — add after tunnel setup)
3. Under **Implicit grant and hybrid flows:**
   - ☐ Access tokens — UNCHECKED
   - ☐ ID tokens — UNCHECKED
4. **Allow public client flows:** No
5. Click **Save**

### 2.5 (Optional) Application Permissions for Background Processing

For unattended background access (recommended for webhook reliability):

1. **API permissions** → **Add a permission** → **Microsoft Graph** → **Application permissions**
2. Add: `Mail.ReadWrite`, `User.Read.All`
3. Click **Grant admin consent**

---

## 3. Cloudflare Tunnel Setup

Microsoft Graph webhooks require a **publicly accessible HTTPS endpoint**. The DGX server is internal (`172.16.219.222`), so a tunnel is required.

### 3.1 Install cloudflared

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
```

### 3.2 Authenticate & Create Tunnel

```bash
cloudflared tunnel login
cloudflared tunnel create msedb
```

### 3.3 Configure Tunnel

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /root/.cloudflared/<TUNNEL_ID>.json

ingress:
  # MSEDB Frontend
  - hostname: msedb.yourdomain.com
    service: http://localhost:3010

  # MSEDB API (includes webhook endpoint)
  - hostname: msedb-api.yourdomain.com
    service: http://localhost:8010

  # Catch-all
  - service: http_status:404
```

### 3.4 Create DNS Records

```bash
cloudflared tunnel route dns msedb msedb.yourdomain.com
cloudflared tunnel route dns msedb msedb-api.yourdomain.com
```

### 3.5 Run as System Service

```bash
cloudflared service install
systemctl enable cloudflared
systemctl start cloudflared
```

### 3.6 Verify

```bash
curl https://msedb-api.yourdomain.com/health
```

**Your webhook URL:** `https://msedb-api.yourdomain.com/webhooks/graph`

---

## 4. Microsoft Graph Webhook Details

### 4.1 Subscription (Created Automatically by App)

When a user connects their mailbox, the backend creates:

```json
{
  "changeType": "created,updated,deleted",
  "notificationUrl": "https://msedb-api.yourdomain.com/webhooks/graph",
  "resource": "/me/messages",
  "expirationDateTime": "2026-02-19T00:00:00Z",
  "clientState": "<random-uuid-per-user>"
}
```

### 4.2 Validation Flow

On subscription creation, Microsoft sends a POST with `?validationToken=<token>`. Your endpoint must respond **200 OK** with the token as **plain text** within 10 seconds. This is handled automatically in code.

### 4.3 Notification Payload

```json
{
  "value": [
    {
      "subscriptionId": "...",
      "clientState": "<your-secret>",
      "changeType": "created",
      "resource": "me/messages/<messageId>",
      "resourceData": {
        "@odata.type": "#Microsoft.Graph.Message",
        "id": "<messageId>"
      }
    }
  ]
}
```

Your endpoint: validate clientState → return **202 Accepted** immediately → process async via BullMQ.

### 4.4 Renewal

- Max subscription lifetime: **3 days** for mail
- Background job renews every 2 hours (catches anything expiring within 4 hours)
- On failure: creates a fresh subscription

---

## 5. Environment Configuration

### 5.1 Generate Secrets

Run on DGX:

```bash
echo "SESSION_SECRET=$(openssl rand -hex 32)"
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
```

### 5.2 Complete .env File

```env
# ============================================
# MSEDB (Microsoft Email DashBoard) CONFIG
# DGX Server: http://172.16.219.222
# ============================================

# --- Azure AD ---
AZURE_AD_TENANT_ID=<from Azure Portal step 2.1>
AZURE_AD_CLIENT_ID=<from Azure Portal step 2.1>
AZURE_AD_CLIENT_SECRET=<from Azure Portal step 2.2>
AZURE_AD_REDIRECT_URI=http://172.16.219.222:8010/auth/callback

# --- URLs ---
APP_URL=http://172.16.219.222:3010
API_URL=http://172.16.219.222:8010
BACKEND_PORT=8010

# --- Graph Webhook (public HTTPS via Cloudflare Tunnel) ---
GRAPH_WEBHOOK_URL=https://msedb-api.yourdomain.com/webhooks/graph

# --- MongoDB (internal Docker address — NOT 27020) ---
MONGODB_URI=mongodb://msedb-mongo:27017/msedb

# --- Redis (internal Docker address — NOT 6382) ---
REDIS_URL=redis://msedb-redis:6379

# --- Security (generate with openssl rand -hex 32) ---
SESSION_SECRET=<generated>
JWT_SECRET=<generated>
ENCRYPTION_KEY=<generated>

# --- Admin ---
ADMIN_EMAIL=taj@yourdomain.com

# --- App Settings ---
NODE_ENV=development
LOG_LEVEL=info
EVENT_RETENTION_DAYS=90
STAGING_GRACE_PERIOD_HOURS=24
```

**CRITICAL:** MongoDB and Redis URIs use **internal Docker service names** and **internal ports** (27017, 6379). The host-mapped ports (27020, 6382) are only for external debugging. Containers talk to each other on the `msedb-network` bridge using service names.

---

## 6. Network Access Summary

### Internal (Your LAN)

| Service | URL |
|---------|-----|
| Frontend | `http://172.16.219.222:3010` |
| Backend API | `http://172.16.219.222:8010` |
| Health Check | `http://172.16.219.222:8010/health` |
| MongoDB (debug only) | `172.16.219.222:27020` |
| Redis (debug only) | `172.16.219.222:6382` |

### External (Via Cloudflare Tunnel)

| Service | URL |
|---------|-----|
| Frontend | `https://msedb.yourdomain.com` |
| Backend API | `https://msedb-api.yourdomain.com` |
| Webhook | `https://msedb-api.yourdomain.com/webhooks/graph` |

### Firewall Rules

| Port | Direction | Purpose |
|------|-----------|---------|
| 3010 | Inbound (LAN) | Frontend |
| 8010 | Inbound (LAN) | API + WebSocket |
| 27020 | Inbound (LAN only) | MongoDB debug |
| 6382 | Inbound (LAN only) | Redis debug |
| 443 | Outbound | Azure AD + Graph API |
| 7844 | Outbound | Cloudflare Tunnel |

---

## 7. Docker Volumes & Backups

### Volumes

| Volume | Container | Mount | Purpose |
|--------|-----------|-------|---------|
| `msedb-mongo-data` | msedb-mongo | `/data/db` | Database files |
| `msedb-redis-data` | msedb-redis | `/data` | Queue persistence |
| `msedb-logs` | msedb-backend | `/app/logs` | Application logs |

### Backup Script

Create `/opt/msedb-backup.sh`:

```bash
#!/bin/bash
BACKUP_DIR="/backups/msedb/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

# MongoDB backup
docker exec msedb-mongo mongodump --db=msedb --out=/tmp/backup
docker cp msedb-mongo:/tmp/backup "$BACKUP_DIR/mongo"
docker exec msedb-mongo rm -rf /tmp/backup

# Redis backup
docker exec msedb-redis redis-cli BGSAVE
sleep 2
docker cp msedb-redis:/data/dump.rdb "$BACKUP_DIR/redis-dump.rdb"

# Keep last 30 days of backups
find /backups/msedb -maxdepth 1 -mtime +30 -exec rm -rf {} \;

echo "Backup completed: $BACKUP_DIR"
```

Add to crontab (`crontab -e`):

```
0 3 * * * /opt/msedb-backup.sh >> /var/log/msedb-backup.log 2>&1
```

---

## 8. Pre-Flight Checklist

### Azure Portal

- [ ] App Registration "MSEDB" created
- [ ] **Tenant ID** copied to `.env`
- [ ] **Client ID** copied to `.env`
- [ ] **Client Secret** created and Value copied to `.env`
- [ ] Delegated permissions added: `User.Read`, `Mail.ReadWrite`, `Mail.Send`, `MailboxSettings.ReadWrite`, `offline_access`
- [ ] Admin consent granted for organization
- [ ] Redirect URI set: `http://172.16.219.222:8010/auth/callback`
- [ ] (After tunnel) Production redirect URI added

### DGX Server

- [ ] Docker and Docker Compose installed and working
- [ ] Ports 3010, 8010, 27020, 6382 are free:
  ```bash
  ss -tlnp | grep -E '3010|8010|27020|6382'
  ```
- [ ] Secrets generated and added to `.env`:
  ```bash
  openssl rand -hex 32  # Run 3 times for SESSION_SECRET, JWT_SECRET, ENCRYPTION_KEY
  ```
- [ ] `ADMIN_EMAIL` set in `.env`
- [ ] `.env` file complete with all values

### Cloudflare Tunnel

- [ ] `cloudflared` installed
- [ ] Tunnel created and configured
- [ ] DNS records created for both subdomains
- [ ] Tunnel running as systemd service
- [ ] `GRAPH_WEBHOOK_URL` updated in `.env`
- [ ] Production redirect URI added to Azure App Registration
- [ ] Verify: `curl https://msedb-api.yourdomain.com` responds

### Launch

- [ ] `docker-compose up --build -d`
- [ ] `http://172.16.219.222:3010` loads frontend
- [ ] `http://172.16.219.222:8010/health` returns OK
- [ ] "Sign in with Microsoft" redirects to Azure AD
- [ ] OAuth callback completes, JWT returned
- [ ] Admin role assigned on first login
- [ ] Webhook subscription created (check backend logs)

---

## 9. Common Commands

```bash
# Start all containers
docker-compose up --build -d

# View logs
docker-compose logs -f                  # All containers
docker-compose logs -f msedb-backend    # Backend only

# Restart a single service
docker-compose restart msedb-backend

# Stop everything
docker-compose down

# Stop and remove ALL data (volumes)
docker-compose down -v

# Check container health
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Shell into a container
docker exec -it msedb-backend sh
docker exec -it msedb-mongo mongosh msedb
docker exec -it msedb-redis redis-cli

# Check port usage on host
ss -tlnp | grep -E '3010|8010|27020|6382'

# View resource usage
docker stats --no-stream
```

---

## 10. Maintenance Schedule

| Item | Frequency | Action |
|------|-----------|--------|
| Azure AD Client Secret | Every 24 months | Rotate in Azure Portal → update `.env` → restart backend |
| JWT_SECRET | Annually | Update `.env` → restart (invalidates active sessions) |
| ENCRYPTION_KEY | Rarely | **DANGER:** Changing breaks all stored tokens. All users must re-authenticate. |
| MongoDB Backup | Daily (auto) | Runs via cron at 3 AM |
| Cloudflare Tunnel Cert | Auto-renewed | Verify tunnel health periodically |
| Docker Images | Monthly | `docker-compose pull` for mongo/redis, rebuild app images |
| Log Rotation | Weekly | Check `msedb-logs` volume size, prune if needed |
| Graph Permissions | As needed | Add new permissions in Azure Portal for new features |

---

## 11. Troubleshooting

| Issue | Check |
|-------|-------|
| Frontend not loading | `docker ps` — is msedb-frontend running? Check nginx logs. |
| API returning 502 | Backend container may have crashed — `docker logs msedb-backend` |
| OAuth callback fails | Verify redirect URI in Azure matches `.env` exactly |
| Webhooks not firing | Check Cloudflare Tunnel status, verify GRAPH_WEBHOOK_URL is HTTPS |
| Token refresh failing | Check ENCRYPTION_KEY hasn't changed, verify client secret not expired |
| MongoDB connection refused | `docker exec msedb-mongo mongosh --eval "db.adminCommand('ping')"` |
| Redis connection refused | `docker exec msedb-redis redis-cli ping` |
| High memory usage | `docker stats` — check if containers hitting limits |
| Jobs not running | Shell into backend, check BullMQ dashboard at :9010 |
