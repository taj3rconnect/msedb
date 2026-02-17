# Architecture

**Analysis Date:** 2026-02-16

## Pattern Overview

**Overall:** Layered multi-tier architecture with full containerization

**Key Characteristics:**
- **Containerized stack:** Frontend (React + nginx), Backend (Node.js), MongoDB, Redis all run in isolated Docker containers
- **OAuth 2.0 authentication:** Microsoft Identity Platform via MSAL for Azure AD integration
- **Microsoft Graph API integration:** Direct connection to Microsoft 365 for mail, folder, and rule management
- **Pattern detection engine:** Analyzes user email behavior to identify repetitive actions
- **User approval workflow:** No automation rule is created without explicit user sign-off
- **Event-driven:** WebSocket and job queue architecture for real-time updates and background processing

## Layers

**Presentation Layer (Frontend):**
- Purpose: React dashboard for users to review detected patterns, approve rules, and manage settings
- Location: `frontend/src/`
- Contains: React components, pages, hooks, stores (Zustand), API client, UI components (shadcn/ui)
- Depends on: Backend API, Tailwind CSS, TanStack Query, Socket.IO client
- Used by: Web browsers via nginx proxy

**API Layer (Backend):**
- Purpose: Express.js REST API serving frontend requests and handling webhooks
- Location: `backend/src/routes/`
- Contains: Route definitions for auth, patterns, rules, staging, audit, admin features
- Depends on: Authentication middleware, services, MongoDB, Redis
- Used by: Frontend, webhook sources (Microsoft Graph)

**Authentication & Security Layer:**
- Purpose: MSAL-based OAuth 2.0 flow for Azure AD, JWT session management, encrypted token storage
- Location: `backend/src/auth/`
- Contains: MSAL client application, token refresh manager, JWT middleware, RBAC middleware
- Depends on: Azure AD, MongoDB (for token storage)
- Used by: All authenticated routes

**Service Layer (Business Logic):**
- Purpose: Core domain logic separated into specialized services
- Location: `backend/src/services/`
- Contains: Five specialized subdirectories:
  - `graph/` - Microsoft Graph API interactions (mail, subscriptions, delta sync)
  - `collector/` - Email event collection and metadata extraction
  - `analyzer/` - Pattern detection, confidence scoring, subject normalization
  - `automation/` - Rule engine, staging manager, undo functionality
  - `notification/` - Notification service, digest builder
  - `admin/` - User management, org-level rules
- Depends on: Models, Microsoft Graph SDK, Redis
- Used by: Routes, jobs

**Data Access Layer (Models):**
- Purpose: Mongoose schema definitions with validation and indexes
- Location: `backend/src/models/`
- Contains: User, EmailEvent, Pattern, Rule, StagedEmail, AuditLog, Notification, WebhookSubscription models
- Depends on: MongoDB, crypto (for encryption)
- Used by: Services, routes

**Job Queue Layer (Background Tasks):**
- Purpose: Asynchronous task processing via BullMQ
- Location: `backend/src/jobs/`
- Contains: Queue initialization, webhook renewal, delta sync, pattern analysis, staging processor, token refresh, daily digest
- Depends on: Redis, services
- Used by: Server startup, scheduler triggers

**Middleware Layer:**
- Purpose: Request/response interceptors and cross-cutting concerns
- Location: `backend/src/middleware/`
- Contains: Authentication, RBAC, rate limiting, error handling
- Depends on: JWT, config
- Used by: All routes

**Configuration Layer:**
- Purpose: Environment variable loading and service initialization
- Location: `backend/src/config/`
- Contains: Config loader, database connection, Redis connection, Socket.IO setup
- Depends on: Environment variables
- Used by: Server startup

## Data Flow

**Email Action Event → Pattern Detection → Rule Suggestion → User Approval → Automation:**

1. **Event Collection Phase:**
   - Microsoft Graph webhook delivers email action event (delete, move, archive)
   - `webhookRoutes.js` receives webhook payload
   - `eventCollector.js` extracts metadata: sender, subject, folder, action type
   - `EmailEvent` record created in MongoDB with timestamp and user context
   - Event published via Socket.IO to connected clients

2. **Pattern Analysis Phase:**
   - `patternAnalysis` job runs periodically (configurable interval)
   - `patternDetector.js` queries recent `EmailEvent` records for user
   - Groups events by action type and common attributes (sender domain, subject keywords)
   - `confidenceScorer.js` assigns confidence score based on frequency and recency
   - `Pattern` records created with suggested rule condition and action

3. **Pattern Surfacing Phase:**
   - Detected patterns queried from MongoDB with filters (confidence >= threshold)
   - Sent to frontend via REST API (`patternRoutes.js`)
   - `PatternCard` component displays pattern with suggested rule
   - User reviews confidence score, condition, and action

4. **Approval & Staging Phase:**
   - User approves pattern from UI
   - `POST /api/patterns/:id/approve` creates `StagedEmail` records matching pattern condition
   - `stagingProcessor` job runs, applying rule condition to inbox
   - User sees preview of emails that would be affected over 24-hour grace period
   - User can undo from staging interface

5. **Rule Creation Phase:**
   - User confirms from staging interface
   - `ruleEngine.js` converts `Pattern` to Microsoft Graph MailboxSettings rule
   - Rule submitted via `mailService.js` using user's access token
   - `Rule` record created in MongoDB with Graph rule ID
   - Rule enabled in user's mailbox

6. **Ongoing Automation Phase:**
   - Microsoft Graph automatically applies rule to incoming mail
   - `EventCollector` continues monitoring for covered emails
   - `AuditLog` records each rule application

**State Management:**
- **Frontend:** Zustand stores for auth state, notifications
- **Backend:** MongoDB for persistent state (users, patterns, rules, events), Redis for caching and queue
- **Real-time:** Socket.IO broadcasts pattern detection results, staging updates to connected clients

## Key Abstractions

**User-Aware Service Context:**
- Purpose: All services operate within user context (authenticated user with specific mailbox and access token)
- Examples: `patternDetector.analyzeForUser(userId)`, `mailService.getMessagesForUser(userId)`
- Pattern: Services accept `userId` or `accessToken` as first parameter

**Graph Client Abstraction:**
- Purpose: Encapsulate Microsoft Graph SDK calls with error handling and retry logic
- Examples: `graphClient.js` provides singleton client, `mailService.js` provides domain-specific wrappers
- Pattern: Services use `mailService.getMailFolders()` rather than direct SDK calls

**Pattern-to-Rule Conversion:**
- Purpose: Abstract the translation from detected user behavior pattern to Graph MailboxSettings rule JSON
- Examples: Pattern { sender: "newsletter@example.com", action: "delete" } → Rule JSON { conditions: {...}, actions: {...} }
- Pattern: `ruleEngine.convertPatternToRule(pattern)` handles all Graph API schema requirements

**Staged Execution with Undo:**
- Purpose: Provide safety window before rule activation
- Examples: `stagingManager.stageRule(pattern)`, `undoService.revertStagedChanges(ruleId)`
- Pattern: `StagedEmail` records track emails that would be affected; user can undo within grace period

**Encrypted Token Storage:**
- Purpose: Protect Microsoft Graph access tokens in database
- Examples: `tokenManager.storeTokens()` uses AES-256-GCM encryption
- Pattern: `tokenManager.getAccessToken()` transparently handles encryption/decryption

## Entry Points

**Backend Server Start:**
- Location: `backend/src/server.js`
- Triggers: Docker container startup (`docker-compose up`)
- Responsibilities: Initialize Express app, connect to MongoDB, start Redis client, initialize Socket.IO, register job queues, start listening on port 8010

**Frontend Build & Serve:**
- Location: `frontend/` (Vite build) → nginx
- Triggers: Docker container startup
- Responsibilities: Build React app with Vite, serve compiled assets via nginx, proxy `/api/`, `/auth/`, `/webhooks/` to backend

**Authentication Flow:**
- Location: `backend/src/auth/routes.js` - `GET /auth/login`
- Triggers: User clicks "Login" on `LoginPage.jsx`
- Responsibilities: Redirect to Azure AD authorization endpoint, handle callback, exchange code for tokens, create/update User record, issue JWT

**Microsoft Graph Webhook:**
- Location: `backend/src/routes/webhookRoutes.js` - `POST /webhooks/graph`
- Triggers: Microsoft Graph sends notification event
- Responsibilities: Validate webhook signature, parse subscription event, publish to event collector

**Pattern Analysis Job:**
- Location: `backend/src/jobs/patternAnalysis.js`
- Triggers: Scheduled via BullMQ queue
- Responsibilities: Analyze EmailEvent records for each user, detect patterns, score confidence, create Pattern records

## Error Handling

**Strategy:** Layered error handling with specific error types and logging

**Patterns:**
- **Graph API errors:** Caught in `mailService.js`, logged with user context, retried with exponential backoff for transient errors
- **Database errors:** Caught at service layer, wrapped in custom error classes, logged with query context
- **Validation errors:** Caught in routes, returned as 400 responses with validation details
- **Authentication errors:** Caught in middleware, returned as 401 responses
- **Authorization errors:** Caught in RBAC middleware, returned as 403 responses
- **Unhandled errors:** Caught by global error handler in middleware, logged, returned as 500 responses

## Cross-Cutting Concerns

**Logging:**
- Tool: Winston configured in `backend/src/utils/logger.js`
- Pattern: All service methods log entry/exit with user context, data being processed, errors encountered
- Levels: debug (development), info (operations), warn (suspicious activity), error (failures)

**Validation:**
- Pattern: Mongoose schema validation on model level, Express route parameter validation
- Scope: Email addresses, rule conditions, pattern thresholds validated before database write

**Authentication:**
- Pattern: JWT extracted from Authorization header or httpOnly cookie, verified via `requireAuth` middleware
- Scope: All routes except `/auth/login`, `/auth/callback`, `/health` require authentication

**Rate Limiting:**
- Pattern: Applied via middleware at route level
- Scope: `/auth/login` (5 per minute), `/api/` (100 per minute per user)
- Implementation: `backend/src/middleware/rateLimiter.js` using Redis

**Audit Logging:**
- Pattern: Every state-changing operation (create rule, approve pattern, delete event) recorded to `AuditLog` model
- Scope: Tracks who did what and when for compliance

---

*Architecture analysis: 2026-02-16*
