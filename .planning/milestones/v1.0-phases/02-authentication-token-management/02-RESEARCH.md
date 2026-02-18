# Phase 2: Authentication & Token Management - Research

**Researched:** 2026-02-17
**Domain:** Azure AD OAuth 2.0, MSAL Node, JWT sessions, encrypted token persistence, multi-mailbox architecture
**Confidence:** HIGH

## Summary

Phase 2 implements the full authentication stack: Azure AD OAuth 2.0 SSO via MSAL Node's `ConfidentialClientApplication`, JWT session management with httpOnly cookies, role-based access control (Admin/User), encrypted token storage with AES-256-GCM (already built in Phase 1), MSAL cache persistence to MongoDB via a custom `ICachePlugin`, a proactive token refresh BullMQ job (scheduler already registered in Phase 1), and a multi-mailbox connection flow where a single user can connect multiple Microsoft 365 mailboxes with independent token sets.

The architecture is shaped by two critical constraints: (1) MSAL manages its own internal token cache (access tokens, refresh tokens, ID tokens, account metadata) and requires an `ICachePlugin` to persist this cache across container restarts, and (2) multi-mailbox support means each connected mailbox needs its own MSAL cache partition keyed by `homeAccountId`, stored in the existing `Mailbox` model's `msalCache` field. The User model authenticates the MSEDB session; the Mailbox model holds per-mailbox Graph API credentials.

**Primary recommendation:** Use `@azure/msal-node` (latest v3.x stable -- v3.8.7) for OAuth flows with a custom `ICachePlugin` that partitions cache per-mailbox in MongoDB. Use `jsonwebtoken` for JWT session tokens stored in httpOnly cookies. Do NOT use MSAL v5.x (breaking changes with NodeStorage removal, too new for production stability). Do NOT hand-roll OAuth flows -- MSAL handles PKCE, token caching, silent renewal, and retry logic.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AUTH-01 | Azure AD OAuth 2.0 SSO via MSAL -- redirect to Microsoft login, handle callback, issue JWT | MSAL `getAuthCodeUrl()` + `acquireTokenByCode()` flow; `ConfidentialClientApplication` with tenant-scoped authority; JWT issued after successful token exchange |
| AUTH-02 | JWT session management with httpOnly cookies, requireAuth middleware | `jsonwebtoken` for sign/verify; `cookie-parser` middleware; httpOnly+Secure+SameSite cookie settings; middleware reads cookie and attaches `req.user` |
| AUTH-03 | Admin invite by email, RBAC (Admin/User), requireAdmin middleware | User model already has `role` field and `invitedBy` ref; first login with `ADMIN_EMAIL` gets admin role; requireAdmin checks `req.user.role === 'admin'` |
| AUTH-04 | Encrypted token storage (AES-256-GCM), MSAL cache persisted to MongoDB via ICachePlugin | Encryption utility already built; ICachePlugin implementation uses `beforeCacheAccess`/`afterCacheAccess` with `tokenCache.serialize()`/`deserialize()`; partition by mailbox `homeAccountId` |
| AUTH-05 | Token lifecycle: proactive refresh every 45 min, background health monitoring, re-auth on expired refresh token | BullMQ `token-refresh` scheduler already exists; worker calls `acquireTokenSilent()` per mailbox; on failure (refresh token expired), marks mailbox as disconnected |
| AUTH-06 | Multi-mailbox per user: separate OAuth consent flows per mailbox, independent tokens/webhooks/sync | Each mailbox gets its own `Mailbox` document with `encryptedTokens` and `msalCache`; connect flow uses `prompt: 'select_account'` or `login_hint` to target specific Microsoft account |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@azure/msal-node` | ^3.8.7 | MSAL ConfidentialClientApplication for OAuth 2.0 auth code flow | Official Microsoft library; handles PKCE, token caching, silent renewal, retry logic; ICachePlugin interface for persistence |
| `jsonwebtoken` | ^9.0.2 | Sign and verify JWT session tokens | Battle-tested, 82 versions, widely used in Express apps; sufficient for HMAC-SHA256 session tokens |
| `@types/jsonwebtoken` | ^9.0.9 | TypeScript types for jsonwebtoken | Required for strict TypeScript mode |
| `cookie-parser` | ^1.4.7 | Parse cookies from incoming requests | Required for httpOnly cookie-based JWT sessions |
| `@types/cookie-parser` | ^1.4.7 | TypeScript types for cookie-parser | Required for strict TypeScript mode |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `uuid` | ^11.0.5 | Generate state parameters and correlation IDs for OAuth flows | Already commonly used; crypto.randomUUID() is also available in Node 22 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `jsonwebtoken` | `jose` | `jose` is more modern (ESM, TypeScript native, JWE support) but `jsonwebtoken` is simpler for HMAC session tokens and the team knows it |
| `@azure/msal-node` v3.x | v5.x | v5 has breaking changes (NodeStorage no longer exported, Jan 2025); too new for production, v3.x is stable and well-documented |
| Custom ICachePlugin | `@azure/msal-node-extensions` | Extensions only provides file-based persistence (DPAPI on Windows, Keyring on Linux); not suitable for MongoDB/container environments |

**Installation:**
```bash
cd backend && npm install @azure/msal-node@^3 jsonwebtoken cookie-parser uuid && npm install -D @types/jsonwebtoken @types/cookie-parser
```

## Architecture Patterns

### Recommended Project Structure
```
backend/src/
├── auth/
│   ├── msalClient.ts         # ConfidentialClientApplication factory + ICachePlugin
│   ├── routes.ts              # /auth/login, /auth/callback, /auth/logout, /auth/me
│   ├── middleware.ts          # requireAuth, requireAdmin
│   └── tokenManager.ts       # Token encryption/decryption, acquireTokenSilent wrapper
├── routes/
│   ├── admin.ts               # /api/admin/* user management routes
│   └── mailbox.ts             # /api/mailboxes/* connect/disconnect/list routes
├── jobs/
│   ├── processors/
│   │   └── tokenRefresh.ts    # Token refresh BullMQ worker processor
│   └── ...existing...
└── middleware/
    └── ...existing...
```

### Pattern 1: MSAL ConfidentialClientApplication with Per-Mailbox ICachePlugin
**What:** A single CCA instance with a custom ICachePlugin that partitions the MSAL cache per-mailbox using MongoDB.
**When to use:** For all Graph API token operations (login, silent renewal, token refresh).
**Example:**
```typescript
// Source: Microsoft Learn - Token caching in MSAL Node
// https://learn.microsoft.com/en-us/entra/msal/javascript/node/caching

import { ConfidentialClientApplication, ICachePlugin, TokenCacheContext } from '@azure/msal-node';
import { Mailbox } from '../models/Mailbox.js';

class MongoDBCachePlugin implements ICachePlugin {
  private mailboxId: string;

  constructor(mailboxId: string) {
    this.mailboxId = mailboxId;
  }

  async beforeCacheAccess(cacheContext: TokenCacheContext): Promise<void> {
    const mailbox = await Mailbox.findById(this.mailboxId).select('msalCache');
    if (mailbox?.msalCache) {
      cacheContext.tokenCache.deserialize(mailbox.msalCache);
    }
  }

  async afterCacheAccess(cacheContext: TokenCacheContext): Promise<void> {
    if (cacheContext.cacheHasChanged) {
      await Mailbox.findByIdAndUpdate(this.mailboxId, {
        msalCache: cacheContext.tokenCache.serialize(),
      });
    }
  }
}

// Factory: create CCA with mailbox-specific cache
function createMsalClient(mailboxId: string): ConfidentialClientApplication {
  return new ConfidentialClientApplication({
    auth: {
      clientId: config.azureAdClientId,
      authority: `https://login.microsoftonline.com/${config.azureAdTenantId}`,
      clientSecret: config.azureAdClientSecret,
    },
    cache: {
      cachePlugin: new MongoDBCachePlugin(mailboxId),
    },
  });
}
```

### Pattern 2: OAuth Authorization Code Flow for Login
**What:** Two-step flow: (1) redirect user to Azure AD via `getAuthCodeUrl()`, (2) exchange auth code for tokens via `acquireTokenByCode()` in the callback.
**When to use:** Initial user login and connecting new mailboxes.
**Example:**
```typescript
// Source: Microsoft Learn - Acquiring tokens in MSAL Node
// https://learn.microsoft.com/en-us/entra/msal/javascript/node/acquire-token-requests

// Step 1: Generate auth URL
const authCodeUrlParams = {
  scopes: ['User.Read', 'Mail.ReadWrite', 'Mail.Send', 'MailboxSettings.ReadWrite', 'offline_access'],
  redirectUri: `${config.apiUrl}/auth/callback`,
  prompt: 'select_account',  // Force account picker for multi-mailbox
  state: JSON.stringify({ userId: req.user?.id, action: 'connect_mailbox' }),
};
const authUrl = await msalClient.getAuthCodeUrl(authCodeUrlParams);
res.redirect(authUrl);

// Step 2: Exchange code for tokens in callback
const tokenResponse = await msalClient.acquireTokenByCode({
  code: req.query.code as string,
  scopes: ['User.Read', 'Mail.ReadWrite', 'Mail.Send', 'MailboxSettings.ReadWrite', 'offline_access'],
  redirectUri: `${config.apiUrl}/auth/callback`,
});
// tokenResponse contains: accessToken, account (with homeAccountId), idToken, expiresOn
```

### Pattern 3: JWT httpOnly Cookie Session
**What:** After successful OAuth, issue a JWT containing the user's MongoDB ID and role, stored in an httpOnly cookie.
**When to use:** All authenticated API requests.
**Example:**
```typescript
// Source: Express.js httpOnly cookie pattern
// https://www.wisp.blog/blog/ultimate-guide-to-securing-jwt-authentication-with-httponly-cookies

import jwt from 'jsonwebtoken';

// After successful login:
const token = jwt.sign(
  { userId: user._id, email: user.email, role: user.role },
  config.jwtSecret,
  { expiresIn: '24h' }
);

res.cookie('msedb_session', token, {
  httpOnly: true,
  secure: config.nodeEnv === 'production',
  sameSite: 'lax',
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
  path: '/',
});
```

### Pattern 4: Silent Token Renewal via acquireTokenSilent
**What:** Use MSAL's `acquireTokenSilent()` to get fresh access tokens from cache without user interaction.
**When to use:** In the token refresh BullMQ job and before any Graph API call.
**Example:**
```typescript
// Source: Microsoft Learn - Token caching in MSAL Node
// https://learn.microsoft.com/en-us/entra/msal/javascript/node/caching

async function getAccessTokenForMailbox(mailboxId: string): Promise<string> {
  const mailbox = await Mailbox.findById(mailboxId);
  if (!mailbox) throw new Error('Mailbox not found');

  const msalClient = createMsalClient(mailboxId);
  const tokenCache = msalClient.getTokenCache();
  const account = await tokenCache.getAccountByHomeId(mailbox.homeAccountId);

  if (!account) throw new Error('Account not found in cache -- re-authentication required');

  const silentResult = await msalClient.acquireTokenSilent({
    account,
    scopes: ['Mail.ReadWrite', 'Mail.Send', 'MailboxSettings.ReadWrite'],
  });

  return silentResult.accessToken;
}
```

### Pattern 5: Multi-Mailbox Connection Flow
**What:** When a user wants to connect an additional mailbox, initiate a new OAuth flow with `prompt: 'select_account'` or `login_hint` set to the target email.
**When to use:** Adding second/third mailboxes after initial login.
**Example:**
```typescript
// Connect additional mailbox flow:
// 1. User clicks "Connect another mailbox" in UI
// 2. Frontend calls POST /api/mailboxes/connect
// 3. Backend generates auth URL with prompt: 'select_account'
// 4. User authenticates with DIFFERENT Microsoft account
// 5. Callback creates new Mailbox document linked to same User
// 6. MSAL cache is stored per-Mailbox, not per-User

// In callback, differentiate login vs. connect:
const stateData = JSON.parse(req.query.state as string);
if (stateData.action === 'connect_mailbox') {
  // Create new Mailbox document
  const mailbox = await Mailbox.create({
    userId: stateData.userId,
    email: tokenResponse.account.username,
    displayName: tokenResponse.account.name,
    homeAccountId: tokenResponse.account.homeAccountId,
    tenantId: tokenResponse.account.tenantId,
    isConnected: true,
  });
  // Encrypt and store tokens on the Mailbox
  await storeMailboxTokens(mailbox._id, tokenResponse);
} else {
  // Initial login -- create/update User
}
```

### Anti-Patterns to Avoid
- **Storing MSAL cache on User model for multi-mailbox:** Each mailbox has its own Microsoft account with its own tokens. MSAL cache MUST be per-mailbox, not per-user.
- **Using localStorage for JWT on frontend:** The PRD specifies httpOnly cookies. Tokens in localStorage are vulnerable to XSS.
- **Calling Graph API with user's access token directly:** Always go through `acquireTokenSilent()` which handles token refresh automatically. Never cache access tokens yourself.
- **Single CCA instance without cache plugin:** In-memory cache is lost on container restart. Every restart forces all users to re-authenticate.
- **Exposing refresh tokens to client:** MSAL explicitly hides refresh tokens. Never send them to the frontend.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OAuth 2.0 auth code flow | Custom HTTP calls to /authorize and /token | `@azure/msal-node` ConfidentialClientApplication | MSAL handles PKCE, state validation, nonce, token caching, retry, error codes |
| Token refresh | Custom timer + raw HTTP POST to /token | `acquireTokenSilent()` from MSAL | MSAL manages refresh token rotation, expiry checks, cache updates atomically |
| Token cache serialization | Custom JSON serialization of tokens | `ICachePlugin` with `tokenCache.serialize()`/`deserialize()` | MSAL's internal cache format includes account metadata, ID tokens, and cache version -- custom serialization breaks it |
| JWT creation/verification | Custom crypto operations | `jsonwebtoken` sign/verify | Handles algorithm validation, expiry, clock skew, malformed token errors |
| Cookie security | Manual Set-Cookie headers | `cookie-parser` + `res.cookie()` | Handles encoding, path scoping, secure flag, sameSite correctly |

**Key insight:** MSAL is opinionated about token management. Fighting it (e.g., extracting refresh tokens and managing them yourself) leads to subtle bugs when MSAL rotates refresh tokens or changes cache format. Let MSAL own the token lifecycle; persist its cache to MongoDB.

## Common Pitfalls

### Pitfall 1: MSAL Cache Lost on Container Restart
**What goes wrong:** All users must re-authenticate after `docker restart msedb-backend` because MSAL's in-memory cache is lost.
**Why it happens:** Default MSAL cache is in-memory only. No persistence means no cached accounts or refresh tokens after restart.
**How to avoid:** Implement `ICachePlugin` that persists to MongoDB. The `afterCacheAccess` callback fires after every token operation and saves the serialized cache. The `beforeCacheAccess` callback loads it before any token lookup.
**Warning signs:** After restart, `acquireTokenSilent()` throws "No cached accounts found" or "no_tokens_found".

### Pitfall 2: Per-User vs Per-Mailbox Cache Partition
**What goes wrong:** Multi-mailbox users lose access to one mailbox's tokens when another mailbox's cache overwrites it.
**Why it happens:** Using a single MSAL cache (keyed by userId) for a user with multiple Microsoft accounts. MSAL stores tokens keyed by `homeAccountId`, but if the cache is shared across different CCA instances, deserialization can be unpredictable.
**How to avoid:** Each `Mailbox` document has its own `msalCache` field. Create a new `MongoDBCachePlugin` instance per-mailbox. The partition key is the mailbox MongoDB `_id`.
**Warning signs:** After connecting a second mailbox, the first mailbox's `acquireTokenSilent()` fails.

### Pitfall 3: State Parameter Tampering in OAuth Flow
**What goes wrong:** Attacker initiates OAuth flow, intercepts callback, and substitutes their own auth code to hijack another user's session.
**Why it happens:** Missing or unvalidated `state` parameter in the OAuth flow.
**How to avoid:** Generate a cryptographic random `state` value before redirect. Store it in a server-side map (Redis or signed value). On callback, verify the returned `state` matches. Encode `action` (login vs connect_mailbox) and `userId` in the state.
**Warning signs:** CSRF attacks on the callback endpoint.

### Pitfall 4: JWT in Cookie Not Sent Cross-Origin
**What goes wrong:** Frontend on `localhost:3010` cannot read cookies set by backend on `localhost:8010`.
**Why it happens:** Different ports = different origins. `SameSite=Strict` blocks cross-origin cookies. Missing `credentials: 'include'` in fetch calls.
**How to avoid:** Set `SameSite=Lax` (not Strict). In CORS config, set `credentials: true` (already done in Phase 1 security middleware). Frontend fetch calls must include `credentials: 'include'`. In production (behind nginx proxy), frontend and backend share the same origin -- no cross-origin issues.
**Warning signs:** Cookie is set but not sent with subsequent API requests.

### Pitfall 5: Refresh Token Expiration Without Re-Auth Flow
**What goes wrong:** After 90 days of inactivity (or Azure AD policy), the refresh token expires. `acquireTokenSilent()` fails with "interaction_required". No way to recover without user action.
**Why it happens:** Refresh tokens have limited lifetimes. Azure AD single-tenant apps typically get 90-day refresh tokens.
**How to avoid:** The token refresh job should catch "interaction_required" errors and mark the mailbox as `isConnected: false`. Create a notification (using existing Notification model) telling the user to re-connect. The UI shows a "Reconnect" button that triggers a new OAuth consent flow.
**Warning signs:** Token refresh job logs "interaction_required" errors; Graph API calls start failing with 401.

### Pitfall 6: Race Condition in Concurrent Token Refresh
**What goes wrong:** Two simultaneous requests for the same mailbox both call `acquireTokenSilent()`, which triggers two refresh token exchanges. The second one fails because the refresh token was already rotated by the first.
**Why it happens:** MSAL rotates refresh tokens on use. Two concurrent refreshes race against each other.
**How to avoid:** Use a per-mailbox lock (Redis `SET NX EX`) before calling `acquireTokenSilent()`. Or centralize all token acquisition through the BullMQ token-refresh queue so it processes one mailbox at a time.
**Warning signs:** Intermittent "invalid_grant" errors in token refresh logs; works on retry.

### Pitfall 7: Admin Email Not Found on First Login
**What goes wrong:** The first user to log in is supposed to get admin role, but the email comparison fails due to case sensitivity or the user logs in with a different email alias.
**Why it happens:** Azure AD may return uppercase email or UPN instead of the expected lowercase email.
**How to avoid:** Normalize email to lowercase before comparison. Compare against `ADMIN_EMAIL` env var (also lowercased). Match on `microsoftId` (OID) after first login, not just email.
**Warning signs:** First user gets "user" role instead of "admin".

## Code Examples

Verified patterns from official sources:

### ConfidentialClientApplication Initialization
```typescript
// Source: https://learn.microsoft.com/en-us/entra/msal/javascript/node/caching
import { ConfidentialClientApplication, LogLevel } from '@azure/msal-node';
import { config } from '../config/index.js';

const msalConfig = {
  auth: {
    clientId: config.azureAdClientId,
    authority: `https://login.microsoftonline.com/${config.azureAdTenantId}`,
    clientSecret: config.azureAdClientSecret,
  },
  system: {
    loggerOptions: {
      loggerCallback: (level: LogLevel, message: string) => {
        if (level <= LogLevel.Warning) {
          logger.warn('MSAL', { level, message });
        }
      },
      piiLoggingEnabled: false,
      logLevel: LogLevel.Warning,
    },
  },
};
```

### requireAuth Middleware
```typescript
// Pattern: Express middleware for JWT verification from httpOnly cookie
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { UnauthorizedError } from './errorHandler.js';
import { config } from '../config/index.js';

interface JwtPayload {
  userId: string;
  email: string;
  role: 'admin' | 'user';
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.msedb_session;
  if (!token) {
    throw new UnauthorizedError('No session token');
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload;
    req.user = decoded;
    next();
  } catch {
    throw new UnauthorizedError('Invalid or expired session');
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    throw new ForbiddenError('Admin access required');
  }
  next();
}
```

### Token Encryption for Storage
```typescript
// The encryption utility from Phase 1 is used directly:
import { encrypt, decrypt } from '../utils/encryption.js';
import { config } from '../config/index.js';
import type { IEncryptedToken } from '../models/User.js';

export function encryptToken(plaintext: string): IEncryptedToken {
  return encrypt(plaintext, config.encryptionKey);
}

export function decryptToken(encryptedToken: IEncryptedToken): string {
  return decrypt(encryptedToken.encrypted, encryptedToken.iv, encryptedToken.tag, config.encryptionKey);
}
```

### Auth Callback Handler
```typescript
// Source: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
router.get('/auth/callback', async (req: Request, res: Response) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    logger.error('OAuth callback error', { error, error_description });
    return res.redirect(`${config.appUrl}/login?error=${error}`);
  }

  // Validate state parameter
  const stateData = validateState(state as string);
  if (!stateData) {
    return res.redirect(`${config.appUrl}/login?error=invalid_state`);
  }

  // Exchange code for tokens
  const tokenResponse = await msalClient.acquireTokenByCode({
    code: code as string,
    scopes: GRAPH_SCOPES,
    redirectUri: `${config.apiUrl}/auth/callback`,
  });

  const account = tokenResponse.account!;

  // Find or create user
  let user = await User.findOne({ microsoftId: account.localAccountId });
  if (!user) {
    user = await User.create({
      email: account.username.toLowerCase(),
      microsoftId: account.localAccountId,
      displayName: account.name,
      role: account.username.toLowerCase() === config.adminEmail.toLowerCase() ? 'admin' : 'user',
    });
  }

  // Issue JWT session
  const jwt = signJwt(user);
  setSessionCookie(res, jwt);

  // Redirect to frontend
  res.redirect(config.appUrl);
});
```

### Token Refresh BullMQ Worker
```typescript
// Processor for the existing token-refresh queue
import type { Job } from 'bullmq';
import { Mailbox } from '../models/Mailbox.js';
import { createMsalClient } from '../auth/msalClient.js';
import { Notification } from '../models/Notification.js';

export async function processTokenRefresh(job: Job): Promise<void> {
  // Find all connected mailboxes with tokens expiring in next 15 minutes
  const mailboxes = await Mailbox.find({
    isConnected: true,
    'encryptedTokens.expiresAt': { $lt: new Date(Date.now() + 15 * 60 * 1000) },
  });

  for (const mailbox of mailboxes) {
    try {
      const msalClient = createMsalClient(mailbox._id.toString());
      const tokenCache = msalClient.getTokenCache();
      const account = await tokenCache.getAccountByHomeId(mailbox.homeAccountId);

      if (!account) {
        await markMailboxDisconnected(mailbox, 'Account not found in cache');
        continue;
      }

      const result = await msalClient.acquireTokenSilent({
        account,
        scopes: GRAPH_SCOPES,
      });

      // Update expiry tracking
      await Mailbox.findByIdAndUpdate(mailbox._id, {
        'encryptedTokens.expiresAt': result.expiresOn,
      });
    } catch (err: unknown) {
      if (isInteractionRequired(err)) {
        await markMailboxDisconnected(mailbox, 'Refresh token expired');
        await Notification.create({
          userId: mailbox.userId,
          type: 'token_expiring',
          title: 'Mailbox disconnected',
          message: `Your mailbox ${mailbox.email} needs to be reconnected.`,
        });
      }
    }
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ADAL (Active Directory Auth Library) | MSAL (Microsoft Auth Library) | ADAL EOL June 2023 | Must use MSAL; ADAL tokens/cache incompatible |
| `@azure/msal-node` v1.x | v3.x (stable) | v2.0 in 2023, v3.0 in mid-2024 | v3.x is the recommended stable version |
| `@azure/msal-node` v3.x | v5.x (latest) | v5.0 Jan 2025 | v5 has breaking changes (NodeStorage removal); too new for production |
| BullMQ `repeat` option | `upsertJobScheduler` API | BullMQ v5 | Already using new API from Phase 1 |
| JWT in localStorage | JWT in httpOnly cookie | Security best practice 2024+ | Prevents XSS token theft |
| Session-based auth with express-session | JWT in httpOnly cookie | Architectural choice | JWT is stateless, scales better, no server-side session store needed |

**Deprecated/outdated:**
- **ADAL:** End of life June 2023. Do not use. MSAL is the replacement.
- **`@azure/msal-node` v1.x/v2.x:** Superseded by v3.x. v3 has the stable ICachePlugin interface.
- **`passport-azure-ad`:** Microsoft's official recommendation is MSAL directly, not Passport strategies.

## Open Questions

1. **MSAL v5 vs v3 for this project**
   - What we know: v5.0.4 is the latest npm version (released Jan 2025); v3.8.7 is the last v3.x (Feb 2025). v5 removed `NodeStorage` export (breaking change). All Microsoft docs reference v3.x patterns.
   - What's unclear: Whether v5 has other breaking changes that affect ICachePlugin. The changelog is incomplete.
   - Recommendation: Use v3.x (^3.8.7). It is well-documented, stable, and all sample code uses it. Pin with caret to get patches. Revisit v5 after more community adoption.

2. **Multi-mailbox: Same CCA or per-mailbox CCA?**
   - What we know: Microsoft recommends partitioning cache by `homeAccountId`. Each mailbox has a different Microsoft account (different `homeAccountId`).
   - What's unclear: Whether a single CCA with a cache plugin that switches partition based on context is cleaner than creating a new CCA per-mailbox.
   - Recommendation: Create a new CCA instance per-mailbox operation. CCA creation is lightweight (no network calls). Each instance gets its own `MongoDBCachePlugin` pointed at the right mailbox. This keeps partition logic simple and avoids shared-state bugs.

3. **State parameter storage: Redis vs signed JWT**
   - What we know: State must survive the redirect round-trip and be validated on callback. Options: (a) store random nonce in Redis with 10min TTL, (b) use a signed JWT as the state value encoding userId and action.
   - What's unclear: Whether MSAL adds its own state validation (it does generate its own nonce internally).
   - Recommendation: Use a signed JWT as the state parameter. It is self-contained, needs no Redis lookup, and encodes the necessary context (userId, action). Validate the JWT signature on callback. This is simpler and more resilient.

4. **Azure AD App Registration timing**
   - What we know: The app registration is NOT yet created in Azure AD. Phase 2 code cannot be end-to-end tested without it.
   - What's unclear: Nothing -- this is a known prerequisite.
   - Recommendation: The planner should include a clear prerequisite step for Azure AD app registration with exact permissions and redirect URIs. Code can be written and unit-tested without the registration, but integration testing requires it.

## Sources

### Primary (HIGH confidence)
- [Microsoft Learn - Token caching in MSAL Node](https://learn.microsoft.com/en-us/entra/msal/javascript/node/caching) - ICachePlugin interface, DistributedCachePlugin, partition key strategy, serialize/deserialize API (updated 2025-08-14)
- [Microsoft Learn - Acquiring tokens in MSAL Node](https://learn.microsoft.com/en-us/entra/msal/javascript/node/acquire-token-requests) - getAuthCodeUrl, acquireTokenByCode, acquireTokenSilent, auth code flow (updated 2025-08-14)
- [Microsoft Learn - OAuth 2.0 authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow) - /authorize parameters (login_hint, prompt, state), /token response format, refresh token flow, error codes
- [Microsoft Learn - messageRule resource type](https://learn.microsoft.com/en-us/graph/api/resources/messagerule?view=graph-rest-1.0) - messageRulePredicates (fromAddresses, senderContains, subjectContains), messageRuleActions
- [Microsoft Learn - Create messageRule](https://learn.microsoft.com/en-us/graph/api/mailfolder-post-messagerules?view=graph-rest-1.0) - POST /me/mailFolders/inbox/messageRules, MailboxSettings.ReadWrite permission
- [MSAL Node GitHub - caching.md](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-node/docs/caching.md) - ICachePlugin code examples, partition key scheme `<oid>.<tid>`
- [MSAL Node GitHub - auth-code-distributed-cache sample](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/samples/msal-node-samples/auth-code-distributed-cache/README.md) - DistributedCachePlugin with Redis, PartitionManager pattern

### Secondary (MEDIUM confidence)
- [npm - @azure/msal-node](https://www.npmjs.com/package/@azure/msal-node) - Latest version verification (v5.0.4 latest, v3.8.7 last v3.x)
- [npm - jsonwebtoken](https://www.npmjs.com/package/jsonwebtoken) - v9.0.2, sign/verify API, options
- [npm-compare - jose vs jsonwebtoken](https://npm-compare.com/jose,jsonwebtoken) - Library comparison for JWT handling
- [Medium - jose vs jsonwebtoken comparison](https://joodi.medium.com/jose-vs-jsonwebtoken-why-you-should-switch-4f50dfa3554c) - Tradeoff analysis

### Tertiary (LOW confidence)
- [MSAL Node GitHub - CHANGELOG.md](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-node/CHANGELOG.md) - v5.x breaking changes (NodeStorage removal); document was truncated and incomplete

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Libraries are official Microsoft (MSAL) and well-established (jsonwebtoken); versions verified on npm
- Architecture: HIGH - ICachePlugin pattern is documented by Microsoft with code examples; per-mailbox partition is the recommended approach for multi-account scenarios
- Pitfalls: HIGH - Token cache persistence, race conditions, and cross-origin cookies are well-documented issues with known solutions
- Multi-mailbox flow: MEDIUM - The login_hint/select_account pattern for connecting additional mailboxes is supported by OAuth spec but not explicitly documented in MSAL Node samples for this exact use case

**Research date:** 2026-02-17
**Valid until:** 2026-03-17 (30 days -- MSAL Node is stable, Azure AD patterns change slowly)
