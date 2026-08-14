# MSEDB — security lens — 2026-08-13

Repo-wide sweep, branch `audit/2026-08-13`. Every finding below was confirmed by opening
the file, not by grep alone. No committed secret was found (`.env` is untracked;
`.env.example` holds placeholders only — verified by reading the file and a count-only
grep for `KEY=<value>` assignment patterns across tracked source).

## Findings

### SEC-01 · HIGH · security · impact H / effort L · status: OPEN
**Where:** `backend/src/routes/webhooks.ts:47-49`
**Claim:** `POST /webhooks/graph` is a public, unauthenticated endpoint that passes attacker-controlled `notification.subscriptionId` straight into a Mongoose filter (`WebhookSubscription.findOne({ subscriptionId: notification.subscriptionId })`) with no type check, so a JSON object (e.g. `{"$ne": null}`) instead of a string is accepted as a valid query operator.
**Why it matters:** Classic NoSQL injection on a public route — an attacker can force the lookup to match an arbitrary subscription document instead of a specific one. The subsequent `clientState` equality check still gates full notification forgery, but the injection itself is real and this is exactly the class of bug the app's own pattern elsewhere (typeof-checking every query-derived filter field) exists to prevent.
**Fix:** In `webhooks.ts`, before the `findOne` call, require `typeof notification.subscriptionId === 'string'` (and skip/log otherwise), matching the type-guard pattern already used throughout `patterns.ts`/`events.ts`.
**Verifier:** `grep -q "typeof notification.subscriptionId === 'string'" backend/src/routes/webhooks.ts` — exit 1 now, exit 0 once the guard is added.
**Eligible for --fix:** yes

### SEC-02 · HIGH · security · impact M / effort L · status: OPEN
**Where:** `backend/src/routes/events.ts:106, 403, 546`
**Claim:** Three handlers (`GET /api/events` folder filter, `POST /api/events/summarize-today`, `GET /api/events/summarize-today/csv`) resolve a mailbox with `Mailbox.find({ _id: mailboxId })` — `mailboxId` taken directly from `req.query`/`req.body` — with no `userId` scoping, unlike every other mailbox lookup in the codebase (`rules/*.ts`, `mailbox/*.ts`, `scheduledEmails.ts` all filter `{ _id, userId }`).
**Why it matters:** A user can pass another tenant's `mailboxId` and the app will happily read that mailbox's `email` field and use it to resolve Redis folder-cache keys and build the inbox filter for the request — an IDOR against the mailbox-ownership boundary the rest of the app enforces consistently. Current blast radius is contained (the actual `EmailEvent` query stays scoped to the caller's own `userId`), but it's an authorization-boundary violation, not a hardening nice-to-have, and matches the exact "does user A's request touch user B's mailbox by id" class called out as highest-value here.
**Fix:** Add `userId` to all three `Mailbox.find({ _id: mailboxId })` calls in `events.ts`, mirroring `rules/execute.ts:40` (`Mailbox.findOne({ _id: mailboxId, userId })`).
**Verifier:** `test "$(grep -c 'Mailbox.find({ _id: mailboxId })' backend/src/routes/events.ts)" -eq 0` — currently prints `3` (fails), passes (count 0) once all three calls add `userId`.
**Eligible for --fix:** yes

### SEC-03 · MEDIUM · security · impact M / effort M · status: OPEN
**Where:** `backend/package-lock.json`, `frontend/package-lock.json`
**Claim:** `npm audit --omit=dev --json` reports 8 high-severity advisories in backend production dependencies (`ws`, `socket.io-parser`, `engine.io`, `lodash`, `path-to-regexp`, `undici`, `brace-expansion`, `ip-address` via `geoip-lite`) and 4 high-severity in frontend (`lodash`, `react-router`, `socket.io-parser`, `ws`), plus several moderate/low.
**Why it matters:** `ws`/`socket.io-parser`/`engine.io` sit directly on the app's real-time Socket.IO transport (`backend/src/config/socket.ts`, used by every connected client) — a DoS/parsing-confusion CVE there is reachable by any authenticated (or in some advisories, unauthenticated) socket client, not a theoretical transitive risk.
**Fix:** Run `npm audit fix` in `backend/` and `frontend/` for the non-major bumps, then evaluate the semver-major ones (`ws`, `react-router`, `@azure/msal-node`) individually with the test suite.
**Verifier:** `cd backend && npm audit --omit=dev --audit-level=high` — currently exits non-zero (8 high vulns), exits 0 once resolved. Same command in `frontend/`.
**Eligible for --fix:** yes (patch/minor bumps only; treat major bumps as a separate, human-reviewed step)

### SEC-04 · MEDIUM · security · impact H / effort — · status: DEFERRED (confirm DGX firewall/Tailscale ACLs actually block ports 27020 and 6382 from the public internet; no code change possible from this repo)
**Where:** `docker-compose.yml:64-120`
**Claim:** MongoDB (host port 27020) runs with no `--auth`/root user configured anywhere in the compose file (no `MONGO_INITDB_ROOT_*` env, no init script, no `--auth` flag on the `mongod` command — the backend's `mongodb://msedb:$MONGO_PASSWORD@...?authSource=admin` URI carries credentials that mongod never actually enforces). Redis (host port 6382) explicitly runs with no password by design per the inline comment. Both ports are bound to all interfaces (`"27020:27017"`, `"6382:6379"`), not loopback-restricted the way the frontend's second port explicitly is (`"127.0.0.1:3011:8081"`).
**Why it matters:** This is a known, previously-flagged item — `docs/architecture-review.md` S12 (2026-07-06) already documented it as "confirmed intentional per commit d63cfc4" and flagged the same open question this finding raises: whether host/Tailscale-level firewalling is actually what stands between these two unauthenticated data stores and the public internet. Since Mongo is the shared JTCRM container (per this repo's own CLAUDE.md) and now correctly holds AES-256-GCM-encrypted Graph tokens (see Not doing/S1 below — already fixed), an open Mongo port has lower single-point impact than before, but Redis unauth + BullMQ job payloads + rate-limit counters are still fully exposed to anything that reaches the port.
**Fix:** Not a repo change — verify at the infra layer (DGX firewall / Tailscale ACL) that 27020 and 6382 are not internet-reachable, and record that confirmation in `deploy.md`/`RUNBOOK.md` so it stops being re-discovered on every audit.
**Verifier:** `NONE — human judgment` (infra-layer confirmation, not a repo-testable assertion)
**Eligible for --fix:** no

### SEC-05 · LOW · security · impact L / effort L · status: OPEN
**Where:** `backend/src/routes/health.ts:99-106`
**Claim:** `GET /api/health` decides whether to return extended diagnostics (`mongoHost`, BullMQ queue count, active webhook-subscription count, healthy-token count) based only on `!!req.cookies?.msedb_session || !!req.headers.authorization` — presence of a cookie/header, never a verified JWT. Health is mounted before `requireAuth`/rate limiters (`server.ts:53`) and is intentionally public per CLAUDE.md, so this is the one place in the app that deliberately skips real auth — but it still branches on a spoofable signal.
**Why it matters:** Any client can set `Cookie: msedb_session=x` (no valid token needed) to flip `hasAuth` to true and see infra details (Mongo host:port, queue/subscription/token counts) that are otherwise gated. Low impact (no secrets, no per-user data), but it's free reconnaissance for an attacker profiling the deployment.
**Fix:** Reuse `jwt.verify(cookieToken, config.jwtSecret)` (already imported pattern in `auth/middleware.ts`) instead of a truthy check, falling back to the minimal response on verification failure.
**Verifier:** `grep -q "jwt.verify" backend/src/routes/health.ts` — exit 1 now, exit 0 once real verification gates the extended payload.
**Eligible for --fix:** yes

### SEC-06 · MEDIUM · security · impact M / effort L · status: OPEN
**Where:** `backend/src/server.ts:52-59` (vs. rate limiters applied at `server.ts:76-77`)
**Claim:** `healthRouter`, `webhooksRouter`, and `trackingRouter` are mounted before the `/auth` (20/min) and `/api` (100/min) rate limiters are applied, and neither `/webhooks` nor `/track` is ever brought under any limiter — both are genuinely unauthenticated-by-design, but each request still does at least one MongoDB read/write (`WebhookSubscription.findOne` + BullMQ `add`, or `TrackedEmail.findOne`/`updateOne` in `trackingService.recordOpen`).
**Why it matters:** CLAUDE.md documents rate limiting as "20 req/min /auth, 100 req/min /api" but doesn't mention that the two other public, unauthenticated, DB-touching routes have no ceiling at all — a gap between the documented security posture and the actual one. An attacker can drive unlimited MongoDB writes through `/track/open/:id.png` (any UUID, no validation that it maps to a real tracked email) or unlimited enqueue attempts through `/webhooks/graph` with no per-IP throttle.
**Fix:** Add a dedicated, generous (Graph/browser-realistic) `RedisStore`-backed limiter to `webhooksRouter` and `trackingRouter` mounts in `server.ts`, separate from the `/auth`/`/api` ones so legitimate Graph notification bursts aren't starved.
**Verifier:** `grep -B2 "app.use(webhooksRouter)" backend/src/server.ts | grep -qi "limiter"` — exit 1 now, exit 0 once a limiter precedes the mount.
**Eligible for --fix:** yes

### SEC-07 · LOW · security · impact L / effort L · status: OPEN
**Where:** `backend/src/auth/msalClient.ts:17-26` (`GRAPH_SCOPES`)
**Claim:** `Calendars.ReadWrite` is still requested in the OAuth consent scope list. A repo-wide case-insensitive grep for "calendar" outside `msalClient.ts` and tests returns zero matches — no feature reads or writes calendar data.
**Why it matters:** Over-broad consent for an app whose documented scopes (CLAUDE.md) are `Mail.Read`, `Mail.ReadWrite`, `MailboxSettings.ReadWrite`. This was already flagged in `docs/architecture-review.md` S2 (2026-07-06) and is still unfixed — every mailbox connected since then has granted calendar write access the app never uses, widening the blast radius of a token compromise for no functional benefit.
**Fix:** Remove `'Calendars.ReadWrite'` from `GRAPH_SCOPES` in `msalClient.ts`; existing mailboxes will drop the scope on next re-consent/reconnect.
**Verifier:** `test "$(grep -c "Calendars.ReadWrite" backend/src/auth/msalClient.ts)" -eq 0` — currently `1` (fails), passes once removed.
**Eligible for --fix:** yes

## Not doing (and why)

- **Graph token plaintext storage (prior review S1, 2026-07-06)** — re-verified by opening `backend/src/auth/msalClient.ts` (`MongoDBCachePlugin`) and `backend/src/utils/encryption.ts`: tokens are now correctly AES-256-GCM encrypted via `encryptTokenData`/`decryptTokenData` on every write, with a documented legacy-plaintext read fallback that re-encrypts on next write. **Already fixed** — not re-reported.
- **Requiring auth on every route** — verified every router under `backend/src/routes/` (including `mailbox/*` and `rules/*` sub-routers) either imports and applies `requireAuth`/`requireAdmin` or is one of the three documented exceptions (`health`, `webhooks`, `track`). No gap found; this is a PASS, not a finding.
- **CSRF coverage** — `validateCsrf` (`backend/src/middleware/csrf.ts`) is mounted globally after the CSRF-token route and correctly exempts only safe methods, Bearer-token (add-in) requests, `/webhooks`, and `/track` — all three exemptions are the documented public/non-cookie paths, not an over-broad list. PASS.
- **CORS** — `configureSecurityMiddleware` (`backend/src/middleware/security.ts`) uses an explicit `[appUrl, addinUrl]` allowlist with `credentials: true`, not a wildcard. PASS.
- **Committed secrets** — none found; `.env` is untracked, `.env.example` holds only placeholders/`openssl rand` instructions, and a count-only grep for inline secret assignments across tracked source returned zero matches. PASS — **no CRITICAL secret incident**.

## Checks

```csv
check_id,dim,status,score,max,note
SEC-CHK-01,security,PASS,5,5,no committed secret in tracked files; .env untracked, .env.example placeholders only
SEC-CHK-02,security,PASS,3,3,all routers apply requireAuth except documented health/webhooks/track
SEC-CHK-03,security,FAIL,0,3,SEC-02 IDOR: events.ts resolves Mailbox by id without userId scope in 3 handlers
SEC-CHK-04,security,PASS,3,3,webhooks.ts validates Graph validationToken handshake and clientState before enqueue
SEC-CHK-05,security,FAIL,0,3,SEC-01 NoSQL injection: webhooks.ts subscriptionId used in Mongoose filter unsanitized
SEC-CHK-06,security,PASS,2,2,tracking pixel trackingId is an Express path param (string-only); no injection vector found
SEC-CHK-07,security,PASS,2,2,CSRF double-submit cookie middleware covers all non-GET routes; exemption list matches documented public routes only
SEC-CHK-08,security,PASS,2,2,CORS uses explicit origin allowlist (appUrl, addinUrl), not wildcard
SEC-CHK-09,security,PASS,2,2,session cookie httpOnly + sameSite=lax + secure-in-production; JWT verified with jsonwebtoken against server-side secret
SEC-CHK-10,security,PASS,3,3,Graph tokens encrypted at rest with AES-256-GCM (MongoDBCachePlugin); legacy-plaintext fallback re-encrypts on write
SEC-CHK-11,security,PASS,2,2,config.ts fails closed in production if encryptionKey/jwtSecret/sessionSecret missing or under 32 chars
SEC-CHK-12,security,PASS,2,2,rate limiters match documented 20/min auth, 100/min api (RedisStore-backed)
SEC-CHK-13,security,FAIL,0,2,SEC-06 /webhooks and /track are unauthenticated, DB-touching, and carry no rate limit at all
SEC-CHK-14,security,FAIL,0,1,SEC-05 /api/health branches on cookie/header presence, not a verified JWT, for extended diagnostics
SEC-CHK-15,security,FAIL,0,3,SEC-03 npm audit: 8 high-severity backend prod deps, 4 high-severity frontend prod deps
SEC-CHK-16,security,FAIL,0,1,SEC-07 Calendars.ReadWrite scope requested with zero calendar feature code (prior review S2, still open)
SEC-CHK-17,security,FAIL,0,2,SEC-04 Mongo (27020) has no --auth configured anywhere in compose; Redis (6382) has no password by design; both bound to all interfaces — firewall reliance unconfirmed in-repo
SEC-CHK-18,security,PASS,1,1,helmet() applied for HTTP security headers
```
