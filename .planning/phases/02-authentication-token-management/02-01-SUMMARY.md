---
phase: 02-authentication-token-management
plan: 01
subsystem: auth
tags: [msal, oauth, azure-ad, jwt, cookie, middleware, mongodb-cache]

# Dependency graph
requires:
  - phase: 01-infrastructure-foundation
    provides: "Express server, MongoDB/Mongoose models, encryption utils, security middleware, rate limiters"
provides:
  - "MSAL ConfidentialClientApplication factory with per-mailbox MongoDB cache plugin"
  - "OAuth login/callback/logout endpoints with Azure AD"
  - "JWT session management via httpOnly cookies"
  - "requireAuth and requireAdmin middleware for route-level auth"
  - "Token manager with silent acquisition and encryption helpers"
affects: [02-02-token-refresh-multi-mailbox, 03-observation-engine, 04-frontend-dashboard]

# Tech tracking
tech-stack:
  added: ["@azure/msal-node@^3.8.7", "jsonwebtoken@^9.0.3", "cookie-parser@^1.4.7", "uuid@^13.0.0", "@types/jsonwebtoken", "@types/cookie-parser"]
  patterns: ["MongoDBCachePlugin (ICachePlugin) for per-mailbox MSAL cache persistence", "Signed JWT state parameter for OAuth CSRF protection", "httpOnly cookie-based JWT sessions", "Route-level auth middleware (not server-level blanket)"]

key-files:
  created:
    - "backend/src/auth/msalClient.ts"
    - "backend/src/auth/tokenManager.ts"
    - "backend/src/auth/middleware.ts"
    - "backend/src/auth/routes.ts"
  modified:
    - "backend/src/models/Mailbox.ts"
    - "backend/src/models/Notification.ts"
    - "backend/src/server.ts"
    - "backend/package.json"

key-decisions:
  - "Used signed JWT as OAuth state parameter instead of Redis nonce -- self-contained, no Redis lookup required"
  - "Auth middleware applied at route level only, not as blanket server-level middleware -- gives each route file explicit control"
  - "createLoginMsalClient (no cache plugin) vs createMsalClient (with cache plugin) -- login flow has no mailbox yet"

patterns-established:
  - "MongoDBCachePlugin: ICachePlugin persists MSAL cache to Mailbox.msalCache per-mailbox"
  - "Route-level auth: each router applies requireAuth/requireAdmin explicitly"
  - "Signed JWT state: OAuth state parameter is a signed JWT encoding action and timestamp"

requirements-completed: [AUTH-01, AUTH-02, AUTH-04]

# Metrics
duration: 3min
completed: 2026-02-17
---

# Phase 2 Plan 01: MSAL OAuth Authentication Summary

**Azure AD OAuth 2.0 SSO via MSAL Node with JWT httpOnly cookie sessions, per-mailbox MongoDB cache persistence, and route-level auth middleware**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-17T16:07:57Z
- **Completed:** 2026-02-17T16:11:05Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- MSAL ConfidentialClientApplication factory with MongoDBCachePlugin persisting token cache to Mailbox.msalCache per-mailbox
- Full OAuth login/callback/logout flow: Azure AD redirect, token exchange, User/Mailbox upsert, JWT session cookie
- requireAuth and requireAdmin middleware for route-level access control
- Token manager with silent acquisition (acquireTokenSilent), encryption helpers, and interaction-required detection

## Task Commits

Each task was committed atomically:

1. **Task 1: Install dependencies and create MSAL client factory with MongoDB cache plugin** - `17dd818` (feat)
2. **Task 2: Create auth routes, JWT middleware, and mount in server** - `1d3b6b3` (feat)

## Files Created/Modified
- `backend/src/auth/msalClient.ts` - MSAL ConfidentialClientApplication factory, MongoDBCachePlugin, GRAPH_SCOPES constant
- `backend/src/auth/tokenManager.ts` - Token encryption/decryption helpers, getAccessTokenForMailbox, isInteractionRequired
- `backend/src/auth/middleware.ts` - requireAuth (JWT cookie verification), requireAdmin (role check), Express Request augmentation
- `backend/src/auth/routes.ts` - GET /auth/login, GET /auth/callback, POST /auth/logout, GET /auth/me
- `backend/src/models/Mailbox.ts` - Added homeAccountId field with sparse unique index
- `backend/src/models/Notification.ts` - Added token_expiring to notification type enum
- `backend/src/server.ts` - Mounted cookie-parser and authRouter
- `backend/package.json` - Added @azure/msal-node, jsonwebtoken, cookie-parser, uuid dependencies

## Decisions Made
- **Signed JWT state parameter:** Used a JWT signed with jwtSecret as the OAuth state parameter (10 min expiry) instead of storing a random nonce in Redis. Self-contained, no Redis lookup needed, encodes action context.
- **Route-level auth only:** Auth middleware is NOT applied as a blanket `app.use('/api', requireAuth)` at the server level. Each route file applies its own auth middleware explicitly, giving each route file control over its auth requirements.
- **Separate login MSAL client:** createLoginMsalClient() has no cache plugin because no Mailbox exists during the initial login flow. After login, the token cache is manually serialized to the newly created Mailbox document.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

**External services require manual configuration.** Azure AD app registration must be created before OAuth flow can be tested end-to-end:
- Create app registration in Azure Portal with redirect URI `http://localhost:8010/auth/callback`
- Configure API permissions: User.Read, Mail.Read, Mail.ReadWrite, Mail.Send, MailboxSettings.ReadWrite, offline_access
- Grant admin consent for all permissions
- Create client secret and copy the Value
- Set environment variables: AZURE_AD_TENANT_ID, AZURE_AD_CLIENT_ID, AZURE_AD_CLIENT_SECRET, JWT_SECRET, ADMIN_EMAIL

## Next Phase Readiness
- Auth foundation complete: OAuth flow, JWT sessions, middleware all ready
- Plan 02-02 (token refresh worker, multi-mailbox connect flow) can proceed immediately
- Frontend (Phase 4) can integrate with /auth/login redirect and /auth/me endpoint
- Azure AD app registration is the remaining blocker for end-to-end testing

## Self-Check: PASSED

All 8 files verified present. Both task commits (17dd818, 1d3b6b3) verified in git log.

---
*Phase: 02-authentication-token-management*
*Completed: 2026-02-17*
