# Codebase Structure

**Analysis Date:** 2026-02-16

## Directory Layout

```
msedb/
├── docker-compose.yml                  # Main orchestration (prod)
├── docker-compose.dev.yml              # Dev overrides with volume mounts
├── .env.example                        # Template for required env vars
├── .env                                # Actual config (gitignored)
├── .gitignore                          # Git ignore rules
├── README.md                           # Project overview
│
├── backend/
│   ├── Dockerfile                      # Multi-stage build: alpine → app
│   ├── .dockerignore                   # Docker build exclusions
│   ├── package.json                    # Dependencies + scripts
│   ├── package-lock.json               # Locked dependency versions
│   │
│   └── src/
│       ├── server.js                   # Express app initialization, Socket.IO, job startup
│       │
│       ├── config/
│       │   ├── index.js                # Load & validate all env vars with defaults
│       │   ├── database.js             # MongoDB connection with retry logic
│       │   ├── redis.js                # Redis client initialization
│       │   └── socket.js               # Socket.IO server setup
│       │
│       ├── auth/
│       │   ├── azureAd.js              # MSAL ConfidentialClientApplication setup
│       │   ├── tokenManager.js         # Encrypt/decrypt/refresh tokens, AES-256-GCM
│       │   ├── middleware.js           # requireAuth, requireAdmin middlewares
│       │   └── routes.js               # /auth/login, /auth/callback, /auth/logout, /auth/me
│       │
│       ├── models/
│       │   ├── User.js                 # Schema: email, role, microsoftId, lastLogin, preferences
│       │   ├── EmailEvent.js           # Schema: userId, from, subject, action (delete/move/archive), folder, timestamp
│       │   ├── Pattern.js              # Schema: userId, condition (matcher), action (rule action), confidence, createdAt
│       │   ├── Rule.js                 # Schema: userId, graphRuleId, pattern ref, status (active/inactive), createdAt
│       │   ├── StagedEmail.js          # Schema: ruleId, messageId, subject, from, timestamp, previewUntil
│       │   ├── AuditLog.js             # Schema: userId, action, resourceId, resourceType, timestamp, changes
│       │   ├── Notification.js         # Schema: userId, type, message, read, createdAt
│       │   └── WebhookSubscription.js  # Schema: userId, subscriptionId, resource (e.g., "mailFolders/inbox"), expirationTime
│       │
│       ├── services/
│       │   ├── graph/
│       │   │   ├── graphClient.js      # Singleton Graph SDK client with error handling
│       │   │   ├── mailService.js      # Wrapper methods: getMailFolders(), getMessages(), deleteMessage(), createRule()
│       │   │   ├── subscriptionService.js  # Create/renew/list webhooks via Graph Subscriptions API
│       │   │   └── deltaService.js     # Delta query API for incremental email sync
│       │   │
│       │   ├── collector/
│       │   │   ├── eventCollector.js   # Parse webhook payloads, extract metadata, create EmailEvent records
│       │   │   └── metadataExtractor.js  # Extract sender domain, normalize subject, extract folder
│       │   │
│       │   ├── analyzer/
│       │   │   ├── patternDetector.js  # GroupBy, frequency analysis, detect repetitive actions
│       │   │   ├── confidenceScorer.js # Assign confidence based on frequency, recency, uniqueness
│       │   │   └── subjectNormalizer.js  # Strip re:, fwd:, extract keywords for grouping
│       │   │
│       │   ├── automation/
│       │   │   ├── ruleEngine.js       # Convert Pattern to Graph MailboxSettings rule JSON
│       │   │   ├── stagingManager.js   # Create StagedEmail records, preview what would be affected
│       │   │   └── undoService.js      # Delete StagedEmail records (before 24hr grace expires)
│       │   │
│       │   ├── notification/
│       │   │   ├── notificationService.js  # Create, mark-read, list Notification records
│       │   │   └── digestBuilder.js    # Build daily digest of patterns, rule applications, alerts
│       │   │
│       │   └── admin/
│       │       ├── userManagement.js   # Create, list, delete users; assign roles
│       │       └── orgRules.js         # Org-wide rule templates, shared patterns
│       │
│       ├── jobs/
│       │   ├── queue.js                # BullMQ queue initialization, worker setup
│       │   ├── webhookRenewal.js       # Job: Renew expiring Graph subscriptions (weekly)
│       │   ├── deltaSync.js            # Job: Sync incremental email changes (hourly)
│       │   ├── patternAnalysis.js      # Job: Detect patterns from EmailEvent (hourly)
│       │   ├── stagingProcessor.js     # Job: Apply staged rules to inbox, find matching emails (6hr)
│       │   ├── tokenRefresh.js         # Job: Proactively refresh tokens before expiry (per user)
│       │   └── dailyDigest.js          # Job: Build and notify users of digest (daily, 9am)
│       │
│       ├── routes/
│       │   ├── index.js                # Route aggregator, mounts all sub-routers
│       │   ├── webhookRoutes.js        # POST /webhooks/graph (Graph notifications)
│       │   ├── dashboardRoutes.js      # GET /api/dashboard (stats, activity feed)
│       │   ├── patternRoutes.js        # GET /api/patterns, POST /api/patterns/:id/approve
│       │   ├── ruleRoutes.js           # GET, POST, DELETE /api/rules, rule lifecycle
│       │   ├── stagingRoutes.js        # GET /api/staging, POST /api/staging/:id/confirm, DELETE /api/staging/:id
│       │   ├── auditRoutes.js          # GET /api/audit (audit log, filterable by user/action)
│       │   ├── settingsRoutes.js       # GET, POST /api/settings (user preferences, thresholds)
│       │   └── adminRoutes.js          # GET, POST, DELETE /api/admin/users, /api/admin/org (admin only)
│       │
│       ├── middleware/
│       │   ├── auth.js                 # JWT extraction & verification (requireAuth, optionalAuth)
│       │   ├── rbac.js                 # Role-based access control (requireAdmin, requireOwner)
│       │   ├── rateLimiter.js          # Redis-backed rate limiting per user
│       │   └── errorHandler.js         # Global error handler: catch all, log, return error response
│       │
│       └── utils/
│           ├── logger.js               # Winston logger: debug, info, warn, error levels
│           ├── graphHelpers.js         # Helper functions for Graph API: format rules, parse errors
│           └── dateUtils.js            # Timezone helpers, timestamp formatting
│
├── frontend/
│   ├── Dockerfile                      # Multi-stage build: node alpine → nginx
│   ├── .dockerignore                   # Docker build exclusions
│   ├── nginx.conf                      # Nginx reverse proxy config: proxy /api/ to backend
│   ├── package.json                    # Dependencies + build scripts
│   ├── package-lock.json               # Locked dependency versions
│   ├── vite.config.js                  # Vite build config: React, JSX, library mode
│   ├── tailwind.config.js              # Tailwind CSS configuration
│   ├── postcss.config.js               # PostCSS config for Tailwind
│   ├── index.html                      # HTML entry point: root div, script src
│   │
│   └── src/
│       ├── main.jsx                    # React app entry: ReactDOM.render(App, root)
│       ├── App.jsx                     # Main App component: Router, Provider wrapping
│       │
│       ├── api/
│       │   └── client.js               # Axios instance with JWT interceptor, base URL
│       │
│       ├── auth/
│       │   ├── AuthProvider.jsx        # Context provider for current user, loading state
│       │   ├── ProtectedRoute.jsx      # Route wrapper: check auth, redirect to login
│       │   └── LoginPage.jsx           # Form: "Login with Microsoft", redirect to /auth/login
│       │
│       ├── layouts/
│       │   ├── MainLayout.jsx          # App shell: Sidebar + main content area
│       │   └── Sidebar.jsx             # Navigation menu: Dashboard, Patterns, Rules, Staging, Audit, Settings
│       │
│       ├── pages/
│       │   ├── Dashboard.jsx           # Overview: stats cards, activity feed, recent patterns
│       │   ├── EmailActivity.jsx       # List all recent email events (filtered by date/action)
│       │   ├── Patterns.jsx            # List detected patterns, approval flow
│       │   ├── Rules.jsx               # List active rules, enable/disable, delete
│       │   ├── Staging.jsx             # Preview emails in staging, confirm/undo
│       │   ├── AuditLog.jsx            # Audit log viewer: filters by action/user/date
│       │   ├── Settings.jsx            # User preferences: pattern thresholds, notification settings
│       │   └── admin/
│       │       ├── UserManagement.jsx  # (Admin) List users, invite, delete, assign roles
│       │       └── OrgSettings.jsx     # (Admin) Org-wide settings, rule templates
│       │
│       ├── components/
│       │   ├── ui/                     # shadcn/ui components (import, don't build)
│       │   ├── PatternCard.jsx         # Display pattern: condition, action, confidence, approve button
│       │   ├── RuleRow.jsx             # List item: rule name, status toggle, created date, delete
│       │   ├── StagingItem.jsx         # Display staged email: preview, affected indicator
│       │   ├── StatsCard.jsx           # Reusable card: title, number, icon, trend
│       │   ├── ActivityFeed.jsx        # Timeline: recent events (patterns detected, rules created)
│       │   ├── ConfidenceBadge.jsx     # Visual badge: confidence score (red/yellow/green)
│       │   ├── KillSwitch.jsx          # Master toggle: pause all rules (admin feature)
│       │   ├── EmptyState.jsx          # Placeholder: message + icon when list empty
│       │   ├── ConfirmModal.jsx        # Reusable modal: confirm action with message
│       │   └── DataTable.jsx           # Reusable table: sortable columns, pagination
│       │
│       ├── hooks/
│       │   ├── useAuth.js              # Hook: get current user, login, logout, isAdmin
│       │   ├── usePatterns.js          # Hook: fetch patterns (useQuery), approve pattern (useMutation)
│       │   ├── useRules.js             # Hook: fetch rules, create rule, delete rule
│       │   └── useWebSocket.js         # Hook: connect to Socket.IO, subscribe to events
│       │
│       ├── stores/
│       │   ├── authStore.js            # Zustand store: currentUser, isLoading, error
│       │   └── notificationStore.js    # Zustand store: toast notifications, list
│       │
│       └── utils/
│           ├── constants.js            # Enums: action types, rule types, status values
│           └── formatters.js           # Helpers: formatDate(), formatEmail(), formatConfidence()
│
└── scripts/
    ├── seed.js                         # Dev: populate test data (test users, events, patterns)
    ├── migrate.js                      # DB migrations: run schema updates
    └── backup.sh                       # Backup MongoDB data (cron-friendly)
```

## Directory Purposes

**Root:**
- Purpose: Project configuration and orchestration
- Contains: Docker Compose, environment templates, git config
- Key files: `docker-compose.yml` (production), `docker-compose.dev.yml` (development)

**backend/src/:**
- Purpose: Node.js / Express API server and business logic
- Contains: All server-side code organized by concern (auth, models, services, routes, jobs)
- Key files: `server.js` (entry point), `config/` (initialization)

**backend/src/config/:**
- Purpose: Application configuration and service initialization
- Contains: Environment loading, database/cache connection setup, Socket.IO initialization
- Key files: `index.js` (validates env vars), `database.js` (MongoDB), `redis.js` (Redis)

**backend/src/auth/:**
- Purpose: Authentication and authorization logic
- Contains: Azure AD MSAL setup, token encryption/refresh, JWT middleware
- Key files: `azureAd.js` (OAuth flow), `tokenManager.js` (token lifecycle), `routes.js` (auth endpoints)

**backend/src/models/:**
- Purpose: Data schema definitions with validation
- Contains: Mongoose models for all domain entities
- Key files: All models listed above. Every model has `timestamps: true`, indexes on foreign keys

**backend/src/services/graph/:**
- Purpose: Microsoft Graph API abstraction
- Contains: SDK client wrapper, domain-specific methods (mail operations), subscription/webhook management
- Key files: `graphClient.js` (singleton), `mailService.js` (mail operations)

**backend/src/services/collector/:**
- Purpose: Event collection from webhooks
- Contains: Webhook payload parsing, metadata extraction from email
- Key files: `eventCollector.js` (webhook handler), `metadataExtractor.js` (email metadata)

**backend/src/services/analyzer/:**
- Purpose: Pattern detection and scoring
- Contains: Frequency analysis, confidence scoring, text normalization
- Key files: `patternDetector.js` (main logic), `confidenceScorer.js` (scoring algorithm)

**backend/src/services/automation/:**
- Purpose: Rule creation and staging
- Contains: Pattern-to-rule conversion, safe staging with undo
- Key files: `ruleEngine.js` (conversion), `stagingManager.js` (preview), `undoService.js` (rollback)

**backend/src/services/notification/:**
- Purpose: User notifications and digests
- Contains: Notification storage and delivery, daily digest building
- Key files: `notificationService.js` (CRUD), `digestBuilder.js` (content generation)

**backend/src/services/admin/:**
- Purpose: Admin operations
- Contains: User management, org-level rules
- Key files: `userManagement.js` (user CRUD), `orgRules.js` (shared templates)

**backend/src/jobs/:**
- Purpose: Background task scheduling and execution
- Contains: BullMQ queue definition, individual job handlers
- Key files: `queue.js` (queue setup), one file per job type

**backend/src/routes/:**
- Purpose: HTTP endpoint handlers
- Contains: Express route definitions for all API paths
- Key files: `index.js` (router aggregation), one file per feature

**backend/src/middleware/:**
- Purpose: Request/response interceptors
- Contains: Authentication, authorization, rate limiting, error handling
- Key files: `auth.js` (JWT), `rbac.js` (roles), `errorHandler.js` (global catch-all)

**backend/src/utils/:**
- Purpose: Reusable utility functions
- Contains: Logging, helper functions for Graph API, date utilities
- Key files: `logger.js` (Winston), `graphHelpers.js` (Graph-specific helpers)

**frontend/src/:**
- Purpose: React frontend application
- Contains: Components, pages, hooks, state management, API client
- Key files: `main.jsx` (entry), `App.jsx` (app shell)

**frontend/src/api/:**
- Purpose: Backend communication
- Contains: Axios instance with interceptors
- Key files: `client.js` (configured instance)

**frontend/src/auth/:**
- Purpose: Authentication flow and context
- Contains: Login page, auth provider context, protected route wrapper
- Key files: `LoginPage.jsx` (login UI), `AuthProvider.jsx` (context)

**frontend/src/pages/:**
- Purpose: Top-level route components
- Contains: One component per page/feature
- Key files: `Patterns.jsx`, `Rules.jsx`, `Staging.jsx`, etc.

**frontend/src/components/:**
- Purpose: Reusable UI components
- Contains: shadcn/ui imports, feature-specific components (PatternCard, RuleRow), shared components (Modal, Table, Badge)
- Key files: Components are imported from shadcn/ui, custom components are in this directory

**frontend/src/hooks/:**
- Purpose: Custom React hooks
- Contains: API data fetching (useQuery), mutations, auth context usage
- Key files: One hook per domain (patterns, rules, auth, websocket)

**frontend/src/stores/:**
- Purpose: Global state management
- Contains: Zustand store definitions
- Key files: `authStore.js` (user state), `notificationStore.js` (toast/alerts)

**scripts/:**
- Purpose: Development and maintenance scripts
- Contains: Data seeding, migrations, backups
- Key files: `seed.js` (test data), `migrate.js` (schema updates)

## Key File Locations

**Entry Points:**

- `backend/src/server.js`: Backend initialization (Express, MongoDB, Redis, Socket.IO, job queue startup)
- `frontend/src/main.jsx`: Frontend initialization (ReactDOM render, provider setup)
- `frontend/index.html`: HTML entry point for browser
- `docker-compose.yml`: Full stack orchestration

**Configuration:**

- `backend/src/config/index.js`: Load and validate all environment variables
- `.env.example`: Template of required environment variables
- `.env`: Actual configuration (gitignored, contains secrets)
- `frontend/vite.config.js`: Vite build configuration
- `frontend/tailwind.config.js`: Tailwind CSS theming

**Core Logic:**

- `backend/src/services/analyzer/patternDetector.js`: Pattern detection algorithm
- `backend/src/services/automation/ruleEngine.js`: Convert pattern to Graph rule
- `backend/src/services/graph/mailService.js`: Microsoft Graph operations
- `backend/src/auth/tokenManager.js`: Encrypted token storage and refresh

**Testing:**

- `scripts/seed.js`: Create test data
- `scripts/migrate.js`: Database schema changes
- Unit tests colocated with source files (patterns: `filename.test.js` or `filename.spec.js`)

## Naming Conventions

**Files:**

- **camelCase.js** for JavaScript files: `patternDetector.js`, `tokenManager.js`
- **PascalCase.jsx** for React components: `PatternCard.jsx`, `MainLayout.jsx`
- **Mongoose models:** PascalCase, singular: `User.js`, `EmailEvent.js`, `Pattern.js`
- **Service files:** camelCase, descriptive: `patternDetector.js`, `confidenceScorer.js`
- **Routes:** camelCase with "Routes" suffix: `patternRoutes.js`, `ruleRoutes.js`
- **Middleware:** camelCase: `auth.js`, `rbac.js`, `errorHandler.js`
- **Jobs:** camelCase with behavior verb: `patternAnalysis.js`, `webhookRenewal.js`
- **Config:** camelCase, descriptive: `database.js`, `redis.js`, `socket.js`

**Directories:**

- **Functional groups:** camelCase: `services/`, `routes/`, `models/`, `middleware/`, `jobs/`
- **Feature subdirectories:** camelCase: `graph/`, `collector/`, `analyzer/`, `automation/`, `notification/`, `admin/`
- **React structure:** camelCase for hooks, stores; PascalCase for components: `pages/`, `components/`, `layouts/`, `hooks/`, `stores/`

**Functions:**

- **Service methods:** camelCase, verb-first: `analyzeForUser()`, `detectPatterns()`, `createRule()`
- **API endpoints:** RESTful patterns: `GET /api/patterns`, `POST /api/patterns/:id/approve`, `DELETE /api/rules/:id`
- **React hooks:** camelCase, "use" prefix: `useAuth()`, `usePatterns()`, `useWebSocket()`
- **Zustand stores:** camelCase with "Store" suffix: `authStore.js`, `notificationStore.js`

**Variables & Constants:**

- **Constants:** UPPER_SNAKE_CASE: `MAX_CONFIDENCE`, `STAGING_GRACE_PERIOD_HOURS`, `GRAPH_API_VERSION`
- **Regular variables:** camelCase: `emailEvent`, `patternId`, `accessToken`
- **Database IDs:** ObjectId by default, named with "Id" suffix: `userId`, `ruleId`, `patternId`

## Where to Add New Code

**New Feature (e.g., Auto-Response Rules):**

1. **Backend:**
   - Create Mongoose model: `backend/src/models/AutoResponse.js`
   - Create service: `backend/src/services/automation/autoResponseEngine.js`
   - Create routes: `backend/src/routes/autoResponseRoutes.js`
   - Create job (if async): `backend/src/jobs/autoResponseProcessor.js`
   - Add routes to `backend/src/routes/index.js`

2. **Frontend:**
   - Create page: `frontend/src/pages/AutoResponses.jsx`
   - Create component: `frontend/src/components/AutoResponseCard.jsx`
   - Create hook: `frontend/src/hooks/useAutoResponses.js`
   - Add route to `frontend/src/App.jsx`
   - Add sidebar link to `frontend/src/layouts/Sidebar.jsx`

**New Component/Module:**

- **Reusable UI:** Place in `frontend/src/components/` with PascalCase name
- **Domain-specific component:** Place in feature directory (e.g., `frontend/src/pages/`)
- **Backend module:** Create in appropriate service subdirectory under `backend/src/services/`

**Utilities:**

- **Shared helpers:** `backend/src/utils/` for backend, `frontend/src/utils/` for frontend
- **Graph-specific:** `backend/src/utils/graphHelpers.js`
- **Date helpers:** `backend/src/utils/dateUtils.js`
- **Frontend formatters:** `frontend/src/utils/formatters.js`

**Tests:**

- Colocate with source: `patternDetector.test.js` next to `patternDetector.js`
- Or use `__tests__/` subdirectory if large test suite
- Backend: `npm test` runs Jest
- Frontend: `npm test` runs Vitest

## Special Directories

**backend/src/config/:**
- Purpose: Initialization code for shared services
- Generated: No
- Committed: Yes
- Note: Read at server startup; environment variables loaded here

**backend/src/jobs/:**
- Purpose: Background task definitions
- Generated: No
- Committed: Yes
- Note: Workers registered with BullMQ queue on startup

**frontend/src/components/ui/:**
- Purpose: shadcn/ui component imports (not custom code)
- Generated: Yes (via `npx shadcn-ui@latest add ...`)
- Committed: Yes (components are copied, not linked)
- Note: Never edit these manually; regenerate if needed

**msedb-logs/** (Docker volume):
- Purpose: Container log output persistence
- Generated: Yes (by app during runtime)
- Committed: No (gitignored)
- Note: Winston logs written to files for persistence across container restarts

**msedb-mongo-data/** (Docker volume):
- Purpose: MongoDB persistence layer
- Generated: Yes (MongoDB writes data)
- Committed: No (gitignored)
- Note: Survives container restart; backup via `scripts/backup.sh`

**msedb-redis-data/** (Docker volume):
- Purpose: Redis persistence (AOF format)
- Generated: Yes (Redis writes data)
- Committed: No (gitignored)
- Note: Job queue state and cache persisted; survives restart

**.env:**
- Purpose: Runtime configuration (secrets, URLs, settings)
- Generated: No (create from `.env.example`)
- Committed: No (gitignored for security)
- Note: Must be present before `docker-compose up`

---

*Structure analysis: 2026-02-16*
