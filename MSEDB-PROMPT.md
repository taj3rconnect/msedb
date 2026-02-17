# MSEDB — Claude Code Implementation Prompt

## Microsoft Email DashBoard — Implementation Guide

Build **MSEDB (Microsoft Email DashBoard)**, a fully containerized, self-hosted email management portal that connects to Microsoft 365 via Microsoft Graph API, observes how users handle their email (delete, move, archive, ignore), learns behavioral patterns, and automates repetitive email management tasks with user approval.

This is a **multi-tenant, multi-user** application. The admin manages users from the company who each connect their own O365 mailbox. The platform is designed for future expansion (auto-responses, AI features).

**Deployment target:** DGX Server at `http://172.16.219.222/`  
**Existing services on this server (DO NOT conflict):**
- TZMonitor: ports 3002 (frontend), 8002 (backend)
- AiChatDesk: ports 3005 (frontend), 8005 (backend)
- TZMonitor MongoDB: port 27017

**The ENTIRE application must run as a Docker Compose stack with ZERO software installed on the host.**

---

## Technology Stack (MANDATORY — do not deviate)

- **Frontend**: React 18 + Vite + Tailwind CSS + shadcn/ui
- **Backend**: Node.js 20 + Express.js
- **Database**: MongoDB 7 — dedicated container (NOT shared with other apps)
- **Cache/Queue**: Redis 7 + BullMQ — dedicated container
- **Auth**: Azure AD OAuth 2.0 via `@azure/msal-node`
- **Graph SDK**: `@microsoft/microsoft-graph-client`
- **Real-time**: Socket.IO
- **State Management**: Zustand + TanStack Query (React Query)
- **Logging**: Winston
- **Containerization**: Docker + Docker Compose with multi-stage builds

---

## STEP 1: Docker Compose & Project Scaffolding

### docker-compose.yml

Create the full Docker Compose stack with these exact specifications:

```yaml
# docker-compose.yml
version: '3.8'

services:
  msedb-frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: msedb-frontend
    ports:
      - "3010:80"
    depends_on:
      msedb-backend:
        condition: service_healthy
    networks:
      - msedb-network
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:80"]
      interval: 30s
      timeout: 5s
      retries: 3

  msedb-backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: msedb-backend
    ports:
      - "8010:8010"
    env_file:
      - .env
    depends_on:
      msedb-mongo:
        condition: service_healthy
      msedb-redis:
        condition: service_healthy
    networks:
      - msedb-network
    volumes:
      - msedb-logs:/app/logs
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 2G
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8010/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  msedb-mongo:
    image: mongo:7
    container_name: msedb-mongo
    ports:
      - "27020:27017"
    volumes:
      - msedb-mongo-data:/data/db
    networks:
      - msedb-network
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 2G
    command: ["mongod", "--bind_ip_all"]
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 5

  msedb-redis:
    image: redis:7-alpine
    container_name: msedb-redis
    ports:
      - "6382:6379"
    volumes:
      - msedb-redis-data:/data
    networks:
      - msedb-network
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
    command: ["redis-server", "--appendonly", "yes", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

networks:
  msedb-network:
    driver: bridge
    name: msedb-network

volumes:
  msedb-mongo-data:
    name: msedb-mongo-data
  msedb-redis-data:
    name: msedb-redis-data
  msedb-logs:
    name: msedb-logs
```

### Backend Dockerfile (multi-stage, non-root)

```dockerfile
# backend/Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

FROM node:20-alpine
RUN apk add --no-cache curl tini
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
COPY --from=builder --chown=appuser:appgroup /app .
USER appuser
EXPOSE 8010
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
```

### Frontend Dockerfile (multi-stage build → nginx)

```dockerfile
# frontend/Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
RUN apk add --no-cache curl
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### Frontend nginx.conf

```nginx
# frontend/nginx.conf
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://msedb-backend:8010/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }

    location /auth/ {
        proxy_pass http://msedb-backend:8010/auth/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /webhooks/ {
        proxy_pass http://msedb-backend:8010/webhooks/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /socket.io/ {
        proxy_pass http://msedb-backend:8010/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### .dockerignore (create in both backend/ and frontend/)

```
node_modules
npm-debug.log
.env
.git
.gitignore
README.md
docker-compose*.yml
Dockerfile
```

### .env.example

```env
# ============================================
# MSEDB (Microsoft Email DashBoard) CONFIG
# DGX Server: http://172.16.219.222
# ============================================

# --- Azure AD ---
AZURE_AD_TENANT_ID=your-tenant-id
AZURE_AD_CLIENT_ID=your-client-id
AZURE_AD_CLIENT_SECRET=your-client-secret
AZURE_AD_REDIRECT_URI=http://172.16.219.222:8010/auth/callback

# --- URLs ---
APP_URL=http://172.16.219.222:3010
API_URL=http://172.16.219.222:8010
BACKEND_PORT=8010

# --- Graph Webhook (MUST be public HTTPS) ---
GRAPH_WEBHOOK_URL=https://msedb-api.yourdomain.com/webhooks/graph

# --- MongoDB (container internal address) ---
MONGODB_URI=mongodb://msedb-mongo:27017/msedb

# --- Redis (container internal address) ---
REDIS_URL=redis://msedb-redis:6379

# --- Security ---
SESSION_SECRET=generate-with-openssl-rand-hex-32
JWT_SECRET=generate-with-openssl-rand-hex-32
ENCRYPTION_KEY=generate-with-openssl-rand-hex-32

# --- Admin ---
ADMIN_EMAIL=taj@yourdomain.com

# --- App Settings ---
NODE_ENV=development
LOG_LEVEL=info
EVENT_RETENTION_DAYS=90
STAGING_GRACE_PERIOD_HOURS=24
```

**IMPORTANT:** Inside docker-compose, containers communicate using internal service names and internal ports. The `.env` uses `msedb-mongo:27017` (not `27020`) and `msedb-redis:6379` (not `6382`) because those are the internal container ports. The host-mapped ports (27020, 6382) are only for external debugging access.

### Full Project Structure

```
msedb/
├── docker-compose.yml
├── docker-compose.dev.yml          # Dev overrides (volume mounts for hot reload)
├── .env.example
├── .env                            # Actual config (gitignored)
├── .gitignore
├── README.md
│
├── backend/
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── package.json
│   ├── package-lock.json
│   └── src/
│       ├── server.js                  # Express app entry + Socket.IO setup
│       ├── config/
│       │   ├── index.js               # Load all env vars with defaults
│       │   ├── database.js            # MongoDB connection with retry
│       │   ├── redis.js               # Redis connection
│       │   └── socket.js              # Socket.IO initialization
│       │
│       ├── auth/
│       │   ├── azureAd.js             # MSAL ConfidentialClientApplication
│       │   ├── tokenManager.js        # Encrypted token storage/refresh
│       │   ├── middleware.js           # requireAuth, requireAdmin
│       │   └── routes.js              # /auth/* endpoints
│       │
│       ├── models/
│       │   ├── User.js
│       │   ├── EmailEvent.js
│       │   ├── Pattern.js
│       │   ├── Rule.js
│       │   ├── StagedEmail.js
│       │   ├── AuditLog.js
│       │   ├── Notification.js
│       │   └── WebhookSubscription.js
│       │
│       ├── services/
│       │   ├── graph/
│       │   │   ├── graphClient.js
│       │   │   ├── mailService.js
│       │   │   ├── subscriptionService.js
│       │   │   └── deltaService.js
│       │   ├── collector/
│       │   │   ├── eventCollector.js
│       │   │   └── metadataExtractor.js
│       │   ├── analyzer/
│       │   │   ├── patternDetector.js
│       │   │   ├── confidenceScorer.js
│       │   │   └── subjectNormalizer.js
│       │   ├── automation/
│       │   │   ├── ruleEngine.js
│       │   │   ├── stagingManager.js
│       │   │   └── undoService.js
│       │   ├── notification/
│       │   │   ├── notificationService.js
│       │   │   └── digestBuilder.js
│       │   └── admin/
│       │       ├── userManagement.js
│       │       └── orgRules.js
│       │
│       ├── jobs/
│       │   ├── queue.js
│       │   ├── webhookRenewal.js
│       │   ├── deltaSync.js
│       │   ├── patternAnalysis.js
│       │   ├── stagingProcessor.js
│       │   ├── tokenRefresh.js
│       │   └── dailyDigest.js
│       │
│       ├── routes/
│       │   ├── index.js
│       │   ├── webhookRoutes.js
│       │   ├── dashboardRoutes.js
│       │   ├── patternRoutes.js
│       │   ├── ruleRoutes.js
│       │   ├── stagingRoutes.js
│       │   ├── auditRoutes.js
│       │   ├── settingsRoutes.js
│       │   └── adminRoutes.js
│       │
│       ├── middleware/
│       │   ├── auth.js
│       │   ├── rbac.js
│       │   ├── rateLimiter.js
│       │   └── errorHandler.js
│       │
│       └── utils/
│           ├── logger.js              # Winston structured logging
│           ├── graphHelpers.js
│           └── dateUtils.js
│
├── frontend/
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── nginx.conf
│   ├── package.json
│   ├── package-lock.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── api/
│       │   └── client.js              # Axios with JWT interceptor
│       ├── auth/
│       │   ├── AuthProvider.jsx
│       │   ├── ProtectedRoute.jsx
│       │   └── LoginPage.jsx
│       ├── layouts/
│       │   ├── MainLayout.jsx
│       │   └── Sidebar.jsx
│       ├── pages/
│       │   ├── Dashboard.jsx
│       │   ├── EmailActivity.jsx
│       │   ├── Patterns.jsx
│       │   ├── Rules.jsx
│       │   ├── Staging.jsx
│       │   ├── AuditLog.jsx
│       │   ├── Settings.jsx
│       │   └── admin/
│       │       ├── UserManagement.jsx
│       │       └── OrgSettings.jsx
│       ├── components/
│       │   ├── ui/                     # shadcn/ui components
│       │   ├── PatternCard.jsx
│       │   ├── RuleRow.jsx
│       │   ├── StagingItem.jsx
│       │   ├── StatsCard.jsx
│       │   ├── ActivityFeed.jsx
│       │   ├── ConfidenceBadge.jsx
│       │   ├── KillSwitch.jsx
│       │   ├── EmptyState.jsx
│       │   ├── ConfirmModal.jsx
│       │   └── DataTable.jsx
│       ├── hooks/
│       │   ├── useAuth.js
│       │   ├── usePatterns.js
│       │   ├── useRules.js
│       │   └── useWebSocket.js
│       ├── stores/
│       │   ├── authStore.js            # Zustand auth state
│       │   └── notificationStore.js    # Zustand notification state
│       └── utils/
│           ├── constants.js
│           └── formatters.js
│
└── scripts/
    ├── seed.js                         # Dev seed data
    ├── migrate.js                      # DB migrations
    └── backup.sh                       # MongoDB backup script
```

---

## STEP 2: Backend — Authentication Module

Implement Azure AD OAuth 2.0 authentication.

**File: `src/auth/azureAd.js`**
- Initialize MSAL `ConfidentialClientApplication`
- Configure with tenant ID, client ID, client secret from env
- Scopes: `Mail.ReadWrite`, `Mail.Send`, `MailboxSettings.ReadWrite`, `User.Read`, `offline_access`

**File: `src/auth/tokenManager.js`**
- Store encrypted refresh tokens in MongoDB using `crypto` module (AES-256-GCM)
- `getAccessToken(userId)` — returns valid access token, auto-refreshes if expired
- `storeTokens(userId, tokenResponse)` — encrypt and store
- `revokeTokens(userId)` — clear stored tokens
- Proactive refresh: refresh when less than 10 minutes remaining

**File: `src/auth/routes.js`**
```
GET  /auth/login     → Generate Azure AD auth URL, redirect user
GET  /auth/callback  → Exchange code for tokens, create/update user, issue JWT
POST /auth/logout    → Clear session
GET  /auth/me        → Return current user from JWT
```

**File: `src/auth/middleware.js`**
- `requireAuth` — Verify JWT from Authorization header or cookie, attach `req.user`
- `requireAdmin` — Check `req.user.role === 'admin'`

**First user to login with ADMIN_EMAIL env var gets admin role automatically.**

---

## STEP 3: Backend — Database Models

Create Mongoose models with indexes. All models must include `timestamps: true`.

**User Model (`src/models/User.js`)**
```javascript
{
  email: { type: String, unique: true, required: true },
  displayName: String,
  microsoftId: { type: String, unique: true },
  role: { type: String, enum: ['admin', 'user'], default: 'user' },
  status: { type: String, enum: ['active', 'invited', 'deactivated'], default: 'active' },
  encryptedRefreshToken: String,
  tokenIV: String,
  tokenTag: String,
  graphConnected: { type: Boolean, default: false },
  preferences: {
    aggressiveness: { type: String, enum: ['conservative', 'balanced', 'aggressive'], default: 'balanced' },
    notifications: { type: String, enum: ['all', 'digest', 'none'], default: 'digest' },
    timezone: { type: String, default: 'America/New_York' },
    workingHoursStart: { type: Number, default: 9 },
    workingHoursEnd: { type: Number, default: 17 },
    automationPaused: { type: Boolean, default: false }
  },
  whitelist: [{ type: String }],
  stats: {
    totalEventsCollected: { type: Number, default: 0 },
    totalActionsAutomated: { type: Number, default: 0 },
    lastSyncAt: Date
  },
  invitedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}
// Indexes: email (unique), microsoftId (unique), status
```

**EmailEvent Model (`src/models/EmailEvent.js`)**
```javascript
{
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  messageId: { type: String, required: true },
  internetMessageId: String,
  eventType: { type: String, enum: ['arrived', 'deleted', 'moved', 'read', 'flagged', 'categorized'], required: true },
  timestamp: { type: Date, default: Date.now },
  sender: {
    name: String,
    email: String,
    domain: String
  },
  subject: String,
  subjectNormalized: String,
  receivedAt: Date,
  timeToAction: Number,
  fromFolder: String,
  toFolder: String,
  importance: { type: String, enum: ['low', 'normal', 'high'] },
  hasAttachments: Boolean,
  conversationId: String,
  categories: [String],
  isRead: Boolean,
  metadata: {
    hasListUnsubscribe: Boolean,
    isNewsletter: Boolean,
    isAutomated: Boolean,
    automatedByRule: { type: Schema.Types.ObjectId, ref: 'Rule' }
  }
}
// Compound indexes: { userId: 1, sender.domain: 1, timestamp: -1 }
//                    { userId: 1, eventType: 1, timestamp: -1 }
//                    { userId: 1, messageId: 1, eventType: 1 } (dedup)
// TTL index on timestamp: expire after 90 days
```

**Pattern Model (`src/models/Pattern.js`)**
```javascript
{
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  patternType: { type: String, enum: ['sender', 'subject', 'time', 'folder', 'composite'] },
  criteria: {
    senderDomain: String,
    senderEmail: String,
    subjectPattern: String,
    subjectContains: [String],
    importanceLevel: String,
    hasAttachments: Boolean,
    timeCondition: {
      dayOfWeek: [Number],
      hourRange: { start: Number, end: Number }
    }
  },
  suggestedAction: { type: String, enum: ['delete', 'move', 'archive', 'read', 'categorize'] },
  suggestedFolder: String,
  confidence: { type: Number, min: 0, max: 100 },
  sampleSize: Number,
  actionDistribution: {
    deleted: { type: Number, default: 0 },
    moved: { type: Number, default: 0 },
    read_no_action: { type: Number, default: 0 },
    archived: { type: Number, default: 0 },
    flagged: { type: Number, default: 0 }
  },
  sampleMessageIds: [String],
  firstSeen: Date,
  lastSeen: Date,
  status: { type: String, enum: ['suggested', 'approved', 'rejected', 'expired'], default: 'suggested' },
  rejectedUntil: Date
}
// Indexes: { userId: 1, status: 1 }, { userId: 1, criteria.senderDomain: 1 }
```

**Rule Model (`src/models/Rule.js`)**
```javascript
{
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  description: String,
  sourcePatternId: { type: Schema.Types.ObjectId, ref: 'Pattern' },
  isManual: { type: Boolean, default: false },
  priority: { type: Number, default: 100 },
  conditions: {
    senderDomain: String,
    senderEmail: String,
    subjectContains: [String],
    subjectPattern: String,
    importance: String,
    hasAttachments: Boolean,
    fromFolder: String
  },
  action: {
    type: { type: String, enum: ['delete', 'move', 'archive', 'read', 'categorize'], required: true },
    targetFolder: String,
    category: String
  },
  safetyConfig: {
    useGracePeriod: { type: Boolean, default: true },
    gracePeriodHours: { type: Number, default: 24 },
    notifyOnExecution: { type: Boolean, default: false }
  },
  status: { type: String, enum: ['active', 'paused', 'retired'], default: 'active' },
  stats: {
    totalExecutions: { type: Number, default: 0 },
    successfulExecutions: { type: Number, default: 0 },
    failedExecutions: { type: Number, default: 0 },
    undoneByUser: { type: Number, default: 0 },
    lastExecutedAt: Date
  }
}
// Index: { userId: 1, status: 1, priority: 1 }
```

**StagedEmail Model (`src/models/StagedEmail.js`)**
```javascript
{
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  ruleId: { type: Schema.Types.ObjectId, ref: 'Rule', required: true },
  messageId: String,
  sender: { name: String, email: String },
  subject: String,
  receivedAt: Date,
  action: { type: String, targetFolder: String },
  executeAt: { type: Date, index: true },
  status: { type: String, enum: ['pending', 'executed', 'rescued'], default: 'pending' },
  executedAt: Date
}
```

**AuditLog Model (`src/models/AuditLog.js`)**
```javascript
{
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  ruleId: { type: Schema.Types.ObjectId, ref: 'Rule' },
  action: { type: String, enum: ['deleted', 'moved', 'archived', 'read', 'categorized', 'undone', 'rescued'] },
  messageId: String,
  sender: { name: String, email: String },
  subject: String,
  fromFolder: String,
  toFolder: String,
  undoAvailableUntil: Date,
  undoneAt: Date,
  isUndone: { type: Boolean, default: false }
}
// Indexes: { userId: 1, createdAt: -1 }, { userId: 1, ruleId: 1 }
```

**WebhookSubscription Model (`src/models/WebhookSubscription.js`)**
```javascript
{
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  subscriptionId: { type: String, required: true },
  resource: String,
  changeType: String,
  expirationDateTime: { type: Date, index: true },
  clientState: String,
  status: { type: String, enum: ['active', 'expired', 'failed'], default: 'active' }
}
```

**Notification Model (`src/models/Notification.js`)**
```javascript
{
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['pattern_new', 'rule_failed', 'webhook_failed', 'token_expiring', 'system'] },
  title: String,
  message: String,
  link: String,
  isRead: { type: Boolean, default: false }
}
// Index: { userId: 1, isRead: 1, createdAt: -1 }
```

---

## STEP 4: Backend — Microsoft Graph API Services

**File: `src/services/graph/graphClient.js`**
- Factory: creates authenticated Graph client per userId using tokenManager
- Handles 401 by refreshing token and retrying once
- Always use `$select` to request only needed fields

**File: `src/services/graph/mailService.js`**
```javascript
async getMailFolders(userId)           // GET /me/mailFolders
async getMessages(userId, folderId, opts)  // GET /me/mailFolders/{id}/messages (paginated, $select)
async getMessage(userId, messageId)     // GET /me/messages/{id}
async moveMessage(userId, messageId, folderId)  // POST /me/messages/{id}/move
async deleteMessage(userId, messageId)  // DELETE /me/messages/{id} (soft delete)
async updateMessage(userId, messageId, updates)  // PATCH /me/messages/{id}
async createFolder(userId, displayName) // POST /me/mailFolders
async batchRequest(userId, requests)    // POST /$batch (up to 20)
```

**File: `src/services/graph/subscriptionService.js`**
```javascript
async createSubscription(userId)        // POST /subscriptions
// resource: /me/messages, changeType: created,updated,deleted
// expirationDateTime: now + 2 days, clientState: random UUID
// notificationUrl: GRAPH_WEBHOOK_URL from env

async renewSubscription(subscriptionId) // PATCH /subscriptions/{id}
async deleteSubscription(subscriptionId) // DELETE /subscriptions/{id}
async renewAllExpiring()                // Find expiring within 4hrs, renew
```

**File: `src/services/graph/deltaService.js`**
```javascript
async runDeltaSync(userId)
// GET /me/mailFolders/{id}/messages/delta
// Store deltaLink per user per folder in Redis
// First run: initial sync. Subsequent: only changes
// Process each change through eventCollector
// Handle @odata.deltaLink and @odata.nextLink pagination
```

---

## STEP 5: Backend — Event Collection & Metadata Extraction

**File: `src/services/collector/eventCollector.js`**
```javascript
async processWebhookNotification(notification)
// 1. Validate clientState
// 2. Get changed message via Graph API
// 3. Determine event type
// 4. For updates: detect what changed (folder = moved, isRead = read)
// 5. Extract metadata
// 6. Store as EmailEvent (dedup by messageId + eventType)
// 7. Check against active rules for immediate automation
// 8. Emit Socket.IO event for real-time dashboard

async processMessage(userId, message, eventType, previousState)
// Core processing used by both webhooks and delta sync
```

**File: `src/services/collector/metadataExtractor.js`**
```javascript
function extractMetadata(graphMessage)
// List-Unsubscribe header → isNewsletter: true
// X-Auto-Response-Suppress → isAutomated: true
// Precedence: bulk → isNewsletter: true
// Extract sender domain

function normalizeSubject(subject)
// Replace numbers with {number}
// Replace dates with {date}
// Replace UUIDs with {id}
// Replace emails with {email}
// Lowercase, trim Re:/Fwd:/FW: prefixes
```

---

## STEP 6: Backend — Pattern Analysis Engine

**File: `src/services/analyzer/patternDetector.js`**

Core intelligence. Runs as daily scheduled job + on-demand.

```javascript
async analyzeUserPatterns(userId)
// 1. Query EmailEvents from last 30 days
// 2. Run sender analysis
// 3. Run subject pattern analysis
// 4. Run folder routing analysis
// 5. Run composite analysis
// 6. Score each pattern via confidenceScorer
// 7. Create/update Pattern documents
// 8. Notify user of new high-confidence patterns

async analyzeSenderPatterns(userId, events)
// Group by sender domain → for each with 10+ events:
// Calculate action distribution → if 85%+ same action → pattern

async analyzeSubjectPatterns(userId, events)
// Group by normalizedSubject → for each with 10+ events:
// Calculate action distribution → if 85%+ same action → pattern

async analyzeFolderRoutingPatterns(userId, events)
// Filter moved events → group by sender + target folder
// Consistent routing → pattern

async analyzeCompositePatterns(userId, events)
// Cross-tabulate: sender × day_of_week × action
// Example: weekend LinkedIn emails always deleted
```

**File: `src/services/analyzer/confidenceScorer.js`**
```javascript
function calculateConfidence(actionDistribution, sampleSize, timeSpan)
// Base: (dominant_action / total) * 100
// +5 if sampleSize > 50, +3 if > 20, -10 if < 15
// +5 if timeSpan > 14 days
// -5 if recent events show behavior change
// Cap 0-100
```

**File: `src/services/analyzer/subjectNormalizer.js`**
```javascript
function normalize(subject)   // Normalization rules
function similarity(a, b)     // Levenshtein or Jaccard similarity (0-1)
```

---

## STEP 7: Backend — Automation Rule Engine

**File: `src/services/automation/ruleEngine.js`**
```javascript
async evaluateRules(userId, message)
// 1. Check automationPaused → skip
// 2. Check whitelist → skip
// 3. Load active rules by priority
// 4. First matching rule wins
// 5. Grace period → stage, else → execute immediately
// 6. Log to audit, update stats

function matchesConditions(rule, message)
// All specified conditions must match (AND logic)
// senderDomain: exact, senderEmail: exact
// subjectContains: all keywords present (case-insensitive)
// subjectPattern: regex match, importance: exact
// hasAttachments: boolean, fromFolder: exact

async executeAction(userId, messageId, action, ruleId)
// Graph API action → AuditLog entry (undoAvailableUntil = now + 48h)
```

**File: `src/services/automation/stagingManager.js`**
```javascript
async stageEmail(userId, messageId, message, rule)
// Ensure "MSEDB Staging" folder exists → move there → create StagedEmail

async processExpiredStaged()
// Find pending with executeAt <= now → execute → update status

async rescueEmail(userId, stagedEmailId)
// Move back to Inbox → status = rescued

async executeImmediately(userId, stagedEmailId)
// Execute now → status = executed
```

**File: `src/services/automation/undoService.js`**
```javascript
async undoAction(userId, auditLogId)
// Check undoAvailableUntil > now
// Reverse: deleted → move back, moved → move back, read → unread
// Mark AuditLog undone, increment rule.stats.undoneByUser
```

---

## STEP 8: Backend — Background Jobs (BullMQ)

**File: `src/jobs/queue.js`**
- Create BullMQ queues + workers for each job
- Error handling and retry logic (3 retries, exponential backoff)

**Schedules:**
```javascript
'webhook-renewal'   → cron: '0 */2 * * *'       // Every 2 hours
'delta-sync'        → cron: '*/15 * * * *'       // Every 15 minutes
'pattern-analysis'  → cron: '0 2 * * *'          // Daily 2 AM
'staging-processor' → cron: '*/30 * * * *'       // Every 30 minutes
'token-refresh'     → cron: '*/45 * * * *'       // Every 45 minutes
'daily-digest'      → cron: '0 8 * * *'          // Daily 8 AM
```

---

## STEP 9: Backend — Webhook Handler

**File: `src/routes/webhookRoutes.js`**

```
POST /webhooks/graph
```

1. **Validation request**: Graph sends `?validationToken=<token>` on subscription creation → respond 200 with token as plain text within 10 seconds
2. **Change notifications**: Validate clientState → return 202 immediately → queue async processing
3. **Lifecycle notifications**: Handle reauthorizationRequired → renew subscription

**The webhook endpoint MUST respond within 3 seconds. All processing is async via BullMQ.**

---

## STEP 10: Backend — REST API Routes

Implement all endpoints from the PRD (Section 7.3). Every route:
- Uses `requireAuth` middleware (admin routes add `requireAdmin`)
- Returns `{ success: true, data: {...} }` or `{ success: false, error: "message" }`
- Supports pagination: `?page=1&limit=20` → `{ data: [...], pagination: { page, limit, total, totalPages } }`
- Validates input with express-validator or Joi
- Has proper error handling

---

## STEP 11: Backend — Socket.IO Real-Time Updates

**File: `src/config/socket.js`**
- Init Socket.IO on Express server
- Authenticate connections via JWT
- Per-user rooms: `user:{userId}`
- Events: `email:event`, `automation:executed`, `staging:added`, `pattern:new`, `notification:new`

---

## STEP 12: Backend — Health Endpoint

```
GET /health
```
Returns: MongoDB connection status, Redis connection status, uptime, active webhook count.

---

## STEP 13: Frontend — Setup

- React 18 + Vite
- Tailwind CSS + shadcn/ui (`npx shadcn-ui@latest init`)
- React Router v6
- Axios (create `api/client.js` with JWT interceptor)
- Socket.IO client
- Zustand for auth/notification state
- TanStack Query for server state
- Recharts for charts
- @dnd-kit/sortable for drag-and-drop rule reordering
- sonner for toast notifications
- date-fns for date formatting

**Vite config must proxy `/api`, `/auth`, `/webhooks`, `/socket.io` to backend at `http://msedb-backend:8010` during development.**

---

## STEP 14: Frontend — Auth Flow

1. Visit app → check JWT in localStorage
2. No JWT → LoginPage with "Sign in with Microsoft" button
3. Button navigates to `/auth/login` (backend handles redirect to Azure AD)
4. After callback → backend redirects to frontend with JWT token in URL query param
5. Frontend stores JWT → all API calls include `Authorization: Bearer {token}`

**AuthProvider.jsx**: Context with user state, auto-check on mount, redirect if unauthorized  
**ProtectedRoute.jsx**: Wraps routes, optional `requireAdmin` prop

---

## STEP 15: Frontend — Layout

**MainLayout.jsx**: Sidebar + top bar + main content area  
**Sidebar.jsx**: Collapsible, dark background

Navigation items:
```
📊 Dashboard          /
📧 Email Activity     /activity
🔍 Patterns           /patterns
⚡ Automation Rules    /rules
📥 Staging            /staging
📋 Audit Log          /audit
⚙️ Settings           /settings
👥 Admin Panel        /admin        (admin only)
```

**Top bar**: User avatar + name, notification bell with badge, global Kill Switch toggle

**Design**: Clean, professional. shadcn/ui throughout. Dark sidebar, light content. Tailwind slate/zinc palette. Blue-600 primary, red destructive, green success, amber warning.

---

## STEP 16: Frontend — Dashboard Page

**4 stats cards**: Emails Observed (trend arrow), Actions Automated Today, Time Saved, Active Rules

**Two columns**: Left = Recent Activity Feed (last 10 actions, undo buttons). Right = Pending Suggestions (confidence badge, quick approve/reject)

**Bottom**: Email Volume line chart (30 days, Recharts) + Top Senders bar chart

---

## STEP 17: Frontend — Email Activity Page

Filter bar: date range, sender/domain search, event type dropdown, folder dropdown. Data table with pagination. Activity heatmap (hour × day of week). Export CSV button.

---

## STEP 18: Frontend — Patterns Page

Tabs: Suggested | Approved | Rejected. Filter by confidence, action type.

Pattern cards: description, confidence bar (green/blue/yellow/red), stats, action distribution donut chart, sample emails (expandable), Approve/Customize/Reject buttons.

Customize modal: modify action, select folder, adjust conditions, set safety config, then approve.

---

## STEP 19: Frontend — Rules Page

Toggle: Active | Paused | Retired. "Create Manual Rule" button.

Drag-and-drop sortable list (@dnd-kit). Each row: priority handle, name, conditions summary, action badge, status toggle, stats, edit/delete buttons.

Rule creation wizard: Step 1 Conditions → Step 2 Action → Step 3 Safety → Step 4 Review.

---

## STEP 20: Frontend — Staging Page

Header with count + Rescue All / Execute All buttons. List items: sender, subject, rule name, action, countdown timer, Rescue/Execute buttons. Friendly empty state.

---

## STEP 21: Frontend — Audit Log Page

Filter bar: date range, rule, action type, show undone toggle. Data table: timestamp, sender, subject, rule, action badge, undo button (if within 48h), status. Pagination + CSV export.

---

## STEP 22: Frontend — Settings Page

Cards for: Microsoft 365 connection (status, reconnect, disconnect), Automation preferences (aggressiveness slider, kill switch), Notifications (digest on/off), Working hours (timezone, start/end), Whitelist management (add/remove entries), Data management (export/delete).

---

## STEP 23: Frontend — Admin Panel

**UserManagement.jsx**: Invite form, users table (name, email, role, status, stats), actions (change role, deactivate, remove).

**OrgSettings.jsx**: Org-wide never-delete list, system health (webhook status per user, sync times, job queue), aggregate stats.

---

## STEP 24: Frontend — Reusable Components

Build in `src/components/`:
- **StatsCard** — Icon, title, value, trend
- **ConfidenceBadge** — Colored by level
- **PatternCard** — Full pattern display
- **RuleRow** — Draggable rule item
- **StagingItem** — Email with countdown
- **ActivityFeed** — Real-time scrolling feed
- **KillSwitch** — Prominent automation toggle
- **EmptyState** — Friendly empty state
- **ConfirmModal** — Reusable confirmation dialog
- **DataTable** — Sortable, filterable, paginated table

---

## NON-FUNCTIONAL REQUIREMENTS

### Error Handling
- Backend: Global error handler, structured responses, specific Graph API error handling (429 throttle, 401 token expired, 404 deleted)
- Frontend: Toast notifications via sonner

### Logging
- Winston: error, warn, info, debug levels
- Log all API requests, Graph calls, job executions, errors
- Logs persist in `msedb-logs` Docker volume

### Documentation
- README.md: setup instructions, architecture, development guide
- .env.example with all variables documented

---

## CRITICAL IMPLEMENTATION NOTES

1. **NEVER store email body content** — only metadata
2. **Webhook endpoint must respond in under 3 seconds** — async processing via BullMQ
3. **Graph subscriptions expire in max 3 days for mail** — renewal job is critical
4. **Always use $select in Graph queries** — only request needed fields
5. **Rate limit Graph API calls** — respect throttle headers, exponential backoff
6. **Encrypt all tokens at rest** — AES-256-GCM with per-user IV
7. **"MSEDB Staging" folder** created per-user via Graph API on first use
8. **First user with ADMIN_EMAIL gets admin role**
9. **All dates in UTC** — convert to user timezone only in frontend
10. **Docker internal addresses**: use `msedb-mongo:27017` and `msedb-redis:6379` (internal ports, not host-mapped ports)
11. **Non-root containers** — all services run as non-root users
12. **Resource limits enforced** — containers cannot exceed CPU/memory caps

---

## BUILD ORDER

Build in this order for a working system at each checkpoint:

1. Docker Compose + Dockerfiles + project scaffolding
2. Backend health endpoint + MongoDB + Redis connections
3. Mongoose models with indexes
4. Azure AD auth flow (login → callback → JWT → me)
5. User management (admin CRUD)
6. Graph API client + mail service basics
7. Webhook subscription + handler (observation begins)
8. Event collector + metadata extractor
9. Delta sync fallback
10. Frontend: Auth flow + Layout + Dashboard (static data)
11. Frontend: Email Activity page
12. Pattern analysis engine
13. Frontend: Patterns page (view + approve/reject)
14. Rule engine + execution
15. Staging manager
16. Frontend: Rules + Staging pages
17. Frontend: Audit Log
18. Undo service
19. All background jobs (BullMQ cron tasks)
20. Frontend: Settings page
21. Frontend: Admin panel
22. Socket.IO real-time updates
23. Notification system + daily digest
24. Polish, error handling, edge cases
25. docker-compose.dev.yml with hot reload volume mounts

---

## BEFORE RUNNING

1. Azure AD App Registration must be created (see MSEDB Setup Guide)
2. `.env` file populated with all values
3. Cloudflare Tunnel running for webhook HTTPS endpoint
4. Run: `docker-compose up --build`
5. Visit: `http://172.16.219.222:3010`
6. Login with admin email to initialize admin account
