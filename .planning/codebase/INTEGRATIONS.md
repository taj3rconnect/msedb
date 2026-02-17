# External Integrations

**Analysis Date:** 2026-02-16

## APIs & External Services

**Microsoft Graph API:**
- Service: Microsoft 365 cloud API for enterprise integrations
- What it's used for:
  - Read user profile (`User.Read`)
  - Access mailbox messages (`Mail.Read`)
  - Manage mailbox messages (`Mail.ReadWrite`)
  - Send emails (`Mail.Send`)
  - Create and manage mailbox rules (`MailboxSettings.ReadWrite`)
  - Subscribe to mailbox change notifications
- SDK/Client: `@microsoft/microsoft-graph-client` [3.x]
- Base URL: `https://graph.microsoft.com/v1.0/`
- Auth: OAuth 2.0 delegated + optional application permissions
- Key resources accessed:
  - `/me/mailFolders` - Read folder structure
  - `/me/messages` - Message operations
  - `/me/mailboxSettings/messageRules` - Create/update/delete rules
  - Change notification subscriptions

**Azure AD (Microsoft Entra ID):**
- Service: OAuth 2.0 identity and access management
- What it's used for:
  - User authentication and authorization
  - OAuth consent flow for Graph API delegation
- SDK/Client: `@azure/msal-node` [3.x] (Microsoft Authentication Library)
- Auth Flow: OAuth 2.0 authorization code grant (confidential client)
- Endpoints:
  - Authorization: `https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/authorize`
  - Token: `https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token`
- Env vars:
  - `AZURE_AD_TENANT_ID` - Organization tenant ID
  - `AZURE_AD_CLIENT_ID` - App registration ID
  - `AZURE_AD_CLIENT_SECRET` - Client secret
  - `AZURE_AD_REDIRECT_URI` - OAuth callback endpoint (e.g., `http://172.16.219.222:8010/auth/callback`)

## Data Storage

**Databases:**
- **MongoDB 7:**
  - Connection: `mongodb://msedb-mongo:27017/msedb` (internal Docker)
  - Client: Mongoose [7.x+] ODM
  - Collections:
    - `users` - User accounts, roles, preferences
    - `emailevents` - Email actions (delete, move, read, flag)
    - `patterns` - Detected repetitive patterns
    - `rules` - Active mailbox automation rules
    - `staged_emails` - Pending rule execution (grace period)
    - `audit_logs` - Action audit trail
    - `notifications` - User notifications
    - `webhook_subscriptions` - Graph API webhook metadata
  - Indexing: Required on userId, email, messageId, timestamp
  - Backup: Daily via `mongodump` to `msedb-logs` volume

**File Storage:**
- Local filesystem only - Application logs written to `msedb-logs` volume mounted at `/app/logs`
- No external file storage (S3, Azure Blob, etc.)

**Caching:**
- **Redis 7 (in-memory):**
  - Connection: `redis://msedb-redis:6379` (internal Docker)
  - Client: `redis` [4.x] npm package
  - Uses:
    - Session storage
    - Job queue persistence (BullMQ)
    - Rate limiter data
    - Real-time data caching
  - Persistence: RDB snapshots + AOF (append-only file)
  - Memory limit: 256MB with LRU eviction

## Authentication & Identity

**Auth Provider:**
- Azure AD (Microsoft Entra ID) - No custom authentication
- Implementation: MSAL Node confidential client flow
  - Backend initiates OAuth authorization request
  - User consents in Azure AD login screen
  - Backend exchanges authorization code for access token + refresh token
  - Refresh token encrypted and stored in MongoDB via `crypto` AES-256-GCM
  - Access token issued to frontend as JWT after successful callback
  - Frontend sends JWT in Authorization header for API calls

**Token Management:**
- **Refresh Tokens:**
  - Encrypted storage in MongoDB with encryption key + IV + authentication tag
  - Proactive refresh when <10 minutes remaining
  - Auto-renewal via background job before expiry (max 3-day Graph subscription lifetime)
  - Revoked on user logout
- **JWTs:**
  - Signed with `JWT_SECRET` (env var)
  - Frontend stores in secure HTTP-only cookie (or localStorage if required)
  - Verified on every API request via `requireAuth` middleware
  - First-time user to login with `ADMIN_EMAIL` automatically assigned admin role

**Scopes Required:**
- `User.Read` - Read user profile
- `Mail.ReadWrite` - Read and manage emails
- `Mail.Send` - Send emails (future digest feature)
- `MailboxSettings.ReadWrite` - Create/update mailbox rules
- `offline_access` - Request refresh token for background access

## Monitoring & Observability

**Error Tracking:**
- Not detected - Application logs errors to Winston logger
- May implement Sentry or Rollbar in future phases

**Logs:**
- Winston structured logging framework
- Output to:
  - Console (development)
  - File system via `msedb-logs` volume (production)
  - Configurable log level via `LOG_LEVEL` env var
  - Structured JSON format for aggregation

## CI/CD & Deployment

**Hosting:**
- DGX Server at `172.16.219.222` (internal LAN)
- Docker Compose orchestration on single host
- No Kubernetes

**Deployment Method:**
- `docker-compose up --build -d` - Builds and starts all containers
- Images built from local Dockerfiles (no pre-built registry required)
- Multi-stage builds keep runtime images minimal

**Public Exposure:**
- Cloudflare Tunnel (cloudflared) - Exposes internal services to public HTTPS
- Maps internal `http://localhost:3010` → `https://msedb.yourdomain.com`
- Maps internal `http://localhost:8010` → `https://msedb-api.yourdomain.com`
- Tunnel credentials stored in `~/.cloudflared/<TUNNEL_ID>.json`

## Environment Configuration

**Critical Environment Variables:**

```env
# Azure AD (required)
AZURE_AD_TENANT_ID=<your-tenant-id>
AZURE_AD_CLIENT_ID=<app-registration-id>
AZURE_AD_CLIENT_SECRET=<client-secret-value>
AZURE_AD_REDIRECT_URI=http://172.16.219.222:8010/auth/callback

# URLs
APP_URL=http://172.16.219.222:3010
API_URL=http://172.16.219.222:8010
BACKEND_PORT=8010

# Graph Webhook (MUST be public HTTPS)
GRAPH_WEBHOOK_URL=https://msedb-api.yourdomain.com/webhooks/graph

# Database connections (internal Docker names)
MONGODB_URI=mongodb://msedb-mongo:27017/msedb
REDIS_URL=redis://msedb-redis:6379

# Security secrets (generated with: openssl rand -hex 32)
SESSION_SECRET=<32-byte-hex>
JWT_SECRET=<32-byte-hex>
ENCRYPTION_KEY=<32-byte-hex> # WARNING: Changing breaks all stored tokens

# Admin & app settings
ADMIN_EMAIL=taj@yourdomain.com
NODE_ENV=development|production
LOG_LEVEL=info|debug|warn|error
EVENT_RETENTION_DAYS=90
STAGING_GRACE_PERIOD_HOURS=24
```

**Secrets Location:**
- `.env` file in project root (never committed, listed in `.gitignore`)
- Generated with `openssl rand -hex 32` for cryptographic keys
- **CRITICAL:** Client secret from Azure Portal has 24-month expiry - set calendar reminders

## Webhooks & Callbacks

**Incoming Webhooks:**
- **Graph API Change Notifications:**
  - Endpoint: `/webhooks/graph` (public HTTPS via Cloudflare Tunnel)
  - Method: POST
  - Purpose: Receive real-time email events (created, updated, deleted messages)
  - Validation: Microsoft Graph sends `validationToken` query param on subscription - backend responds with token as plain text
  - Payload format:
    ```json
    {
      "value": [{
        "subscriptionId": "...",
        "changeType": "created|updated|deleted",
        "resource": "me/messages/<messageId>",
        "resourceData": {
          "@odata.type": "#Microsoft.Graph.Message",
          "id": "<messageId>"
        },
        "clientState": "<user-secret>"
      }]
    }
    ```
  - Processing: Return 202 Accepted immediately, process async via BullMQ
  - Security: Validate clientState matches user's subscription
  - Subscription lifetime: Max 3 days for mail - renewed every 2 hours via background job

**Outgoing Webhooks:**
- None implemented in MVP

**Subscription Management:**
- Created automatically when user connects mailbox (`/auth/callback` flow)
- Stored in `webhook_subscriptions` MongoDB collection
- Renewed before expiry via `webhookRenewal` BullMQ job
- On failure: Fresh subscription created, old one abandoned
- Expiration: `expirationDateTime` set to 3 days from subscription time

## Background Jobs & Queues

**Job Queue:**
- BullMQ (backed by Redis) manages asynchronous processing
- Optional dashboard at port 9010 (inside msedb-backend container)

**Scheduled Jobs:**
- `webhookRenewal` - Every 2 hours, renew Graph subscriptions expiring within 4 hours
- `deltaSync` - Periodic sync of email changes from Graph API
- `patternAnalysis` - Analyze collected email events for behavioral patterns
- `stagingProcessor` - Process staged rules after grace period (`STAGING_GRACE_PERIOD_HOURS`)
- `tokenRefresh` - Proactive refresh of user refresh tokens before expiry
- `dailyDigest` - Send email digest notifications to users (if enabled)

## Graph API Resource Constraints

**Webhooks:**
- Max subscription lifetime: 3 days for mail
- Renewal recommended: Every 2 hours (catches expirations within 4 hours)
- Max concurrent subscriptions per app: Depends on license
- Notification throttling: Microsoft may batch notifications if volume is high

**Mail Operations:**
- Rate limiting: 4 MB per request
- Batch operations: Up to 100 requests per batch
- Change delta queries: Incremental sync supported via `/me/mailFolders/delta`

---

*Integration audit: 2026-02-16*
