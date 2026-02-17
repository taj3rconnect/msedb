# Pitfalls Research

**Domain:** Microsoft Graph Email Intelligence & Automation (Self-hosted Docker Compose)
**Researched:** 2026-02-16
**Confidence:** HIGH (verified against Microsoft official documentation and community reports)

---

## Critical Pitfalls

### Pitfall 1: Webhook Subscription Expiry Silently Kills Observation

**What goes wrong:**
Microsoft Graph mail subscriptions have a maximum lifetime of 7 days (10,080 minutes). Without rich notifications (includeResourceData), the max is 7 days; with rich notifications, only 1 day. If the renewal job fails even once -- due to a container restart, Redis outage, or BullMQ job stall -- the subscription expires silently. No error is raised. Emails simply stop being observed. The system appears healthy because all containers are running, but no new EmailEvent documents are being created.

**Why it happens:**
Developers set up a renewal job (e.g., every 2 hours) and assume it will always run. But BullMQ cron jobs depend on Redis being available at the exact scheduled moment. If Redis restarts, the cron schedule resets. If the backend container restarts mid-cycle, the next scheduled run might be skipped. The 2-hour renewal window provides only ~3 renewal attempts before the 7-day expiry, which sounds generous but is dangerously thin if the system is down for maintenance.

**How to avoid:**
1. Store `expirationDateTime` for each subscription in MongoDB (the `WebhookSubscription` model).
2. On every backend startup, immediately check all subscriptions and renew any expiring within 12 hours.
3. The renewal job should run every 2 hours AND on process start.
4. Implement a "subscription health" check in the `/health` endpoint that returns unhealthy if any subscription expires within 4 hours.
5. Set up a monitoring alert (via the notification system) when renewal fails.
6. Use `lifecycleNotificationUrl` on every subscription to receive `subscriptionRemoved` and `missed` lifecycle events -- this is the official Microsoft mechanism for detecting dropped subscriptions.

**Warning signs:**
- `email_events` collection stops growing for a specific user.
- Dashboard shows "Last sync" timestamp stale by more than 30 minutes.
- No webhook POST requests arriving in backend logs.
- Delta sync catches events that should have come via webhooks.

**Phase to address:**
Phase 1 (Webhook Infrastructure). The renewal logic, startup check, and `lifecycleNotificationUrl` must be implemented from day one. This is not deferrable.

---

### Pitfall 2: Delegated Permission Token Expiry Breaks Background Processing

**What goes wrong:**
MSEDB uses delegated permissions (`/me/messages`) which require a signed-in user context. Access tokens last ~1 hour. Refresh tokens last up to 90 days but expire due to inactivity after 90 days. When a refresh token expires, all background processing for that user (delta sync, webhook event fetching, rule execution) fails silently. The user must re-authenticate via the OAuth flow, but they have no idea this is needed unless the system explicitly tells them.

**Why it happens:**
Developers conflate "I have a refresh token stored" with "I can always get a new access token." Refresh tokens can be revoked by admins, expire due to inactivity, or be invalidated by password changes or Conditional Access policy changes. MSAL's `acquireTokenSilent` will throw, but if error handling just logs and moves on, the system degrades without alerting anyone. Additionally, if the ENCRYPTION_KEY used for token encryption changes (e.g., during a redeploy with regenerated secrets), ALL stored tokens become unreadable.

**How to avoid:**
1. Proactive token refresh job (every 45 minutes per the PRD) should explicitly catch refresh failures and immediately create a `token_expiring` notification for the user.
2. Set `graphConnected: false` on the User model when refresh fails, and surface this prominently in the dashboard.
3. Track the last successful token refresh timestamp per user. If it's older than 2 hours, trigger an alert.
4. Never regenerate `ENCRYPTION_KEY` without a migration plan. Document this as a "DANGER" operation.
5. Consider using application permissions (`/users/{id}/messages`) for background operations instead of delegated permissions. Application permissions use client credentials flow, which does not depend on user tokens. The PRD's setup guide already mentions this as optional (Section 2.5). For a system that must run unattended 24/7, this is strongly recommended.

**Warning signs:**
- Token refresh job logs showing `AADSTS70008` (refresh token expired due to inactivity).
- `graphConnected` flipping to `false` for users who haven't logged into the portal recently.
- Sudden spike in 401 errors in Graph API call logs.
- Delta sync jobs completing instantly with zero events processed.

**Phase to address:**
Phase 1 (Authentication Module). Application permission support should be evaluated immediately. Token health monitoring must be in the MVP.

---

### Pitfall 3: Webhook Event Processing Race Conditions and Data Loss

**What goes wrong:**
Microsoft Graph webhook notifications arrive as batched POST requests. The endpoint must respond with 202 within 3 seconds, or Graph retries and may eventually drop the notification. If processing takes too long (e.g., fetching the full message via Graph API before responding), notifications are lost. Additionally, Graph may send the same notification multiple times (at-least-once delivery), and notifications can arrive out of order. If the system processes a "message deleted" event before the corresponding "message created" event, the delete has no context.

**Why it happens:**
The natural instinct is to process the webhook synchronously: receive notification, fetch message details, store event, evaluate rules, respond. This violates the 3-second response requirement. Even with async processing via BullMQ, race conditions emerge: two webhook notifications for the same message (e.g., created + updated within seconds) may be processed by different BullMQ workers concurrently, causing duplicate EmailEvent documents or conflicting rule evaluations.

**How to avoid:**
1. Webhook endpoint: validate `clientState`, respond 202 immediately, enqueue raw notification payload to BullMQ. Zero Graph API calls in the webhook handler.
2. BullMQ job processing: use the `messageId` as a deduplication key. Check for existing EmailEvent with same `userId + messageId + eventType` before inserting.
3. For rule evaluation: use a per-user mutex (Redis lock with `userId` as key) to serialize rule evaluation. This prevents two concurrent workers from both deciding to act on the same message.
4. Set BullMQ concurrency to 1 per user (use named queues or job groups) to avoid parallel processing of events for the same mailbox.
5. Handle `@removed` annotations in delta query results -- these indicate deletions but the message data is gone.

**Warning signs:**
- Duplicate entries in `email_events` collection for the same messageId.
- Webhook endpoint response times exceeding 1 second in logs.
- BullMQ dead letter queue growing.
- Audit log showing the same email acted upon twice.

**Phase to address:**
Phase 1 (Webhook Handler + Event Collector). The async-first architecture and deduplication must be in place before any real email traffic flows through the system.

---

### Pitfall 4: Pattern Detection False Positives Destroy User Trust

**What goes wrong:**
The pattern engine suggests "Delete all emails from linkedin.com" because the user deleted 95% of LinkedIn emails. But the 5% they kept were job offer notifications they specifically wanted. If the user approves the rule without noticing the nuance, important emails get auto-deleted. One lost job offer email destroys trust in the entire system, and the user disables all automation permanently.

**Why it happens:**
Sender-domain-level patterns are too coarse. LinkedIn sends notifications, job alerts, InMail, connection requests, and recruiter messages -- all from `@linkedin.com`. Aggregating actions at the domain level masks sub-categories with very different value. The confidence score looks high (95%, 100+ samples) but the 5% exceptions are the most important emails. This is the "accuracy vs. cost of error" asymmetry problem: 95% accuracy is excellent for classification but catastrophic when the 5% errors are high-value.

**How to avoid:**
1. Never suggest delete rules based solely on sender domain. Require sender domain + at least one additional discriminator (subject pattern, time-of-day, importance level, or newsletter headers like List-Unsubscribe).
2. Weight the cost of errors asymmetrically: a delete suggestion requires 98%+ consistency, while a move-to-folder suggestion can be at 85%.
3. Show the user the EXCEPTIONS explicitly: "You kept 5 of 100 emails from linkedin.com. Here are the 5 you kept:" This lets them see whether those exceptions matter.
4. Start with conservative defaults: the `aggressiveness` setting should default to `conservative`, which only suggests patterns with 95%+ confidence AND 20+ samples AND composite criteria.
5. The "MSEDB Staging" folder grace period is the last line of defense. Make the staging page prominent and the daily digest unmissable.
6. Implement a "never suggest delete for this domain" option that is more discoverable than the general whitelist.

**Warning signs:**
- Undo rate exceeding 5% for any single rule.
- User adding domains to whitelist after approving rules.
- Users setting automation to "paused" and never resuming.
- Pattern suggestions being rejected at high rates.

**Phase to address:**
Phase 1 (Pattern Analysis Engine). The confidence scorer and pattern criteria must encode asymmetric risk from the first implementation. Retrofitting safety into an existing pattern engine is much harder than building it in.

---

### Pitfall 5: Staging Folder Becomes a Black Hole

**What goes wrong:**
The "MSEDB Staging" folder created via Graph API accumulates emails that users never review. The grace period expires, emails are auto-deleted, and the user never knew they were staged. The safety mechanism becomes theater -- it exists but provides no actual protection because no one checks it.

**Why it happens:**
Users don't check a separate staging folder in Outlook. They check their Inbox. A folder called "MSEDB Staging" is invisible in their daily workflow. The daily digest email (which summarizes automated actions) becomes noise that users filter out. The staging page in the dashboard requires actively logging into the portal.

**How to avoid:**
1. Push notifications (Socket.IO) when items enter staging, with a count badge on the Staging nav item.
2. Make the daily digest email highly actionable: include direct "rescue" links for each staged email.
3. For the first 30 days of any new rule, increase visibility: send per-action notifications, not just daily digest.
4. Track engagement with the staging folder. If a user hasn't checked staging in 7 days, send an alert.
5. Consider making the initial grace period longer (48 hours) and requiring explicit user confirmation to shorten it.
6. Dashboard home page should show "X emails in staging" prominently, with red/amber badges.

**Warning signs:**
- Staged emails consistently expiring without being reviewed (100% auto-execution rate).
- Zero "rescue" actions recorded in audit log.
- Users discovering deleted emails weeks later and losing trust.

**Phase to address:**
Phase 1 (Staging Manager + Dashboard). Staging UX must be a first-class concern during dashboard design, not an afterthought.

---

### Pitfall 6: Graph API Throttling Cascade Under Multi-User Load

**What goes wrong:**
Microsoft Graph API throttling is per-app-per-tenant. When multiple users are connected (the PRD targets 50 concurrent users), their individual webhook-triggered Graph API calls (fetching message details) aggregate against a single throttling bucket. A burst of incoming email across multiple users (e.g., Monday morning) causes 429 responses. The retry logic across multiple BullMQ workers creates a thundering herd, making throttling worse. Starting September 30, 2025, the per-app/per-user per-tenant throttling limit was reduced to half the total per-tenant limit.

**Why it happens:**
Developers test with 1-2 users and never hit throttling limits. They don't implement proper backoff because they never see 429 errors in development. When 50 users are connected and all receive email simultaneously, the aggregate API call rate easily exceeds the tenant limit.

**How to avoid:**
1. Implement a centralized rate limiter (in Redis) that tracks aggregate Graph API calls across all users and all workers. Not per-user rate limiting -- tenant-wide.
2. Honor the `Retry-After` header from 429 responses. Propagate the retry delay to ALL pending Graph API calls, not just the one that was throttled.
3. Use `$batch` requests to combine up to 20 individual requests into a single HTTP call. Fetch message details for multiple webhook notifications in a single batch.
4. Use `$select` on every Graph API call to request only needed fields. Never fetch the full message resource.
5. Delta sync should use `prefer: odata.maxpagesize=50` to control pagination batch size.
6. Implement a global "throttle mode" that reduces the frequency of non-critical operations (e.g., pause delta sync, delay pattern analysis) when throttling is detected.

**Warning signs:**
- 429 responses appearing in Graph API call logs.
- `Retry-After` header values increasing over time.
- BullMQ job retry counts climbing.
- Delta sync jobs taking unusually long to complete.

**Phase to address:**
Phase 1 (Graph Client). The rate limiter must wrap every Graph API call from the start. Cannot be bolted on later without a major refactor of `graphClient.js`.

---

### Pitfall 7: MSAL Token Cache Not Persisted Across Container Restarts

**What goes wrong:**
MSAL's `ConfidentialClientApplication` uses an in-memory token cache by default. When the backend container restarts, all cached access tokens and refresh tokens are lost. Every user's next Graph API call fails because the cache is empty. The system must fall back to stored encrypted refresh tokens in MongoDB, but if the custom `tokenManager.js` doesn't properly re-hydrate the MSAL cache on startup, users see errors until they re-authenticate.

**Why it happens:**
The MSAL documentation recommends `acquireTokenSilent` which relies on the in-memory cache. Developers assume this "just works" in a containerized environment. It does -- until the container restarts. The PRD's `tokenManager.js` stores encrypted refresh tokens in MongoDB, but there's a gap: MSAL's cache and the custom token storage must be synchronized, and MSAL's `DistributedCachePlugin` is not well-documented for MongoDB.

**How to avoid:**
1. Implement MSAL's `ICachePlugin` interface to persist the token cache to MongoDB or Redis.
2. On backend startup, load all user token cache entries from persistent storage into MSAL.
3. Alternatively, bypass MSAL's cache entirely: store refresh tokens in MongoDB (encrypted), and always use `acquireTokenByRefreshToken` directly. This gives you full control and eliminates the MSAL cache synchronization problem.
4. Test the container restart scenario explicitly: `docker restart msedb-backend` and verify all users' Graph API calls continue working without re-authentication.

**Warning signs:**
- Spike of 401 errors immediately after container restart.
- Users prompted to re-authenticate after backend deployment.
- Token refresh job succeeding before restart but failing immediately after.

**Phase to address:**
Phase 1 (Authentication Module). Must be solved before the first user connects. If this isn't working, every deployment triggers a user-facing outage.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Storing delta tokens in Redis only (no MongoDB backup) | Simpler implementation, faster reads | Container restart loses delta state; full resync required for all users (expensive API calls, may trigger throttling) | Never for production -- always persist delta tokens to MongoDB with Redis as cache |
| Using `/me/messages` (delegated) instead of `/users/{id}/messages` (application) | No admin consent for application permissions needed | Background processing depends on user's refresh token; breaks if user inactive 90+ days | MVP only -- migrate to application permissions in Phase 2 |
| Single BullMQ queue for all job types | Less Redis key overhead, simpler code | Priority inversion: a slow pattern analysis job blocks webhook processing; can't scale job types independently | Never -- use separate queues from day one (webhook-processing, delta-sync, pattern-analysis, staging, maintenance) |
| Skipping `lifecycleNotificationUrl` on subscriptions | Fewer endpoints to implement | Silent subscription loss with no recovery signal; missed notifications go undetected | Never -- it's a single URL parameter and the only reliable way to detect subscription issues |
| Polling instead of webhooks | No Cloudflare Tunnel dependency; simpler architecture | API quota consumed rapidly; 15-minute minimum polling interval means 15-minute delay on all automation | Acceptable only as a degraded fallback mode when webhooks are unavailable |
| No MongoDB indexes on `email_events` | Faster initial writes during development | Pattern analysis queries become O(n) table scans; dashboard grinds to a halt at 100K+ events per user | Never -- define indexes in the Mongoose schema from the start |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Microsoft Graph Webhooks | Using `/me/messages` as the subscription resource (requires delegated token for every renewal) | Use `/users/{userId}/messages` with application permissions for background reliability; fall back to `/me/messages` only if application permissions are not granted |
| Microsoft Graph Webhooks | Not setting `lifecycleNotificationUrl` | Always set it -- it's the only way to receive `subscriptionRemoved`, `reauthorizationRequired`, and `missed` lifecycle events |
| Microsoft Graph Webhooks | Validation endpoint returning JSON instead of plain text | Validation token response must be `Content-Type: text/plain` with the raw token value, 200 status, within 10 seconds |
| Microsoft Graph Delta Query | Assuming delta tokens are permanent | Delta tokens have a cache-based expiry (not time-based). If the token is evicted, Graph returns `410 Gone` or `syncStateNotFound`. Must handle this by doing a full resync. |
| Microsoft Graph Delta Query | Not handling `@removed` entries | Delta responses include `@removed` objects for deleted/moved items. These must be processed as delete/move events, not ignored. |
| Cloudflare Tunnel | Assuming the tunnel is always up | Tunnel can disconnect during Cloudflare maintenance, network blips, or systemd restarts. Webhook notifications are lost during downtime. Delta sync must catch missed events. |
| Cloudflare Tunnel | Bot protection rules blocking Graph API POST requests | Cloudflare's bot detection may challenge or block Microsoft's webhook POST requests (403 errors). Bypass bot rules for the `/webhooks/graph` path. |
| Azure AD App Registration | Redirect URI mismatch between internal IP and tunnel hostname | Register BOTH redirect URIs: `http://172.16.219.222:8010/auth/callback` (internal) AND `https://msedb-api.yourdomain.com/auth/callback` (tunnel) |
| Azure AD Client Secret | Forgetting to rotate before 24-month expiry | Set a calendar reminder at 22 months. When the secret expires, ALL auth stops. Store the expiry date in the app's admin health dashboard. |
| BullMQ + Redis | Using `maxmemory-policy: allkeys-lru` (the PRD's docker-compose.yml config) | BullMQ requires `noeviction` policy. LRU eviction will silently delete job keys, causing jobs to vanish without error. Change Redis config to `noeviction` and manage memory via job cleanup (`removeOnComplete`, `removeOnFail` with age limits). |
| MongoDB TTL Index | Expecting immediate deletion when TTL expires | MongoDB's TTL monitor runs every 60 seconds and deletes in batches. Under heavy write load, TTL deletions can lag by minutes or hours. Don't rely on TTL for time-critical data removal. |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Unbounded `email_events` queries in pattern analysis | Pattern analysis job takes 30+ minutes; MongoDB CPU at 100% during nightly job | Add compound indexes; limit analysis to last 30 days; use aggregation pipeline with `$match` stage first | At 50K+ events per user (~3 months of active mailbox observation) |
| Storing all email event fields when only metadata is needed | MongoDB storage growing faster than expected; backup size doubles monthly | Use `$select` in Graph API to fetch only needed fields; don't store full header data or redundant fields | At 500K+ total events across all users |
| Socket.IO broadcasting to all connected clients | Dashboard sluggish; backend memory usage climbing | Use per-user rooms (`user:{userId}`). Never broadcast to all sockets. Verify room membership on every emit. | At 20+ concurrent dashboard sessions |
| No pagination on dashboard API endpoints | Dashboard load time exceeding 5 seconds; browser tab crashes | Server-side pagination with cursor-based pagination for audit logs and events; limit default page size to 20 | At 10K+ audit log entries or events per user |
| Delta sync fetching full message objects for all changes | 15-minute delta sync consuming most of the Graph API quota | Use `$select` to request only `id,subject,sender,receivedDateTime,parentFolderId,isRead,importance,flag,categories`; use `$top` to limit page size | At 10+ users with active mailboxes |
| BullMQ job return values stored in Redis | Redis memory growing unbounded; eventually OOM | Set `removeOnComplete: { age: 3600, count: 1000 }` and `removeOnFail: { age: 86400, count: 5000 }` on all queues | At 10K+ jobs per day |
| MongoDB write concern `w:1` with no journal | Data loss on MongoDB container crash during write | Use `w: 'majority'` for critical writes (rules, tokens, audit logs); `w: 1` is acceptable for email events | On any unexpected container termination |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Storing `clientState` webhook secret in plain text in MongoDB | Attacker with DB access can forge webhook notifications, triggering arbitrary rule executions | Generate a cryptographically random `clientState` per subscription; store hashed (SHA-256) in MongoDB; compare hashes during validation |
| JWT secret shared across environments or committed to repo | Token forgery -- attacker can impersonate any user including admin | Generate unique `JWT_SECRET` per environment via `openssl rand -hex 32`; never reuse between dev/staging/prod |
| No rate limiting on webhook endpoint | Denial of service via flood of fake webhook notifications | Rate limit `/webhooks/graph` by source IP; validate `clientState` before any processing; respond 202 even for invalid payloads to avoid timing attacks |
| Encryption key in `.env` without access controls | All stored refresh tokens compromised if `.env` is readable | Restrict `.env` file permissions to root/docker user only (`chmod 600`); consider using Docker secrets or a vault for production |
| Admin role based solely on email match at first login | Race condition: someone else registers with ADMIN_EMAIL before the intended admin | Lock admin assignment to first login only; after admin exists, disable auto-assignment; verify via Azure AD group membership instead |
| OAuth state parameter not validated on callback | CSRF attack -- attacker can link their Microsoft account to victim's MSEDB session | Generate and validate a cryptographic nonce (MSAL handles this, but verify it's not disabled) |
| Storing email subjects in audit logs without sanitization | Stored XSS if subjects contain HTML/JavaScript and are rendered in dashboard | Sanitize all user-controlled strings before MongoDB storage and before React rendering; use React's default JSX escaping |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Showing raw confidence percentages without context | Users don't know if 75% is good or bad; either approve everything or nothing | Use labeled tiers: "Very High (95%+)", "High (85-94%)", "Medium (70-84%)" with color coding and plain-language explanation of what each means |
| Pattern suggestions appearing before enough data exists | System suggests rules after 10 emails, which may be the first week; user sees low-quality suggestions and loses trust early | Enforce a minimum observation period (14 days) before first suggestions appear; show "Learning your email patterns..." status during warm-up |
| No "undo" affordance visible in the email activity flow | User realizes an automated action was wrong but can't find how to reverse it | Place "Undo" button directly in the audit log row, in the Socket.IO real-time notification, and in the daily digest email with a one-click undo link |
| Kill switch hides in Settings | User panics when automation does something unexpected and can't find the emergency stop | Kill switch must be in the top navigation bar, visible at all times, prominent red toggle |
| Daily digest sent at fixed 8 AM without timezone awareness | User in a different timezone gets the digest at wrong time; misses staging expiry | Use the user's configured timezone for digest scheduling; BullMQ job must be per-user with timezone-aware scheduling |
| "MSEDB Staging" folder name visible in Outlook | Confuses users who see a mysterious folder in their mailbox client | Name the folder something user-friendly like "Email Review" or let users customize the folder name |

---

## "Looks Done But Isn't" Checklist

- [ ] **Webhook subscription**: Often missing `lifecycleNotificationUrl` -- verify it is set on every subscription creation and that the lifecycle endpoint handles `subscriptionRemoved`, `reauthorizationRequired`, and `missed` events
- [ ] **Token refresh**: Often missing error handling for expired refresh tokens -- verify the system creates a user notification and sets `graphConnected: false` when refresh fails
- [ ] **Delta sync**: Often missing handling for expired delta tokens (`410 Gone` or `syncStateNotFound`) -- verify fallback to full folder sync
- [ ] **Pattern analysis**: Often missing asymmetric risk weighting -- verify delete suggestions require higher confidence than move suggestions
- [ ] **Rule evaluation**: Often missing whitelist check -- verify org-level whitelist is checked before user-level rules
- [ ] **Staging processor**: Often missing check for user's `automationPaused` flag -- verify paused users' staged emails are not auto-executed
- [ ] **Webhook handler**: Often missing immediate 202 response -- verify no Graph API calls happen before the HTTP response is sent
- [ ] **Redis configuration**: Often using wrong eviction policy -- verify `maxmemory-policy` is `noeviction`, not `allkeys-lru`
- [ ] **Docker volumes**: Often missing named volumes for Redis -- verify `msedb-redis-data` volume persists BullMQ job state across container restarts
- [ ] **CORS configuration**: Often missing Cloudflare Tunnel hostname -- verify both internal IP and tunnel hostname are allowed origins
- [ ] **Health endpoint**: Often only checking "is MongoDB connected" -- verify it also reports subscription health, token health, and job queue depth
- [ ] **Multi-domain users**: Often assuming all users share the same email domain -- verify the system handles users from aptask.com, jobtalk.ai, yenom.ai, and hudosndatallc.com under the same tenant without domain-based assumptions in pattern matching

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| All webhook subscriptions expired | MEDIUM | 1. Backend detects on startup or via health check. 2. Re-create subscriptions for all active users. 3. Run immediate delta sync to catch missed events. 4. Takes ~5 minutes for 50 users but consumes API quota. |
| Refresh tokens expired for multiple users | HIGH | 1. Mark affected users as `graphConnected: false`. 2. Send notification to each user to re-authenticate. 3. No automated recovery possible -- requires human action. 4. All automation for those users is paused until re-auth. |
| Pattern engine suggests bad rule and user approves it | LOW | 1. User clicks "Undo" within 48 hours for individual actions. 2. User pauses or deletes the rule. 3. Check "MSEDB Staging" for emails still in grace period and rescue them. 4. Staged emails not yet expired can be rescued in bulk. |
| Redis data loss (container restart without volume persistence) | HIGH | 1. All BullMQ job state lost -- scheduled jobs don't run until re-registered. 2. Delta tokens stored only in Redis are lost -- full resync required. 3. Backend must re-register all cron jobs on startup (BullMQ does this if using `add` with `repeat`). 4. Full delta resync for all users consumes significant API quota. |
| MongoDB data corruption or volume loss | CRITICAL | 1. Restore from last backup (daily at 3 AM). 2. Up to 24 hours of data loss for events and audit logs. 3. Re-create webhook subscriptions. 4. Users must re-authenticate if user documents are lost. 5. All rules and patterns must be re-created by users. |
| Graph API throttled at tenant level | MEDIUM | 1. All Graph API calls enter exponential backoff. 2. Pause delta sync and pattern analysis jobs. 3. Let webhook processing drain naturally (it doesn't call Graph during enqueue). 4. Process webhook jobs with delays, honoring Retry-After headers. 5. Recovery is automatic once throttle window passes (typically minutes). |
| Cloudflare Tunnel goes down | LOW | 1. Webhooks stop arriving -- this is expected. 2. Delta sync continues working (internal network only). 3. When tunnel recovers, Graph may retry missed notifications for up to 4 hours. 4. Run immediate delta sync on tunnel recovery to catch any gaps beyond 4 hours. |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Webhook subscription expiry | Phase 1: Webhook Infrastructure | Automated test: stop renewal job for 8 days, verify subscription re-created on next startup and delta sync catches gap |
| Delegated token expiry | Phase 1: Auth Module | Manual test: revoke user's refresh token in Azure AD, verify notification appears within 45 minutes and `graphConnected` flips to false |
| Webhook race conditions | Phase 1: Event Collector | Load test: send 100 webhook notifications for same message in 1 second, verify exactly 1 EmailEvent created |
| Pattern false positives | Phase 1: Pattern Engine | Review test: generate patterns from seed data with known exceptions, verify exceptions are surfaced in pattern card UI |
| Staging black hole | Phase 1: Dashboard + Staging | UX review: onboard a test user, verify staging notifications appear within 10 seconds of email being staged |
| Graph API throttling cascade | Phase 1: Graph Client | Load test: simulate 50 users receiving email simultaneously, verify 429 handling and no data loss |
| MSAL cache persistence | Phase 1: Auth Module | Container test: `docker restart msedb-backend`, verify Graph API calls succeed within 30 seconds of restart without user re-auth |
| BullMQ Redis eviction | Phase 1: Docker Compose | Configuration audit: verify `maxmemory-policy noeviction` in Redis config before first deployment |
| Multi-domain user handling | Phase 1: User Management | Test: invite users from all 4 domains (aptask.com, jobtalk.ai, yenom.ai, hudosndatallc.com), verify independent pattern detection and rule evaluation |
| MongoDB scaling with event volume | Phase 2: Optimization | Monitor: set up alerts for query execution time > 5 seconds and collection size > 1GB; review indexes monthly |
| Cloudflare Tunnel reliability | Phase 1: Infrastructure | Monitoring: health check verifies tunnel is passing traffic; alert if webhook POST count drops to zero for 30+ minutes |
| Azure AD secret rotation | Ongoing: Operations | Calendar reminder at 22 months; document rotation procedure in admin panel |

---

## Sources

- [Microsoft Graph subscription resource type](https://learn.microsoft.com/en-us/graph/api/resources/subscription?view=graph-rest-1.0) -- Official subscription lifetime limits (HIGH confidence)
- [Reduce missing change notifications and removed subscriptions](https://learn.microsoft.com/en-us/graph/change-notifications-lifecycle-events) -- Lifecycle events documentation (HIGH confidence)
- [Microsoft Graph throttling guidance](https://learn.microsoft.com/en-us/graph/throttling) -- Throttling limits and best practices (HIGH confidence)
- [Microsoft Graph service-specific throttling limits](https://learn.microsoft.com/en-us/graph/throttling-limits) -- Per-app-per-tenant limits (HIGH confidence)
- [Token caching in MSAL Node](https://learn.microsoft.com/en-us/entra/msal/javascript/node/caching) -- Distributed cache requirements (HIGH confidence)
- [Change notifications for Outlook resources](https://learn.microsoft.com/en-us/graph/outlook-change-notifications-overview) -- Outlook-specific webhook behavior (HIGH confidence)
- [Delta query for messages](https://learn.microsoft.com/en-us/graph/delta-query-messages) -- Delta token handling and pitfalls (HIGH confidence)
- [BullMQ going to production](https://docs.bullmq.io/guide/going-to-production) -- Redis noeviction requirement (HIGH confidence)
- [BullMQ Redis memory issue #366](https://github.com/taskforcesh/bullmq/issues/366) -- Job return value memory accumulation (MEDIUM confidence)
- [MongoDB TTL Indexes documentation](https://www.mongodb.com/docs/manual/core/index-ttl/) -- TTL deletion behavior (HIGH confidence)
- [Inconsistent Webhook Behavior Through Cloudflare Tunnel](https://community.cloudflare.com/t/inconsistent-webhook-behavior-through-cloudflare-tunnel-need-help/816846) -- Bot protection blocking webhooks (MEDIUM confidence)
- [Graph API reauthorizationRequired loop](https://learn.microsoft.com/en-nz/answers/questions/5574982/graph-api-webhook-receiving-constant-reauthorizati) -- Community-reported lifecycle notification issues (MEDIUM confidence)
- [Microsoft Graph Webhooks best practices](https://www.voitanos.io/blog/microsoft-graph-webhook-delta-query/) -- Delta query as webhook complement (MEDIUM confidence)

---

*Pitfalls research for: MSEDB -- Microsoft Email Intelligence & Automation Portal*
*Researched: 2026-02-16*
