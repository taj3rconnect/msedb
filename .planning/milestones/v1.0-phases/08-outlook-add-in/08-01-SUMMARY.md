---
phase: 08-outlook-add-in
plan: 01
subsystem: auth, ui
tags: [office-addin, msal, naa, sso, jwks-rsa, webpack, outlook, manifest-xml, cors]

# Dependency graph
requires:
  - phase: 02-authentication-token-management
    provides: Azure AD app registration, MSAL config, JWT session middleware, auth routes
  - phase: 01-infrastructure-foundation
    provides: Express server, security middleware, config module
provides:
  - Buildable addin/ package with webpack, manifest.xml, Office.js entry points
  - MSAL NAA auth with silent+popup token acquisition for Outlook add-in
  - Backend SSO middleware (requireSsoAuth) validating Azure AD JWT via JWKS
  - Composite requireSsoOrCookieAuth middleware for dual-auth routes
  - CORS configuration supporting both frontend and add-in origins
  - TypeScript types for add-in domain (SenderInfo, MailboxInfo, ActionResult)
  - Authenticated backend API client for add-in-to-backend communication
affects: [08-02-outlook-add-in]

# Tech tracking
tech-stack:
  added: ["@azure/msal-browser ^3.x (NAA)", "jwks-rsa ^3.x", "webpack ^5.x", "ts-loader", "html-webpack-plugin", "copy-webpack-plugin", "office-addin-dev-certs", "@types/office-js"]
  patterns: ["NAA (Nested App Authentication) with createNestablePublicClientApplication", "JWKS-based Azure AD token validation", "Composite auth middleware (SSO or Cookie)", "Multi-origin CORS with origin callback function", "Webpack DefinePlugin for build-time env injection"]

key-files:
  created:
    - addin/package.json
    - addin/tsconfig.json
    - addin/webpack.config.cjs
    - addin/manifest.xml
    - addin/src/taskpane/taskpane.html
    - addin/src/taskpane/taskpane.tsx
    - addin/src/commands/commands.html
    - addin/src/commands/commands.ts
    - addin/src/types/index.ts
    - addin/src/auth/msalConfig.ts
    - addin/src/auth/authHelper.ts
    - addin/src/api/backendClient.ts
    - backend/src/auth/ssoMiddleware.ts
    - addin/assets/icon-16.png
    - addin/assets/icon-32.png
    - addin/assets/icon-80.png
  modified:
    - backend/package.json
    - backend/src/config/index.ts
    - backend/src/middleware/security.ts
    - backend/src/auth/routes.ts

key-decisions:
  - "IPublicClientApplication interface (not PublicClientApplication class) for MSAL NAA instance type -- createNestablePublicClientApplication returns the interface type"
  - "webpack.config.cjs (not .js) because package.json uses type:module ESM but webpack config requires CommonJS"
  - "CORS uses origin callback function instead of string array -- allows no-origin requests (non-browser clients) alongside both allowed origins"
  - "requireSsoOrCookieAuth composite middleware checks Authorization header presence to select auth strategy"

patterns-established:
  - "NAA SSO: createNestablePublicClientApplication + acquireTokenSilent with acquireTokenPopup fallback"
  - "Dual auth: requireSsoOrCookieAuth checks Bearer header to delegate to SSO or cookie middleware"
  - "JWKS validation: jwksClient with cache+rateLimit for Azure AD key rotation"
  - "Add-in API client: getAccessToken() then attach Bearer header to all fetch calls"

requirements-completed: [PLUG-01, PLUG-04]

# Metrics
duration: 5min
completed: 2026-02-18
---

# Phase 8 Plan 1: Outlook Add-in Scaffold Summary

**Outlook Add-in package with XML manifest, webpack build, MSAL NAA SSO auth, backend JWKS token validation, and multi-origin CORS**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-18T04:27:15Z
- **Completed:** 2026-02-18T04:32:45Z
- **Tasks:** 2
- **Files modified:** 20

## Accomplishments
- Scaffolded addin/ package at project root with webpack build producing taskpane.html, commands.html, and icon assets
- Implemented MSAL NAA authentication with createNestablePublicClientApplication for silent+popup token flow
- Created backend SSO middleware validating Azure AD Bearer tokens via JWKS with composite requireSsoOrCookieAuth
- Updated CORS to allow both frontend and add-in origins; /auth/me accepts both cookie and Bearer auth

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold addin/ package with manifest, webpack, and Office.js entry points** - `312729c` (feat)
2. **Task 2: Implement NAA SSO auth in add-in and backend SSO middleware with CORS update** - `c86f48d` (feat)

## Files Created/Modified

### Created
- `addin/package.json` - Add-in package with MSAL, React, Webpack dependencies
- `addin/tsconfig.json` - TypeScript config targeting ES2020 with office-js types
- `addin/webpack.config.cjs` - Webpack config with dual entry points, HTTPS dev server, DefinePlugin
- `addin/manifest.xml` - Office Add-in XML manifest with MessageReadCommandSurface ribbon button
- `addin/src/taskpane/taskpane.html` - Taskpane HTML with Office.js CDN script
- `addin/src/taskpane/taskpane.tsx` - React entry point gated behind Office.onReady()
- `addin/src/commands/commands.html` - Headless function commands HTML
- `addin/src/commands/commands.ts` - Function command registration (showTaskpane placeholder)
- `addin/src/types/index.ts` - Domain types (SenderInfo, MailboxInfo, ActionResult, WhitelistAction, ActionScope)
- `addin/src/auth/msalConfig.ts` - MSAL NAA config with createNestablePublicClientApplication
- `addin/src/auth/authHelper.ts` - Token acquisition with silent+popup fallback and NAA support check
- `addin/src/api/backendClient.ts` - Authenticated HTTP client for MSEDB backend API
- `backend/src/auth/ssoMiddleware.ts` - SSO middleware with JWKS validation and composite auth
- `addin/assets/icon-{16,32,80}.png` - Placeholder blue square icons

### Modified
- `backend/package.json` - Added jwks-rsa dependency
- `backend/src/config/index.ts` - Added addinUrl config field
- `backend/src/middleware/security.ts` - CORS updated to multi-origin with callback function
- `backend/src/auth/routes.ts` - /auth/me uses requireSsoOrCookieAuth instead of requireAuth

## Decisions Made
- Used IPublicClientApplication interface type (not class) for MSAL instance -- createNestablePublicClientApplication returns this interface, not the concrete class
- Named webpack config .cjs (not .js) because package.json has "type": "module" but webpack config needs CommonJS require()
- CORS uses origin callback function (not string/array) to handle no-origin requests alongside multi-origin support
- Composite middleware delegates auth strategy based on Authorization header presence (Bearer = SSO, absent = cookie)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Renamed webpack.config.js to webpack.config.cjs**
- **Found during:** Task 1 (Scaffold addin/ package)
- **Issue:** package.json has "type": "module" causing webpack.config.js to be treated as ESM, but webpack config uses CommonJS require()
- **Fix:** Renamed to webpack.config.cjs and updated build/start scripts to use --config webpack.config.cjs
- **Files modified:** addin/webpack.config.cjs (renamed), addin/package.json (scripts updated)
- **Verification:** npm run build succeeds
- **Committed in:** 312729c (Task 1 commit)

**2. [Rule 1 - Bug] Fixed MSAL instance type from PublicClientApplication to IPublicClientApplication**
- **Found during:** Task 2 (NAA auth implementation)
- **Issue:** createNestablePublicClientApplication returns IPublicClientApplication (interface), not PublicClientApplication (class). TypeScript error: Property 'controller' missing
- **Fix:** Changed import and type annotations to use IPublicClientApplication
- **Files modified:** addin/src/auth/msalConfig.ts
- **Verification:** npm run build succeeds without type errors
- **Committed in:** c86f48d (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes required for build success. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required

The add-in requires Azure AD app registration updates before SSO will function. From the plan's user_setup section:

1. Add SPA platform with redirect URI `brk-multihub://localhost:3000` in Azure Portal
2. Expose API with scope `access_as_user` on the MSEDB app registration
3. Pre-authorize Office client ID `ea5a67f6-b6f3-4338-b240-c655ddc3cc8e`
4. Set Application ID URI to `api://localhost:3000/{client-id}`
5. Set `ADDIN_URL` environment variable in backend .env

## Next Phase Readiness
- Add-in package builds successfully, ready for feature UI in Plan 08-02
- Backend SSO middleware ready to authenticate add-in API requests
- CORS configured for add-in origin
- Manifest ready for sideloading (after Azure AD setup)

## Self-Check: PASSED

- All 16 created files verified on disk
- Both task commits (312729c, c86f48d) verified in git log

---
*Phase: 08-outlook-add-in*
*Completed: 2026-02-18*
