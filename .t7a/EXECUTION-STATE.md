---
date: 2026-04-08
branch: taj/t7fix (created from main at ffafdc1)
status: NOT STARTED - all files read, no edits made yet
---

# T7A Execution State — Resume Guide

## Branch
`taj/t7fix` — created, clean, no changes yet.

## What Was Done
- Created 23 tasks (P0 through P2)
- Read ALL source files needed for every fix
- No code changes made yet

## Files Read & Key Line Numbers

### P0 Fixes (do these first)

**1. MongoDB auth** — `docker-compose.yml:64-85`
- Add `MONGO_INITDB_ROOT_USERNAME: msedb` and `MONGO_INITDB_ROOT_PASSWORD: ${MONGO_PASSWORD}` to mongo service environment
- Update `config/index.ts:36` mongodbUri default to include credentials
- Update `.env.example` with MONGO_PASSWORD

**2. Redis auth + eviction** — `docker-compose.yml:87-108`
- Change line 102 command: add `--requirepass ${REDIS_PASSWORD}`
- Change `noeviction` to `allkeys-lru` on line 102
- Update `config/redis.ts` — add `password: config.redisPassword` to all 3 connection functions (lines 13, 26, 38-41)
- Add `redisPassword` to `config/index.ts`

**3. Rate limiter ordering** — `server.ts:127-128`
- Move these two lines to BEFORE line 50 (after cookieParser on line 47)
- But they need Redis... so move them to after Redis verification (line 121) but BEFORE route mounting
- Actually: restructure startServer() to apply rate limiters, then mount routes. Or move route mounting into startServer() after rate limiters.
- SIMPLEST FIX: Move lines 50-107 (all route mounting) into startServer() after line 128.

**4. Docker socket mount** — `docker-compose.yml:22`
- Remove `- /var/run/docker.sock:/var/run/docker.sock:ro` from volumes
- Remove docker group from `backend/Dockerfile:12` — change to just `addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup`
- Check if tunnelService.ts is used — if so, it will break. May need to gut tunnel management or make it optional.

**5. Secret validation** — `config/index.ts:46-48`
- Add after the config object (after line 75): validate that encryptionKey, jwtSecret, sessionSecret are non-empty and >= 32 chars. Throw on failure.

**6. Tests** — Create `backend/src/services/__tests__/ruleEngine.test.ts` and `backend/src/services/__tests__/actionExecutor.test.ts`
- ruleEngine: test matchesConditions() — pure function, no mocks needed
- actionExecutor: test executeActions() — needs mocks for graphFetch, Rule.findByIdAndUpdate, AuditLog.create, createStagedEmail, ensureStagingFolder

### P1 Fixes

**7. Pattern engine N+1** — `patternEngine.ts:549-555`
- Replace per-sender getRecencyStats() calls with batch aggregation
- Single aggregation: group by {senderEmail, eventType} with 7-day window, return all at once

**8. Redis N+1 in events** — `events.ts:133-161`
- Replace individual redis.get() calls in nested loop with redis.mget() batch
- Collect all keys first, batch fetch, then map results

**9. Unbounded $nin** — `events.ts:88-98`
- Appears 3 times: lines 90-97, lines 428-435, lines 583-589
- Replace with aggregation pipeline using $lookup or add isDeleted flag to EmailEvent

**10. Lazy loading** — `App.tsx:11-23`
- Replace 13 eager imports with React.lazy()
- Add Suspense wrapper with LoadingSpinner fallback

**11. Staging page info** — `StagingPage.tsx:90-103`
- StagedEmail type needs sender/subject/date fields from backend
- Check `api/staging.ts` and backend `routes/staging.ts` to see if these fields exist
- If not, add them to the backend response

**12. Graph timeout** — `graphClient.ts:48`
- Add AbortController: `const controller = new AbortController(); setTimeout(() => controller.abort(), 30000);`
- Pass `signal: controller.signal` to fetch options

**13. Health endpoint** — `routes/health.ts:98-118`
- Return only `{status, version}` for unauthenticated requests
- Gate detailed info behind requireAuth (optional auth check)

**14. Missing indexes** — Add to model files:
- `EmailEvent.ts`: add `emailEventSchema.index({ messageId: 1, timestamp: -1 });`
- `AuditLog.ts`: add `auditLogSchema.index({ action: 1, mailboxId: 1, createdAt: -1 });`
- `Rule.ts`: add `ruleSchema.index({ userId: 1, 'conditions.senderEmail': 1 });`

**15. Duplicate Actions header** — `StagingPage.tsx:376`
- Rename second "Actions" to "Controls" or similar

### P2 Fixes

**16. Hardcoded mailbox tags** — `RulesPage.tsx:39-44`
- Replace EMAIL_TAGS const with dynamic list from `useAuthStore((s) => s.mailboxes)`
- Build tags as `[{label: 'All', email: null}, ...mailboxes.map(m => ({label: m.email.split('@')[0], email: m.email}))]`

**17. Hardcoded IP** — `auth/middleware.ts:57`
- Replace `api://172.16.219.222:3010/${config.azureAdClientId}` with `api://${config.appUrl.replace(/^https?:\/\//, '')}/${config.azureAdClientId}` or add a new config field `azureAdAudience`

**18. Nginx cache headers** — `nginx.conf`
- Add before SPA location in BOTH server blocks:
```
location ~* \.(js|css|woff2?|png|svg|ico)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

**19. AuditLog TTL** — `AuditLog.ts` after line 74
- Add: `auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });`

**20. Deactivated user JWT** — `auth/middleware.ts:113-116`
- After JWT verify succeeds, add: `const user = await User.findById(decoded.userId).select('isActive'); if (user?.isActive === false) throw new UnauthorizedError('Account deactivated');`

**21. toggleIconSize reload** — `uiStore.ts:59-63`
- Replace `window.location.reload()` with just `set({ largeIcons: next })`

**22. Shared pagination** — Extract from StagingPage/AuditLogPage/PendingMessagesPage/RulesPage/PatternsPage
- Create `frontend/src/components/shared/Pagination.tsx`

**23. Rule creation race** — `rules.ts:157-189`
- Add compound index on Rule: `{userId, mailboxId, 'conditions.senderEmail', actionTypes}` or use findOneAndUpdate with upsert
