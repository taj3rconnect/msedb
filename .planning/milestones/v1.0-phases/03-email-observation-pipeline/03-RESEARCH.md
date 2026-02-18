# Phase 3: Email Observation Pipeline - Research

**Researched:** 2026-02-17
**Domain:** Microsoft Graph API change notifications (webhooks), delta queries, background job processing
**Confidence:** HIGH

## Summary

Phase 3 implements the email observation pipeline -- the data foundation for all intelligence and automation in MSEDB. The pipeline has four interconnected subsystems: (1) webhook subscriptions for real-time email event notifications from Microsoft Graph, (2) delta query fallback to catch events missed by webhooks, (3) event collection with metadata extraction and deduplication, and (4) background job processing via BullMQ to keep the webhook handler non-blocking.

The existing codebase provides substantial scaffolding: EmailEvent and WebhookSubscription Mongoose models with indexes, 5 BullMQ queues with schedulers, a webhook handler skeleton with validation handshake, per-mailbox MSAL authentication, and the `getAccessTokenForMailbox()` utility. The primary implementation work is: (a) building Graph API client utilities for subscription CRUD and delta queries, (b) implementing real webhook-renewal and delta-sync BullMQ processors, (c) enhancing the webhook handler to enqueue notification payloads into BullMQ, and (d) building the event processing pipeline that extracts metadata and stores deduplicated EmailEvent documents.

**Primary recommendation:** Use direct `fetch()` calls to the Graph REST API (no `@microsoft/microsoft-graph-client` SDK) since the project already does not include the SDK, the calls are straightforward REST operations, and direct calls give full control over headers, error handling, and token injection. Store deltaLinks in Redis keyed by `delta:{mailboxId}:{folderId}` with no TTL (they are replaced on each sync).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| OBSV-01 | Webhook subscriptions per mailbox; change notifications for messages; lifecycle notifications for subscription health | Graph subscription API supports `created,updated,deleted` changeType for messages. Max expiration 10,080 min (~7 days) but project renews every 2h. `lifecycleNotificationUrl` must be set at creation time. Lifecycle events: `subscriptionRemoved`, `missed`, `reauthorizationRequired`. |
| OBSV-02 | Delta query fallback every 15 min per mailbox per folder; deltaLink storage in Redis; 410 Gone handling | Delta query endpoint: `GET /users/{id}/mailFolders/{folderId}/messages/delta`. Returns `@odata.nextLink` (pagination) or `@odata.deltaLink` (sync complete). Deleted items marked with `@removed.reason: "deleted"`. 410 Gone = expired token, reset to full sync. `$select` supported. |
| OBSV-03 | Event collection -- extract metadata only, never body content; deduplicate via compound index | EmailEvent model already has compound unique index on `userId + mailboxId + messageId + eventType`. SELECT_FIELDS.message already excludes body. Graph message properties include `from`, `subject`, `receivedDateTime`, `isRead`, `importance`, `hasAttachments`, `conversationId`, `categories`, `parentFolderId`, `internetMessageHeaders`. |
| OBSV-04 | Background job processing -- webhook handler returns 202 immediately; all Graph API calls via BullMQ workers | BullMQ queues (`webhook-renewal`, `delta-sync`) already exist with schedulers. ProcessorMap pattern in queues.ts maps queue names to processor functions. Need new `webhook-events` queue for ad-hoc notification processing or reuse existing queues with named jobs. |
</phase_requirements>

## Standard Stack

### Core (already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | ^5.0.1 | HTTP server, webhook endpoint | Already in use |
| bullmq | ^5.69.3 | Background job processing | Already in use, queues and schedulers created |
| mongoose | ^8.23.0 | MongoDB ODM, EmailEvent/WebhookSubscription models | Already in use, models defined |
| ioredis | ^5.9.3 | Redis client for deltaLink storage | Already in use for BullMQ |
| @azure/msal-node | ^3.8.7 | Token acquisition for Graph API calls | Already in use, per-mailbox MSAL clients |
| uuid | ^13.0.0 | Generating clientState secrets | Already installed |

### New Dependencies Required

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | - | - | Node.js 22 native `fetch` is sufficient for Graph REST API calls. No SDK needed. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native `fetch` | `@microsoft/microsoft-graph-client` | SDK adds ~250KB bundle, provides fluent API but MSEDB only needs simple REST calls. Direct fetch gives full control and avoids SDK version lock-in. Not recommended. |
| Redis for deltaLinks | Mailbox.deltaLinks (MongoDB) | Mailbox model already has `deltaLinks: Map<string, string>`. Could use MongoDB instead of Redis. However, Redis is faster for frequent reads (every 15 min per mailbox per folder) and avoids write amplification on the Mailbox document. Recommend Redis. |

**No additional installation needed.** All dependencies are already in `package.json`.

## Architecture Patterns

### Recommended Project Structure

```
backend/src/
  services/
    graphClient.ts         # Graph API HTTP client (fetch wrapper with auth)
    subscriptionService.ts # Webhook subscription CRUD (create, renew, delete, list)
    deltaService.ts        # Delta query execution and deltaLink management
    eventCollector.ts      # Process notifications into EmailEvent documents
    metadataExtractor.ts   # Extract metadata from Graph message objects
  jobs/
    processors/
      webhookRenewal.ts    # BullMQ processor: renew/recreate subscriptions
      deltaSync.ts         # BullMQ processor: run delta queries per mailbox
      webhookEvents.ts     # BullMQ processor: process incoming notifications
    queues.ts              # Add webhook-events queue (or use existing queues)
  routes/
    webhooks.ts            # Enhanced: enqueue notifications into BullMQ
  utils/
    graph.ts               # Already exists: SELECT_FIELDS, buildSelectParam()
```

### Pattern 1: Graph API Client with Token Injection

**What:** A thin wrapper around native `fetch` that injects Bearer token and handles errors.
**When to use:** Every Graph API call in the project.
**Example:**
```typescript
// Source: Microsoft Graph REST API v1.0 documentation
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

interface GraphClientOptions {
  accessToken: string;
}

async function graphFetch(
  path: string,
  options: GraphClientOptions & RequestInit = {} as any,
): Promise<Response> {
  const { accessToken, ...fetchOptions } = options;
  const url = path.startsWith('http') ? path : `${GRAPH_BASE}${path}`;

  const response = await fetch(url, {
    ...fetchOptions,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...fetchOptions.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new GraphApiError(response.status, errorBody, path);
  }

  return response;
}
```

### Pattern 2: Webhook Handler with BullMQ Enqueue (Zero Blocking)

**What:** Webhook handler validates clientState, enqueues notifications into BullMQ, returns 202 immediately.
**When to use:** The POST /webhooks/graph endpoint.
**Example:**
```typescript
// Source: Microsoft Graph webhook delivery documentation
router.post('/webhooks/graph', async (req: Request, res: Response) => {
  // 1. Validation handshake (already implemented)
  const validationToken = req.query.validationToken as string | undefined;
  if (validationToken) {
    res.set('Content-Type', 'text/plain');
    res.status(200).send(validationToken);
    return;
  }

  // 2. Return 202 immediately (CRITICAL: within 3 seconds)
  res.status(202).json({ status: 'accepted' });

  // 3. Enqueue each notification for async processing
  const notifications = req.body?.value ?? [];
  for (const notification of notifications) {
    // Determine if this is a lifecycle notification or change notification
    if (notification.lifecycleEvent) {
      await queues['webhook-renewal'].add('lifecycle-event', notification);
    } else {
      await queues['delta-sync'].add('webhook-notification', notification);
      // or use a dedicated queue
    }
  }
});
```

### Pattern 3: Delta Query with Pagination and deltaLink Storage

**What:** Execute delta queries per folder, follow nextLink pagination, store deltaLink in Redis.
**When to use:** The delta-sync BullMQ processor.
**Example:**
```typescript
// Source: Microsoft Graph delta query messages documentation
const DELTA_KEY_PREFIX = 'delta';

async function runDeltaSync(
  mailboxId: string,
  folderId: string,
  accessToken: string,
  redis: Redis,
): Promise<GraphMessage[]> {
  const deltaKey = `${DELTA_KEY_PREFIX}:${mailboxId}:${folderId}`;
  const storedDeltaLink = await redis.get(deltaKey);

  let url: string;
  if (storedDeltaLink) {
    url = storedDeltaLink; // Resume from deltaLink
  } else {
    // Initial full sync
    const select = buildSelectParam('message');
    url = `${GRAPH_BASE}/users/${userPrincipalName}/mailFolders/${folderId}/messages/delta?$select=${select}`;
  }

  const allMessages: GraphMessage[] = [];

  while (url) {
    let response: Response;
    try {
      response = await graphFetch(url, { accessToken });
    } catch (err) {
      if (err instanceof GraphApiError && err.status === 410) {
        // Delta token expired -- reset to full sync
        await redis.del(deltaKey);
        return runDeltaSync(mailboxId, folderId, accessToken, redis);
      }
      throw err;
    }

    const data = await response.json();
    allMessages.push(...(data.value ?? []));

    if (data['@odata.nextLink']) {
      url = data['@odata.nextLink']; // More pages
    } else if (data['@odata.deltaLink']) {
      await redis.set(deltaKey, data['@odata.deltaLink']); // Store for next run
      url = ''; // Done
    } else {
      url = ''; // Should not happen, but safety exit
    }
  }

  return allMessages;
}
```

### Pattern 4: Subscription Creation with Lifecycle URL

**What:** Create a Graph subscription for a mailbox's messages with lifecycle notification support.
**When to use:** When a mailbox is first connected and on webhook renewal.
**Example:**
```typescript
// Source: Microsoft Graph subscription creation documentation
async function createSubscription(
  mailboxId: string,
  accessToken: string,
  webhookBaseUrl: string,
): Promise<GraphSubscription> {
  const clientState = crypto.randomUUID();

  const body = {
    changeType: 'created,updated,deleted',
    notificationUrl: `${webhookBaseUrl}/webhooks/graph`,
    lifecycleNotificationUrl: `${webhookBaseUrl}/webhooks/graph`,
    resource: `me/messages`,
    expirationDateTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours
    clientState,
  };

  const response = await graphFetch('/subscriptions', {
    accessToken,
    method: 'POST',
    body: JSON.stringify(body),
  });

  return response.json();
}
```

### Anti-Patterns to Avoid

- **Blocking in webhook handler:** NEVER make Graph API calls or MongoDB writes inside the webhook POST handler. Return 202 immediately and process via BullMQ. Microsoft Graph drops notifications if the endpoint is slow (>10s throttle, >15% drops).
- **Subscribing to `me/mailFolders('Inbox')/messages` only:** This misses events in other folders. Subscribe to `me/messages` to catch all message events across all folders, or subscribe per-folder if you need folder-level granularity. However, `me/messages` is simpler and catches cross-folder moves.
- **Storing deltaLinks with TTL in Redis:** deltaLinks do not expire on their own -- they expire server-side and return 410 Gone. Do NOT set a TTL on the Redis key; let the server tell you when it is expired.
- **Processing notifications synchronously in order:** Notifications can arrive out of order and in batches. The dedup index handles duplicates. Process them concurrently via BullMQ workers.
- **Using `me/` resource path for subscription creation with delegated tokens in background:** When creating subscriptions from background jobs (not in user context), use `users/{userId}/messages` instead of `me/messages`. The `me` path requires a user context.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Webhook validation handshake | Custom token validation | Use the exact validationToken echo pattern from Graph docs | Already implemented in webhooks.ts; just maintain it |
| Subscription renewal scheduling | Custom cron/setTimeout | BullMQ upsertJobScheduler (already configured, every 2h) | Already in schedulers.ts; just implement the processor |
| Delta query pagination | Custom link-following logic | Follow `@odata.nextLink` / `@odata.deltaLink` pattern | Standard Graph API pattern, but DO implement it correctly |
| Event deduplication | Custom duplicate checking | MongoDB compound unique index + `insertOne` with duplicate key error handling | Already configured in EmailEvent model; use `insertOne` and catch error code 11000 |
| Exponential backoff for retries | Custom retry logic | BullMQ built-in `attempts` + `backoff: { type: 'exponential' }` | Already configured in schedulerJobOpts |
| clientState validation | Custom HMAC/signing | Use `uuid` to generate random clientState per subscription; compare on receipt | Simple string comparison, no crypto needed for clientState |

**Key insight:** The existing codebase has already scaffolded the hardest infrastructure pieces (BullMQ queues, Mongoose models with indexes, MSAL auth, webhook handshake). Phase 3 is primarily about implementing the processor functions and connecting them to the Graph API.

## Common Pitfalls

### Pitfall 1: Webhook Subscriptions Silently Expire

**What goes wrong:** Subscriptions expire after max 7 days (10,080 min) for Outlook messages. If the renewal job fails or the server restarts without re-establishing subscriptions, events are silently missed.
**Why it happens:** The 2-hour renewal interval is conservative and good, but the renewal job must also recreate subscriptions that were removed by Graph (subscriptionRemoved lifecycle event).
**How to avoid:**
1. On startup, query all WebhookSubscription documents and re-create any that are expired or missing.
2. Handle `subscriptionRemoved` lifecycle events by immediately recreating the subscription.
3. Handle `missed` lifecycle events by triggering an immediate delta sync.
4. Handle `reauthorizationRequired` by calling `POST /subscriptions/{id}/reauthorize` or renewing.
**Warning signs:** WebhookSubscription.lastNotificationAt stops updating; no new EmailEvents appearing.

### Pitfall 2: Webhook Handler Exceeds 3-Second Response Time

**What goes wrong:** If the webhook handler makes Graph API calls, writes to MongoDB, or does any I/O before returning 202, Microsoft Graph throttles or drops notifications. More than 10% of responses >10s = "slow" state (10s delay on notifications). More than 15% = "drop" state (notifications dropped for 10 minutes).
**Why it happens:** Temptation to "just quickly" validate and process inline.
**How to avoid:** The handler must ONLY: (1) validate clientState, (2) enqueue into BullMQ, (3) return 202. Zero blocking operations.
**Warning signs:** Graph API sends `missed` lifecycle notifications; notification gaps in data.

### Pitfall 3: Delta Token Expiration (410 Gone)

**What goes wrong:** Delta tokens can expire server-side after extended periods without use. The delta query returns HTTP 410 Gone.
**Why it happens:** If a mailbox goes unused for a long period, or if the delta sync job was disabled.
**How to avoid:** On 410 Gone, delete the stored deltaLink from Redis and restart with a full initial sync (no deltaToken). This is expected behavior, not an error.
**Warning signs:** 410 responses in delta sync logs.

### Pitfall 4: Duplicate Events from Webhook + Delta Sync Overlap

**What goes wrong:** Both webhooks and delta sync can report the same event, leading to duplicate EmailEvent documents.
**Why it happens:** Delta sync runs every 15 minutes and picks up events that webhooks already delivered. This is BY DESIGN -- delta sync is a safety net.
**How to avoid:** Use MongoDB's compound unique index (`userId + mailboxId + messageId + eventType`). On insert, catch the duplicate key error (code 11000) and silently skip. Do NOT use `upsert` -- it would overwrite timestamps.
**Warning signs:** High rate of 11000 errors is normal and expected; NOT a problem.

### Pitfall 5: `me/` vs `users/{id}/` Resource Path

**What goes wrong:** Using `me/messages` as the subscription resource path works during user-context creation but fails for renewal from background jobs.
**Why it happens:** The `me/` prefix resolves to the signed-in user context. Background jobs (BullMQ workers) do not have a user context.
**How to avoid:** Always use `users/{userPrincipalName}/messages` or `users/{userId}/messages` for subscription resources. Store the user's Graph ID or UPN in the Mailbox model.
**Warning signs:** 401 or 404 errors during subscription renewal from BullMQ workers.

### Pitfall 6: Detecting Message Moves Between Folders

**What goes wrong:** Graph webhook notifications for message "updated" include the parentFolderId, but the notification itself does not tell you the previous folder. You get an "updated" event, not a "moved" event.
**Why it happens:** Graph change notifications report changeType `created`, `updated`, or `deleted` -- there is no `moved` changeType. A move manifests as: (a) `deleted` from source folder if subscribing per-folder, or (b) `updated` with new `parentFolderId` if subscribing to all messages.
**How to avoid:** Track the previous `parentFolderId` for each messageId. When an "updated" notification arrives and parentFolderId has changed, generate a "moved" EmailEvent with fromFolder/toFolder. This requires a lookup of the last known state, which can be done via the most recent EmailEvent for that messageId.
**Warning signs:** No "moved" events appearing despite users moving emails.

### Pitfall 7: Cloudflare Tunnel Must Be Up Before Subscription Creation

**What goes wrong:** Subscription creation requires Microsoft Graph to POST a validationToken to the notificationUrl. If the Cloudflare Tunnel is not running or the URL is unreachable, subscription creation fails with validation error.
**Why it happens:** Graph validates the endpoint during subscription creation, not just at notification time.
**How to avoid:** Ensure the Cloudflare Tunnel is up and the `GRAPH_WEBHOOK_URL` env var is set before the webhook-renewal processor runs. Add a health check for tunnel reachability in the startup sequence.
**Warning signs:** Subscription creation failing with "Subscription validation request timed out" error.

## Code Examples

### Webhook Notification Payload Structure (from Graph)
```json
{
  "value": [
    {
      "subscriptionId": "7f105c7d-2dc5-4530-97cd-4e7ae6534c07",
      "subscriptionExpirationDateTime": "2026-03-20T11:00:00.0000000Z",
      "changeType": "created",
      "resource": "Users/722effaf-0433-4272-9ac4-d5ec11c3cd77/messages/AAMkAGUwNjQ4ZjIxAAA=",
      "clientState": "secretClientValue",
      "tenantId": "84bd8158-6d4d-4958-8b9f-9d6445542f95",
      "resourceData": {
        "@odata.type": "#Microsoft.Graph.Message",
        "@odata.id": "Users/722effaf-0433-4272-9ac4-d5ec11c3cd77/Messages/AAMkAGUwNjQ4ZjIxAAA=",
        "@odata.etag": "W/\"CQAAABYAAADkrWGo7bouTKlsgTZMr9KwAAAUWRHf\"",
        "id": "AAMkAGUwNjQ4ZjIxAAA="
      }
    }
  ]
}
```

### Lifecycle Notification Payload Structure
```json
{
  "value": [
    {
      "subscriptionId": "7f105c7d-2dc5-4530-97cd-4e7ae6534c07",
      "subscriptionExpirationDateTime": "2026-03-20T11:00:00.0000000Z",
      "tenantId": "84bd8158-6d4d-4958-8b9f-9d6445542f95",
      "clientState": "secretClientValue",
      "lifecycleEvent": "subscriptionRemoved"
    }
  ]
}
```

### Delta Query Response -- Deleted Item
```json
{
  "@odata.type": "#microsoft.graph.message",
  "id": "AAMkADk0MGFkODE3LWE4MmYtNDRhOS0Dh_6qB",
  "@removed": {
    "reason": "deleted"
  }
}
```

### Metadata Extraction from Graph Message
```typescript
// Source: Graph message resource type + PRD Event Data Model
interface GraphMessage {
  id: string;
  subject?: string;
  from?: { emailAddress: { name?: string; address?: string } };
  receivedDateTime?: string;
  isRead?: boolean;
  importance?: string;
  hasAttachments?: boolean;
  conversationId?: string;
  categories?: string[];
  parentFolderId?: string;
  internetMessageId?: string;
  internetMessageHeaders?: Array<{ name: string; value: string }>;
  flag?: { flagStatus: string };
  '@removed'?: { reason: string };
}

function extractMetadata(msg: GraphMessage): Partial<IEmailEvent> {
  const senderEmail = msg.from?.emailAddress?.address?.toLowerCase();
  const senderDomain = senderEmail ? senderEmail.split('@')[1] : undefined;

  // Check internet message headers for newsletter/automation indicators
  const headers = msg.internetMessageHeaders ?? [];
  const hasListUnsubscribe = headers.some(h => h.name.toLowerCase() === 'list-unsubscribe');
  const isAutomated = headers.some(h =>
    h.name.toLowerCase() === 'x-auto-response-suppress'
  );

  return {
    messageId: msg.id,
    internetMessageId: msg.internetMessageId,
    subject: msg.subject,
    sender: {
      name: msg.from?.emailAddress?.name,
      email: senderEmail,
      domain: senderDomain,
    },
    receivedAt: msg.receivedDateTime ? new Date(msg.receivedDateTime) : undefined,
    importance: (msg.importance?.toLowerCase() as 'low' | 'normal' | 'high') ?? 'normal',
    hasAttachments: msg.hasAttachments ?? false,
    conversationId: msg.conversationId,
    categories: msg.categories ?? [],
    isRead: msg.isRead ?? false,
    metadata: {
      hasListUnsubscribe,
      isNewsletter: hasListUnsubscribe, // Heuristic: List-Unsubscribe = newsletter
      isAutomated,
    },
  };
}
```

### BullMQ Processor Pattern (following existing tokenRefresh pattern)
```typescript
// Source: Existing tokenRefresh.ts processor pattern
import type { Job } from 'bullmq';
import logger from '../../config/logger.js';

export async function processWebhookRenewal(job: Job): Promise<void> {
  logger.info('Webhook renewal job started', { jobId: job.id });

  // 1. Find all connected mailboxes
  // 2. For each mailbox, check/renew/recreate subscription
  // 3. Log results

  logger.info('Webhook renewal job completed', { jobId: job.id });
}
```

### MongoDB Deduplication via Unique Index
```typescript
// Source: Mongoose unique index error handling
import { EmailEvent } from '../models/EmailEvent.js';

async function saveEmailEvent(eventData: Partial<IEmailEvent>): Promise<boolean> {
  try {
    await EmailEvent.create(eventData);
    return true; // New event saved
  } catch (err: any) {
    if (err.code === 11000) {
      // Duplicate -- already have this event, skip silently
      return false;
    }
    throw err; // Re-throw unexpected errors
  }
}
```

### Redis deltaLink Storage
```typescript
// Source: ioredis documentation + Graph delta query docs
import { getRedisClient } from '../config/redis.js';

const DELTA_KEY_PREFIX = 'delta';

function deltaKey(mailboxId: string, folderId: string): string {
  return `${DELTA_KEY_PREFIX}:${mailboxId}:${folderId}`;
}

async function getDeltaLink(mailboxId: string, folderId: string): Promise<string | null> {
  const redis = getRedisClient();
  return redis.get(deltaKey(mailboxId, folderId));
}

async function setDeltaLink(mailboxId: string, folderId: string, link: string): Promise<void> {
  const redis = getRedisClient();
  await redis.set(deltaKey(mailboxId, folderId), link);
  // NO TTL -- deltaLinks expire server-side (410 Gone)
}

async function deleteDeltaLink(mailboxId: string, folderId: string): Promise<void> {
  const redis = getRedisClient();
  await redis.del(deltaKey(mailboxId, folderId));
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `BullMQ repeat` option for scheduled jobs | `upsertJobScheduler` API | BullMQ v5 | Already using new API in schedulers.ts |
| `@microsoft/microsoft-graph-client` SDK | Direct `fetch()` to REST API | Trend in 2024-2025 | SDK adds bundle weight; direct fetch is simpler for REST-only usage |
| Polling for email changes | Webhooks + Delta Query hybrid | Graph API standard | Webhooks for real-time, delta for reliability. Industry best practice. |
| Storing deltaLinks in MongoDB | Redis for deltaLinks | Performance optimization | High-frequency reads (every 15 min per folder) benefit from Redis speed |

**Deprecated/outdated:**
- `$deltatoken=latest` is NOT supported for mail messages (only directory/OneDrive resources). Must do full initial sync.
- `lifecycleNotificationUrl` cannot be added to an existing subscription via PATCH. Must delete and recreate the subscription.

## Key Technical Facts

### Subscription Limits and Timing
- **Max subscriptions per mailbox:** 1,000 across all applications
- **Max expiration for mail messages:** 10,080 minutes (~7 days)
- **Project renewal interval:** Every 2 hours (conservative, well within limit)
- **Supported changeTypes for messages:** `created`, `updated`, `deleted`
- **Average notification latency:** Less than 1 minute; max 3 minutes
- **clientState max length:** 128 characters

### Delta Query Behavior
- Delta query is **per-folder** -- must track each folder individually
- `$select` is supported and recommended (use `buildSelectParam('message')`)
- `$filter` limited to `receivedDateTime ge/gt {value}` (max 5,000 messages with filter)
- Deleted messages appear with `@removed: { reason: "deleted" }`
- Updated messages appear with full selected properties
- `@odata.nextLink` = more pages; `@odata.deltaLink` = sync complete
- **410 Gone** = delta token expired, must restart full sync

### Webhook Handler Requirements
- Must return 2xx within 10 seconds (3 seconds recommended)
- Must echo `validationToken` as `text/plain` with 200 during creation
- Must validate `clientState` on every notification
- Notifications can be batched (multiple changes in one POST)
- Lifecycle and change notifications can arrive at the same URL

### Folders to Track
- Inbox, Sent Items, Drafts, Deleted Items, Archive, Junk Email
- Plus any custom folders the user has created
- Can discover folders via: `GET /users/{id}/mailFolders?$select=id,displayName`
- Well-known folder names map to IDs via: `GET /users/{id}/mailFolders/{wellKnownName}`

## Cloudflare Tunnel Setup

The Cloudflare Tunnel must be operational BEFORE webhook subscriptions can be created. The tunnel provides a public HTTPS URL that forwards to the backend's port 8010.

### Setup Steps
1. Install `cloudflared` on the DGX host (not in container)
2. Authenticate: `cloudflared tunnel login`
3. Create tunnel: `cloudflared tunnel create msedb-webhooks`
4. Configure `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: <tunnel-id>
   credentials-file: /root/.cloudflared/<tunnel-id>.json
   ingress:
     - hostname: msedb-webhooks.yourdomain.com
       service: http://localhost:8010
     - service: http_status:404
   ```
5. Route DNS: `cloudflared tunnel route dns msedb-webhooks msedb-webhooks.yourdomain.com`
6. Install as systemd service: `cloudflared service install`
7. Set `GRAPH_WEBHOOK_URL=https://msedb-webhooks.yourdomain.com` in backend `.env`

### Important Considerations
- Cloudflare automatically provides HTTPS (required by Graph API)
- The tunnel runs on the host, NOT inside Docker (it routes to localhost:8010 which Docker exposes)
- Must configure Cloudflare bot protection to ALLOW Graph API webhook POST requests to `/webhooks/graph`
- The PRD notes this was deferred from Phase 1 to Phase 3 as a prerequisite

## Webhook-Events Queue Decision

The existing codebase has 5 queues but no dedicated queue for processing incoming webhook notifications. Two options:

**Option A: Add a new `webhook-events` queue (RECOMMENDED)**
- Clean separation of concerns
- Dedicated workers can scale independently
- No interference with scheduled renewal/sync jobs
- Requires adding to QUEUE_NAMES, processorMap, and creating processor

**Option B: Reuse `delta-sync` queue with named jobs**
- The delta-sync queue could process both scheduled delta-sync jobs and ad-hoc webhook notification jobs
- Simpler (no new queue), but mixes concerns
- Harder to tune concurrency independently

**Recommendation:** Add a `webhook-events` queue. The webhook handler can receive high-volume bursts (50+ notifications in seconds during bulk operations), and these should not compete with the scheduled delta-sync job for worker resources.

## Open Questions

1. **Which folders to subscribe/sync?**
   - What we know: Delta query is per-folder. PRD says "monitor Inbox and any folder."
   - What's unclear: Should we discover and track ALL folders, or start with well-known ones (Inbox, Sent, Deleted, Archive)?
   - Recommendation: Start by subscribing to `users/{id}/messages` (all messages) for webhooks, and run delta sync on well-known folders only (Inbox, SentItems, DeletedItems, Archive, Drafts, JunkEmail). User-created folders can be added later.

2. **Graph user ID for background operations**
   - What we know: `me/` path does not work in background jobs. Need `users/{id}/` path.
   - What's unclear: Should we store Graph user ID, userPrincipalName, or both in the Mailbox model?
   - Recommendation: Store the user's Microsoft Graph ID (from the `id` field of the `/me` response during initial OAuth) in the Mailbox model as a new `graphUserId` field. This is a GUID that works universally.

3. **Folder ID-to-name mapping**
   - What we know: Graph API returns `parentFolderId` as an opaque ID, not a human-readable name.
   - What's unclear: How to efficiently map folder IDs to display names for EmailEvent storage.
   - Recommendation: On initial mailbox connection and periodically during delta sync, fetch folder list and cache ID-to-name mapping in Redis. Store both `folderId` and resolved `folderName` in EmailEvent.

## Sources

### Primary (HIGH confidence)
- [Microsoft Graph subscription resource type](https://learn.microsoft.com/en-us/graph/api/resources/subscription?view=graph-rest-1.0) - Subscription properties, max expiration times, latency table
- [Create subscription API](https://learn.microsoft.com/en-us/graph/api/subscription-post-subscriptions?view=graph-rest-1.0) - Permissions, request format, validation
- [Change notifications via webhooks](https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks) - Notification payload structure, throttling, validation handshake
- [Lifecycle notifications](https://learn.microsoft.com/en-us/graph/change-notifications-lifecycle-events) - subscriptionRemoved, missed, reauthorizationRequired handling
- [Outlook change notifications](https://learn.microsoft.com/en-us/graph/outlook-change-notifications-overview) - Outlook-specific change notification details, resource paths
- [Delta query for messages](https://learn.microsoft.com/en-us/graph/delta-query-messages) - deltaLink/nextLink pattern, $select support, pagination
- [message:delta API](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0) - API reference for delta function
- Existing codebase: EmailEvent.ts, WebhookSubscription.ts, Mailbox.ts, queues.ts, schedulers.ts, webhooks.ts, graph.ts, tokenManager.ts

### Secondary (MEDIUM confidence)
- [Cloudflare Tunnel docs](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/) - Tunnel setup, config.yml, systemd service
- [Run as service on Linux](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/linux/) - systemd installation

### Tertiary (LOW confidence)
- Community reports on subscription expiration issues (Microsoft Q&A) - Real-world subscription behavior may differ from documentation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already installed and verified in codebase
- Architecture: HIGH - Patterns derived from official Microsoft Graph documentation and existing codebase structure
- Pitfalls: HIGH - Documented in official Microsoft docs (throttling thresholds, lifecycle events, delta token expiration)
- Cloudflare Tunnel: MEDIUM - Standard setup but host-specific configuration needed

**Research date:** 2026-02-17
**Valid until:** 2026-04-17 (60 days -- Graph API is stable, subscription mechanics rarely change)
