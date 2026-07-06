# MSEDB Database & Search Review

Scope: every Mongoose model (`backend/src/models/`), every `.find`/`.aggregate`/`.countDocuments` call in routes/services/jobs, the Qdrant+Ollama semantic search pipeline, and retention/growth behavior. All findings are cited `file:line` against the code as of this review.

---

## 1. Schema Inventory

| Model | Purpose | Indexes | Growth risk |
|---|---|---|---|
| `User` (`models/User.ts`) | Identity, MSAL tokens, per-user pattern thresholds | `{email:1}` unique, `{microsoftId:1}` unique sparse | Bounded — 1 doc/person |
| `Mailbox` (`models/Mailbox.ts`) | Connected M365 mailbox, encrypted tokens, per-mailbox whitelist/signatures | `{userId:1,email:1}` unique, `{userId:1}`, `{homeAccountId:1}` unique sparse | Bounded — 1 doc/mailbox. **Dead field**: `deltaLinks` (Map) is never read or written anywhere except the schema default — real delta links live in Redis (`services/deltaService.ts:47`). Schema cruft, not a functional bug. |
| `EmailEvent` (`models/EmailEvent.ts`) | Core event log — one row per arrived/deleted/moved/read/flagged/categorized action. Stores sender/subject/folder/categories **metadata only, no body** | `{userId,sender.domain,timestamp}`, `{userId,eventType,timestamp}`, `{userId,mailboxId,messageId,eventType}` unique (dedup), `{messageId,timestamp}`, `{timestamp}` TTL 90d | **Highest volume collection** — one row per event per mailbox, continuously. 90-day TTL caps total size, but see missing-index findings below; volume before expiry can still be large across many mailboxes. |
| `Pattern` | Detected sender/folder-routing automation suggestions, evidence capped at 10 | `{userId,mailboxId,status}`, `{userId,patternType,condition.senderDomain}`, `{rejectionCooldownUntil}` sparse | Low — one row per distinct (sender, action) combo per mailbox; no TTL, but rejected/approved rows are small and naturally capped by distinct-sender cardinality. |
| `Rule` | User-created or pattern-derived automation rules | `{userId,mailboxId,isEnabled,priority}`, `{userId,conditions.senderEmail}`, `{graphRuleId}` sparse | Low — bounded by rules a user creates. |
| `StagedEmail` | Pending-action queue (grace period before delete/move executes) | `{userId,status,expiresAt}`, `{cleanupAt}` TTL (0s — deletes at exact time) | Low — self-draining queue, TTL always set at creation (`services/stagingManager.ts:87`). |
| `AuditLog` | Full action history (rule/pattern/staging/undo), `details: Mixed` blob | `{userId,action,createdAt}`, `{userId,mailboxId,createdAt}`, `{action,mailboxId,createdAt}`, `{targetType,targetId}`, `{createdAt}` TTL 180d | Medium — every automated + manual action writes a row; 180-day TTL bounds it but `details` is an unbounded `Mixed` field (stores full conditions/actions objects per entry). |
| `Notification` | In-app notification feed | `{userId,isRead,createdAt}`, `{createdAt}` TTL 30d | Low. |
| `ScheduledEmail` | Outbound scheduled email incl. **full body text** | `{userId,status,scheduledAt}`, `{cleanupAt}` TTL | Low-medium — stores full email body until `cleanupAt` (30d after send/cancel); an orphan-fix job (`jobs/processors/scheduledEmailCleanup.ts`) patches rows that never got a `cleanupAt` set. |
| `TrackedEmail` | Sent-mail open tracking, `opens[]` subdocs with geoip | `{mailboxId,subject,sentAt}`, `{sentAt}` TTL 180d | Low-medium — one doc per tracked send, growing `opens[]` array per doc; 180-day TTL bounds it. |
| `WebhookSubscription` | Graph API webhook subscription state | `{subscriptionId}` unique, `{userId,mailboxId}`, `{expiresAt,status}` | **No TTL, no cleanup job.** Every subscription recreation (`services/subscriptionService.ts`) marks the old row `status:'expired'` and inserts a new one — the only model of the 8 time-series-like collections with zero retention story. Low absolute volume (bounded by mailbox count × renewal churn) but unbounded over years. |
| `TunnelConfig` | Singleton cloudflared health doc | none needed | Fixed size (1 doc). |

---

## 2. Query Pattern Findings

### CRITICAL — correctness bug (not performance): 4 aggregations never match

Mongoose's `Model.aggregate()` does **not** cast query values against the schema the way `find()`/`countDocuments()` do. `req.user!.userId` is a plain `string` (`backend/src/auth/middleware.ts:13`), while `EmailEvent.userId`/`Rule.userId` are `ObjectId` fields. Comparing a bare string to an `ObjectId` in a raw `$match` never matches. The codebase clearly knows this rule — it correctly does `new Types.ObjectId(userId)` before several other aggregates (`routes/events.ts:214`, `routes/events.ts:376`, `routes/mailbox.ts:268`, `routes/rules.ts:72`) — but missed it in 4 places:

| # | Location | Effect |
|---|---|---|
| 1 | `routes/dashboard.ts:34-37` — `EmailEvent.aggregate([{ $match: { userId } }, ...])` | `perMailbox` breakdown in `GET /api/dashboard/stats` is **always `[]`** |
| 2 | `routes/dashboard.ts:66-71` — `Rule.aggregate([{ $match: ruleFilter }, ...])` with `ruleFilter = { userId }` | `rulesFired` and `stagingCount` in `GET /api/dashboard/stats` are **always `0`** |
| 3 | `routes/events.ts:300-323` (`sender-breakdown`) — `matchFilter = { userId }` uncast | `GET /api/events/sender-breakdown` (dashboard sender chart) **always returns `[]`** |
| 4 | `routes/events.ts:331-365` (`timeline`) — same pattern | `GET /api/events/timeline` (activity timeline chart) **always returns `[]`** |

**Fix**: one-line change at each site — wrap `userId` in `new Types.ObjectId(userId)` before building the aggregate `$match`, same as the 4 call sites that already do it correctly. Since all 4 share the exact same root cause, consider a small shared helper (`toObjectIdMatch(userId, extra)`) so this class of bug can't recur.

### HIGH — missing indexes for the most common access patterns

5. **No index serves the default event listing/sort.** `EmailEvent.find({userId}).sort({timestamp:-1})` (`routes/events.ts:225-236`, and `routes/dashboard.ts:133-137` for `/api/dashboard/activity`) is the single most common query (default inbox/activity view — no `eventType` or `sender.domain` filter applied). All 3 non-TTL compound indexes on `EmailEvent` require an *equality* on `eventType` or `sender.domain` sandwiched before `timestamp` for MongoDB to use them for the sort; with neither present, Mongo falls back to a collection scan + in-memory sort. **Fix**: add `{userId:1, timestamp:-1}`.
6. **No index on `receivedAt`.** `routes/events.ts:404-468` (`/summarize-today`) and `routes/events.ts:548-620` (`/summarize-today/csv`) both filter and sort on `receivedAt`, but every `EmailEvent` index is built on `timestamp`. Every "today's summary" AI call and CSV export scans + in-memory-sorts the whole (unfiltered-by-index) match set.
7. **Unanchored regex search can never use an index.** `routes/events.ts:59-67`, `routes/rules.ts:55-65`, `routes/patterns.ts:70-79` all build `{ $regex: escaped, $options: 'i' }` (no `^` anchor) across `$or` clauses on sender/subject/name fields; `routes/mailbox.ts:263-286` (autocomplete's recent-senders aggregate) does the same. Case-insensitive, non-prefix regex is a full collection scan by definition — no index change fixes this; it needs a different search primitive (see §4/§Recommendations).
8. **Folder filtering has no supporting index.** `routes/events.ts:93-173` builds a `$and:[{ $or: [toFolder equality...] }]` clause to filter to a specific folder (e.g. "Inbox only" — the single most common navigation action), but `EmailEvent.toFolder` has no index anywhere in the schema.

### MEDIUM

9. **Unbounded per-request folder-count aggregation.** `routes/mailbox.ts:415-481` (`getDbFolderCounts`, called on every folder-list page load) runs `EmailEvent.aggregate([{$match:{mailboxId, eventType:{$ne:'deleted'}}}, {$group:...}])` with **no time bound** — it re-scans and re-groups the mailbox's entire event history every time the folder tree is opened, uncached beyond the per-request Redis folder-name lookups.
10. **In-memory filtering instead of query push-down.** `routes/rules.ts:890-905` (`delete-by-sender`) loads `Rule.find({userId})` (every rule for the user) into memory and filters with `.filter()` in JS rather than a `conditions.senderEmail` query match. Fine at today's per-user rule counts; will not scale if a user accumulates hundreds of rules, and bypasses the existing `{userId,'conditions.senderEmail':1}` index entirely.
11. **`WebhookSubscription` has no retention job** (see Schema Inventory) — the only collection among 8 time-series-like ones without a TTL or cleanup pass.
12. `Mailbox.deltaLinks` dead schema field — cosmetic, remove to avoid confusing future readers into thinking it's live.

### LOW

13. `EmailEvent.findOne({ messageId })` with no `userId`/`mailboxId` scope (`services/deltaService.ts:142`, `services/eventCollector.ts:170,383`) relies on Graph message IDs being globally unique across mailboxes/tenants — true in practice, not schema-enforced. The supporting `{messageId,timestamp}` index is well chosen for this lookup regardless.
14. `routes/patterns.ts:84-115` issues an unbounded `Rule.find(ruleQuery)` (no `.limit()`) purely to compute a `hasRule` flag whenever the `hasRule` filter is used — O(all rules for the user) per request. Low severity at current rule-count scale.

---

## 3. Search Capability Assessment

Two independent, non-interoperating search stacks:

**A. Keyword/structured search** — `GET /api/events`, `/api/rules`, `/api/patterns` `search=` params. Pure Mongo `$regex`/`$or` substring match, case-insensitive, no `$text` index, no Atlas Search. Filtering (date range, folder, mailbox, read/unread) and sorting (including the computed sender-field aggregation sort in `events.ts`/`rules.ts`) are functionally complete and correct — the gap is purely indexing (§2 findings 5-8): every keyword search and every unfiltered listing is a collection scan today, which will show up as latency once `EmailEvent` grows past a few hundred thousand live (pre-TTL-expiry) documents.

**B. Semantic search** (`POST /api/ai-search`) — Ollama (`qwen3:1.7b` query parsing → structured filters, `nomic-embed-text` embeddings) → Qdrant cosine similarity with payload filters (userId/mailboxId/sender/domain/importance/hasAttachments/receivedAt range). Sound architecture for a self-hosted DGX stack — reuses infra already running rather than bolting on a new engine. Gaps found:

- **Silent, permanent embedding gaps on outage.** New "arrived" emails auto-enqueue an `email-embedding` job (`services/deltaService.ts:192-213`, `services/eventCollector.ts:266-300`) with `attempts:2, backoff: exponential 10s` — roughly 20 seconds of retry budget. If Qdrant or Ollama is down longer than that, the job fails permanently, is purged by `removeOnFail` after 24h/1000 jobs (`jobs/queues.ts:22-25`), and is never retried again. There is **no scheduled reconciliation job** — the only recovery path is an admin manually noticing and calling `POST /api/ai-search/backfill` (`routes/aiSearch.ts:147-169`, admin-only).
- **No graceful degradation.** `POST /api/ai-search` (`routes/aiSearch.ts:17-120`) has no fallback path — if Qdrant/Ollama are unreachable, the whole request 500s (`catch` → `next(err)`) instead of falling back to the Mongo keyword search that already exists in the same codebase.
- **Body-fetch-at-embed-time race.** `services/embeddingService.ts:69-100` fetches the email body live from Graph API at embed time; if the message has since been deleted/moved out of reach, embedding is silently skipped (debug-level log only) — another quiet coverage gap, distinct from the outage case above.

---

## 4. Recommendations (prioritized)

1. **Fix the 4 uncast-ObjectId aggregate bugs first** (§2 #1-4). These are live correctness bugs breaking dashboard/chart features today, independent of any performance work — 4 one-line diffs.
2. **Add two `EmailEvent` indexes**: `{userId:1, timestamp:-1}` (covers default listing + dashboard activity, §2 #5) and either an index on `receivedAt` or a code-level switch to sort/filter consistently on `timestamp` everywhere (§2 #6). Cheapest fix for the two hottest unindexed patterns.
3. **Add index support for folder filtering** — fold `toFolder` into a compound index (e.g. `{mailboxId:1, toFolder:1, timestamp:-1}`) since "view Inbox" is the single most common navigation action and is currently unindexed (§2 #8).
4. **Don't add Elasticsearch/OpenSearch.** Given self-hosted Docker on DGX, Mongo 8.2, and Qdrant+Ollama already running: a new search engine is a new container and a new failure mode for a problem the existing stack already covers.
   - Keep keyword/filter search in Mongo — the indexes above fix the perf gap; a Mongo `$text` index would add complexity without removing the need for substring/regex matching (users expect partial-word matches `$text` doesn't do well), so it's not worth introducing.
   - Keep semantic search on Qdrant/Ollama — the right choice for this stack already. The actual gap isn't the engine, it's operational resilience: add a periodic "find EmailEvents missing an embedding" reconciliation job (mirrors the existing `scheduled-email-cleanup` orphan-fix pattern), and add a fallback in `POST /api/ai-search` to the Mongo keyword search when the Qdrant/Ollama health check fails, instead of a hard 500.
5. **Add a retention pass for `WebhookSubscription`** — delete or TTL-index `status:'expired'` docs after ~30 days, matching every other collection's pattern.
6. **Cleanup**: remove the dead `Mailbox.deltaLinks` schema field.
