# Codebase Concerns

**Analysis Date:** 2026-02-16

## Tech Debt

**Microsoft Graph Webhook Reliability:**
- Issue: Webhooks are the primary real-time notification mechanism, but are inherently unreliable (network failures, subscription expirations, rate limiting). Delta query fallback only runs every 15 minutes, creating a 15-minute window where events could be missed.
- Files: `backend/src/services/graph/subscriptionService.js`, `backend/src/jobs/deltaSync.js`
- Impact: Patterns could be incomplete or inaccurate; users may miss automated actions in the 15-minute gap; pattern confidence calculations become unreliable.
- Fix approach: Implement dual-tracking with timestamps on all Graph API calls; add warning alerts when delta sync detects large gaps. Consider adding a 5-minute delta sync as critical fallback, not just 15-minute periodic.

**Database Scaling Concern:**
- Issue: The `email_events` collection will grow unbounded at potentially 100s of events per user per day (read, deleted, moved, flagged actions). With 50 concurrent users, this could be 50,000+ events/day. Over 90 days (retention period), this is 4.5M+ documents.
- Files: `backend/src/models/EmailEvent.js`, `backend/src/jobs/deltaSync.js`
- Impact: Query performance degradation on `/api/events` and dashboard heatmap endpoints; memory pressure on MongoDB; potential for slow pattern analysis jobs.
- Fix approach: Implement aggressive indexing on `(userId, timestamp)` and `(userId, eventType)` immediately. Plan TTL index for 90-day retention. Consider archiving old events to separate collection or data warehouse after Phase 1.

**Pattern Detection Algorithm Complexity:**
- Issue: Pattern matching involves subject normalization (replacing numbers, dates, IDs with wildcards), composite patterns (sender + subject + time), and confidence scoring across 5 pattern types. Subject normalization logic is fragile — regex-based replacements for dates/numbers could fail on uncommon formats.
- Files: `backend/src/services/analyzer/subjectNormalizer.js`, `backend/src/services/analyzer/patternDetector.js`
- Impact: False positive patterns (high confidence, low accuracy); false negatives (missing real patterns); potential for regex DoS if user subjects contain malicious patterns.
- Fix approach: Start with simple sender-level patterns only in MVP; defer subject pattern matching to Phase 2. Use allowlist of common date/number formats rather than broad regex.

## Security Considerations

**Azure AD Client Secret Rotation:**
- Risk: The AZURE_AD_CLIENT_SECRET is stored in .env file which, while gitignored, is persistent on the DGX server. The setup guide mentions rotating every 24 months but there's no automated enforcement or alerts.
- Files: `.env` (not in codebase), `backend/src/config/index.js`, `backend/src/auth/azureAd.js`
- Current mitigation: .env is not committed; secret is not logged; MSAL library handles refresh tokens.
- Recommendations: Implement automatic rotation detection (Azure AD sends deprecation warnings 30 days before secret expires). Add calendar reminder system. Consider moving to certificate-based authentication instead of secret-based.

**Token Leakage in Logs:**
- Risk: Despite intentions not to log tokens, OAuth access/refresh tokens could accidentally be logged if exception messages include full request/response payloads or if debugging dumps entire state objects.
- Files: `backend/src/auth/tokenManager.js`, `backend/src/utils/logger.js`, `backend/src/middleware/errorHandler.js`
- Current mitigation: Explicit "token encryption" mentioned; tokens described as "never exposed to frontend".
- Recommendations: Implement strict redaction rules in logger (never log .access_token, .refresh_token, .expiresIn). Add automated scanning of logs for common token patterns. Test error scenarios to ensure tokens not included in stack traces.

**Webhook Signature Validation:**
- Risk: Microsoft Graph webhooks must be validated with a `validationToken` within 10 seconds. The setup guide mentions this but doesn't specify how it's implemented. Weak validation could allow replay attacks or injection of fake webhook events.
- Files: `backend/src/routes/webhookRoutes.js`
- Current mitigation: Cloudflare Tunnel provides transport security.
- Recommendations: Implement strict validationToken validation on every subscription creation. Validate `clientState` secret on every incoming webhook. Implement rate limiting on webhook endpoint (per-subscription basis). Log all validation failures.

**User Data Isolation at Query Level:**
- Risk: The PRD mentions "User data isolation enforced at query level" but this is fragile — a single missing `.where(userId: currentUser.id)` in any query allows users to see each other's patterns, rules, and deleted emails.
- Files: All route handlers in `backend/src/routes/*.js`, all service methods in `backend/src/services/*/`.
- Current mitigation: Middleware enforces `requireAuth`.
- Recommendations: Implement a centralized query helper that enforces userId filtering. Add automated tests for every query to verify userId filtering. Use mongoose plugins to auto-add userId to all find queries.

**Email Staging Folder Traversal:**
- Risk: The system creates an "MSEDB Staging" folder in user mailbox via Graph API. If folder naming isn't properly escaped, a user could potentially create a folder named "..", causing rules to move emails to unexpected locations.
- Files: `backend/src/services/automation/stagingManager.js`
- Current mitigation: Graph API likely validates folder names server-side.
- Recommendations: Validate all folder names match pattern `^[a-zA-Z0-9_\-\s]+$` before any Graph API call. Test with edge cases: "..", ".", "CON", "MSEDB Staging", etc.

## Scaling Limits

**Redis Memory Constraints:**
- Current capacity: 256MB allocated (from docker-compose.yml: `maxmemory 256mb`)
- Limit: BullMQ queues for webhook processing, pattern analysis, staging processor, token refresh, and digest generation. Each job needs serialized payload + metadata. With high event volumes (100s per user per day), queue could exceed 256MB.
- Impact: Redis eviction policy is `allkeys-lru`, so older jobs will be dropped without execution.
- Scaling path: Monitor Redis memory in real-time via Socket.IO. If approaching 200MB, trigger alert. Scale to 512MB or implement job batching (e.g., batch 10 delta syncs into one job).

**Database Connection Pooling:**
- Current capacity: Mongoose default is ~30 connections per app instance.
- Limit: With 50 concurrent users + BullMQ workers + pattern analysis job + daily digest job, connection pool could saturate.
- Scaling path: Implement connection pool monitoring. Set pool size to 50. Use Mongoose `maxPoolSize` and `minPoolSize` options. Consider adding HikariCP or PgBouncer if scaling beyond 100 concurrent users.

**Dashboard Query Performance:**
- Current capacity: `/api/dashboard/stats` aggregates `email_events`, `rules`, and `audit_logs` in real-time.
- Limit: With 4.5M+ email_events documents after 90 days, aggregation queries will timeout on standard MongoDB without proper indexing.
- Scaling path: Add pre-calculated stats cache in Redis (updated every 5 minutes by background job). Implement materialized view pattern: `dashboard_stats` collection updated by aggregation pipeline, read directly by endpoint.

## Performance Bottlenecks

**Pattern Analysis Job:**
- Problem: Runs daily at 2 AM, analyzes potentially 100,000s of events across all users to detect patterns (Type 1-5).
- Cause: Nested loops for sender analysis, subject normalization, confidence scoring. If a user has 10,000 events, analyzing all 5 pattern types sequentially = 50,000+ iterations.
- Files: `backend/src/services/analyzer/patternDetector.js`, `backend/src/jobs/patternAnalysis.js`
- Improvement path: Parallelize per-user analysis using Node.js worker threads or separate queue workers. Implement incremental pattern detection (only analyze events since last run, not all 90 days). Add caching: if a pattern hasn't changed, skip confidence re-calculation.

**Subject Normalization at Scale:**
- Problem: Subject line normalization (replacing dates, numbers, IDs with wildcards) is regex-heavy and runs on every new email for classification.
- Cause: Multiple regex replacements per subject; no pre-compiled regex patterns; no memoization of normalized subjects.
- Improvement path: Pre-compile all regex patterns globally. Memoize normalized subjects in Redis with 30-day TTL (emails rarely have unique subjects). Consider bloom filters for fast "subject seen before" checks before normalization.

**Webhook Processing Latency:**
- Problem: PRD specifies "Rules execute within 5 minutes of email arrival (via webhook trigger)" but also mentions "Webhook processing: under 3 seconds" in performance requirements.
- Cause: Webhook → Event storage → Pattern matching → Rule evaluation → Graph API action = multiple I/O operations. If Graph API is slow, rule execution could miss the 5-minute SLA.
- Files: `backend/src/routes/webhookRoutes.js`, `backend/src/services/automation/ruleEngine.js`
- Improvement path: Make pattern matching and rule evaluation fire-and-forget (queue the work, respond 202 to webhook immediately). Store webhook event first, evaluate rules async. Add circuit breaker on Graph API calls to fail fast if Graph is slow.

## Fragile Areas

**Rule Execution Race Conditions:**
- Files: `backend/src/services/automation/ruleEngine.js`, `backend/src/jobs/stagingProcessor.js`
- Why fragile: Multiple processes (main backend, BullMQ workers, staging processor job) all modify the same email simultaneously. If rule 1 moves email to folder, rule 2 tries to archive it, and staging processor tries to move to staging folder, race condition could occur in Graph API.
- Safe modification: Implement optimistic locking: add `version` field to rule execution record. Before executing, check that email hasn't been modified by another rule. If version mismatch, retry or log conflict.
- Test coverage gaps: No tests for concurrent rule execution on same email.

**Staging Folder Grace Period Timing:**
- Files: `backend/src/services/automation/stagingManager.js`, `backend/src/jobs/stagingProcessor.js`
- Why fragile: The 24-hour grace period is enforced by `expiresAt` timestamp in MongoDB, but if the scheduled job (runs every 30 minutes) fails, expired items remain in staging indefinitely. No alert if job is stuck.
- Safe modification: Add explicit expiry check before moving email to Deleted Items. Add heartbeat/health check for staging processor job. If job hasn't run in 2 hours, alert admin.

**Token Refresh Race Condition:**
- Files: `backend/src/auth/tokenManager.js`, `backend/src/jobs/tokenRefresh.js`
- Why fragile: Multiple requests could trigger token refresh simultaneously. MSAL library should handle this, but if not, could result in multiple refresh attempts and JWT validation errors.
- Safe modification: Implement distributed lock (using Redis) before token refresh. Only one process refreshes per user at a time.
- Test coverage gaps: No tests for concurrent token refresh attempts.

**Webhook Subscription Expiry:**
- Files: `backend/src/jobs/webhookRenewal.js`
- Why fragile: Webhooks expire every 3 days and must be renewed. If renewal job fails silently, webhook stops delivering events with no alert. Delta sync catches some misses, but 15-minute delay is too long.
- Safe modification: Add explicit expiry monitoring. Before expiry time, verify subscription is active by querying Graph API. If expired, immediately recreate. Log all renewal failures as errors, not info.

## Known Bugs

**Graph API Webhook Validation Token Handling:**
- Symptoms: Microsoft Graph webhook validation could timeout if response is not sent within 10 seconds.
- Files: `backend/src/routes/webhookRoutes.js`
- Trigger: On first webhook subscription creation or if validation is implemented as async operation instead of synchronous response.
- Workaround: Ensure validation token is returned synchronously before any async I/O.

**Subject Normalization Regex Injection:**
- Symptoms: User emails with regex metacharacters in subject line could break subject normalization (e.g., subject containing `[0-9]+` would be treated as regex, not literal).
- Files: `backend/src/services/analyzer/subjectNormalizer.js`
- Trigger: When subject normalization regex operations use user input without escaping.
- Workaround: Use `String.replace()` with literal strings instead of regex patterns, or escape user input with `escapeRegExp()` helper.

## Missing Critical Features

**Monitoring & Alerting:**
- Problem: The system has many background jobs and external dependencies (Graph API, Cloudflare Tunnel, Azure AD) but no centralized monitoring or alerting mentioned.
- Blocks: Can't detect when webhooks stop working, token refresh fails, or database is slow until users report issues.
- Implementation priority: High — add before production. Create alerts for: webhook subscriptions failing, token refresh failures, Graph API rate limiting, Redis memory exceeding 80%, MongoDB connection pool saturation, job execution failures.

**Database Backup Strategy:**
- Problem: PRD mentions data in named Docker volumes (`msedb-mongo-data`, `msedb-redis-data`) but no backup strategy.
- Blocks: Data loss if volume is corrupted or container is deleted.
- Implementation priority: High — MongoDB must be backed up daily to external storage (S3, NFS, etc.). Redis can be ephemeral (recreated from subscriptions), but recommend backup too.

**Audit Trail Pagination:**
- Problem: Audit log endpoint `/api/audit` should be paginated but pagination strategy not specified. With 1000s of automated actions per day, audit log could be huge.
- Blocks: Dashboard could hang loading audit log.
- Implementation priority: Medium — implement cursor-based pagination with 50-item page size.

**Rule Export/Import Validation:**
- Problem: PRD specifies import/export of rules as JSON but no schema validation or conflict resolution strategy.
- Blocks: User could import malformed JSON or import rules that conflict with existing rules.
- Implementation priority: Medium — validate imported JSON against Rule schema. Detect conflicts (duplicate rule names, duplicate conditions). Show preview before import.

## Test Coverage Gaps

**Webhook Event Processing:**
- What's not tested: End-to-end webhook receipt → event storage → pattern update → rule execution.
- Files: `backend/src/routes/webhookRoutes.js`, `backend/src/services/collector/eventCollector.js`, `backend/src/services/analyzer/patternDetector.js`, `backend/src/services/automation/ruleEngine.js`
- Risk: A bug in webhook processing could silently fail, patterns would be incomplete, and users wouldn't realize.
- Priority: High — implement integration tests that mock Microsoft Graph webhooks.

**User Data Isolation:**
- What's not tested: Confirm that user A cannot query user B's patterns, rules, events.
- Files: All route handlers in `backend/src/routes/`
- Risk: Data leak between users could expose sensitive email behavior patterns.
- Priority: High — add security tests that verify userId filtering on all queries.

**Concurrent Rule Execution:**
- What's not tested: Two rules triggering simultaneously on same email.
- Files: `backend/src/services/automation/ruleEngine.js`
- Risk: Race condition could result in email being moved twice or deleted when user didn't intend.
- Priority: Medium — add stress test with concurrent rule executions.

**Token Refresh Under Load:**
- What's not tested: Token refresh behavior when 50 users' tokens expire simultaneously.
- Files: `backend/src/auth/tokenManager.js`, `backend/src/jobs/tokenRefresh.js`
- Risk: Token refresh job could be overwhelmed; some users' tokens could expire without refresh attempt.
- Priority: Medium — add load test for concurrent token refresh.

**Pattern Confidence Edge Cases:**
- What's not tested: Confidence scoring for patterns with very small sample sizes (8-9 events), patterns with 100% consistency vs. edge cases.
- Files: `backend/src/services/analyzer/confidenceScorer.js`
- Risk: False positives or false negatives in confidence scoring.
- Priority: Medium — add unit tests for all confidence score boundaries.

---

*Concerns audit: 2026-02-16*
