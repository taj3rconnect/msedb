# Phase 6: Automation & Safety - Research

**Researched:** 2026-02-17
**Domain:** Rule engine, Microsoft Graph API messageRule CRUD, staging/safety mechanisms, drag-and-drop UI
**Confidence:** HIGH

## Summary

Phase 6 is the core automation phase -- converting approved patterns into executable rules, evaluating incoming emails against those rules, and wrapping every destructive action in safety mechanisms (staging folder, kill switch, whitelist, undo, audit log). The domain spans three major areas: (1) backend rule engine with Microsoft Graph API integration for message operations (move, mark read, categorize, delete-to-staging), (2) a BullMQ staging processor that executes expired staged items, and (3) three new frontend pages (Rules, Staging, Audit Log) with the Rules page requiring drag-and-drop reordering.

The codebase already has substantial infrastructure in place: the Rule, StagedEmail, and AuditLog Mongoose models are defined with appropriate schemas and indexes; the `staging-processor` BullMQ queue and scheduler (every 30 min) exist with a placeholder processor; the kill switch toggle (automationPaused) is wired end-to-end from User preferences through the Topbar KillSwitch component; the Mailbox model already has `whitelistedSenders` and `whitelistedDomains` arrays in its settings; Socket.IO is established with user rooms; and the patterns approval flow already creates AuditLog entries. The primary work is building the rule evaluation service, Graph API action executor, staging manager, pattern-to-rule converter, whitelist/undo services, and three frontend pages.

**Primary recommendation:** Build the rule engine as a pure service layer (`ruleEngine.ts`) that is called from the existing `processChangeNotification` flow when a new email arrives. Use `@dnd-kit/core` + `@dnd-kit/sortable` (v6.x, peer dep `>=16.8.0` -- compatible with React 19) for the drag-and-drop Rules page. Never use Graph API `permanentDelete` -- all deletes route through staging first, then to Deleted Items via `message/move` to `deleteditems`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AUTO-01 | Multi-action automation rules (move + mark read + categorize) via Graph API | Graph API supports combined actions in a single messageRule via messageRuleActions (moveToFolder + markAsRead + assignCategories). The existing Rule model already has an `actions: IRuleAction[]` array supporting multiple actions per rule with ordering. |
| AUTO-02 | Rule management -- CRUD with priority ordering, enable/disable, per-rule stats | Rule model has `priority`, `isEnabled`, `stats` fields. API needs CRUD endpoints at `/api/rules`. Priority reorder via `PUT /api/rules/reorder`. Stats updated on each execution. |
| AUTO-03 | Rule engine evaluation order: kill switch -> whitelist -> priority rules (first-match-wins) | User.preferences.automationPaused is already stored. Mailbox.settings has whitelistedSenders/whitelistedDomains. Rule model has compound index on `userId + mailboxId + isEnabled + priority`. |
| AUTO-04 | Pattern-to-rule conversion -- approved patterns to Graph API messageRule JSON | Pattern model has `condition` and `suggestedAction` that map directly to Graph API `messageRulePredicates` (fromAddresses, senderContains, subjectContains) and `messageRuleActions` (moveToFolder, delete, markAsRead, assignCategories). The approve endpoint already updates pattern status. |
| SAFE-01 | Staging folder with 24-hour grace period, BullMQ processor every 30 min | StagedEmail model exists with `stagedAt`, `expiresAt`, `status` fields. Queue `staging-processor` is registered with 30-min scheduler. Need to implement processor + create "MSEDB Staging" folder via Graph API `POST /users/{email}/mailFolders`. |
| SAFE-02 | Kill switch -- single toggle to pause ALL automation | Already implemented: User.preferences.automationPaused, PATCH /api/user/preferences, KillSwitch component in Topbar. Rule engine just needs to check this flag first. |
| SAFE-03 | Undo within 48 hours, soft-delete only, never permanentDelete | AuditLog model has `undoable`, `undoneAt`, `undoneBy` fields. Graph API `message/move` with destinationId can reverse moves. Use `PATCH /users/{email}/messages/{id}` to restore read/category state. |
| SAFE-04 | Sender/domain whitelist, per-mailbox and org-wide | Mailbox.settings already has `whitelistedSenders` and `whitelistedDomains` arrays. Need org-wide whitelist (either on a global settings doc or admin-managed). Need API endpoints and rule engine integration. |
| SAFE-05 | Audit log of all automated actions with undo button per entry | AuditLog model is complete. Need REST API endpoints: `GET /api/audit` (paginated + filtered), `POST /api/audit/:id/undo`. AuditLog already tracks rule_executed, email_staged, email_rescued, undo_action types. |
| PAGE-03 | Rules page with drag-and-drop reorder, enable/disable, per-rule stats | Use `@dnd-kit/core` + `@dnd-kit/sortable` for drag-and-drop (compatible with React 19). Existing Rule model supports all required fields. |
| PAGE-04 | Staging page with countdown timers, batch rescue/execute, per-mailbox filtering | StagedEmail model has `expiresAt` for countdown calculation. Need `GET /api/staging`, `POST /api/staging/:id/rescue`, batch endpoints. Socket.IO push on staging entry for real-time badge. |
| PAGE-05 | Audit log page with filterable history and undo per row | AuditLog model has compound indexes on userId + action + createdAt and userId + mailboxId + createdAt. Filter by mailbox, rule, action type, date range. Undo button on rows where `undoable === true` and `undoneAt` is null and `createdAt` is within 48 hours. |
</phase_requirements>

## Standard Stack

### Core (Already in Project)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Express 5 | ^5.0.1 | REST API for rules, staging, audit endpoints | Already used across all backend routes |
| Mongoose 8 | ^8.23.0 | Rule, StagedEmail, AuditLog models (already defined) | Already used for all 9 models |
| BullMQ 5 | ^5.69.3 | staging-processor queue (already registered) | Already powers 6 queues with processorMap pattern |
| Socket.IO 4 | ^4.8.3 | Real-time staging notifications, badge updates | Already established with JWT auth and user rooms |
| TanStack Query 5 | ^5.90.21 | Data fetching/caching for rules, staging, audit pages | Already used for dashboard, events, patterns |
| Zustand 5 | ^5.0.11 | UI state (sidebar, mailbox selection) | Already used for auth and UI stores |

### New Dependencies

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@dnd-kit/core` | ^6.3.1 | Drag-and-drop framework for rule reordering | Rules page only |
| `@dnd-kit/sortable` | ^10.0.0 | Sortable preset for ordered lists | Rules page only |
| `@dnd-kit/utilities` | ^3.2.2 | CSS utilities for transforms | Rules page only |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@dnd-kit/core` | `@hello-pangea/dnd` | hello-pangea/dnd peer dep is `react@^18.0.0` -- does NOT support React 19 which this project uses. Ruled out. |
| `@dnd-kit/core` | `@dnd-kit/react` (v0.3.0) | New ground-up rewrite, still at 0.x (unstable). Too risky for production. Stick with stable `@dnd-kit/core` v6 which has `>=16.8.0` peer dep. |
| Custom rule engine | Graph API messageRule only | Graph messageRules only apply to Inbox and can't implement staging/whitelist/audit. Need a local engine that intercepts incoming emails and applies our logic before calling Graph API for actions. |

**Installation:**
```bash
cd frontend && npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

## Architecture Patterns

### Recommended Project Structure (New Files)

```
backend/src/
  services/
    ruleEngine.ts          # Core rule evaluation (kill switch -> whitelist -> priority match)
    ruleConverter.ts       # Pattern-to-rule and rule-to-Graph-messageRule conversion
    actionExecutor.ts      # Execute Graph API actions (move, markRead, categorize, stage)
    stagingManager.ts      # Staging folder CRUD, rescue, expiry logic
    undoService.ts         # Reverse automated actions within 48h window
    whitelistService.ts    # Whitelist check logic (per-mailbox + org-wide)
  jobs/processors/
    stagingProcessor.ts    # BullMQ processor for expired staged items (replace placeholder)
  routes/
    rules.ts               # CRUD + reorder + enable/disable
    staging.ts             # List, rescue, execute, batch operations
    audit.ts               # Paginated list + undo

frontend/src/
  api/
    rules.ts               # Rule CRUD API functions
    staging.ts             # Staging API functions
    audit.ts               # Audit log API functions
  hooks/
    useRules.ts            # TanStack Query hooks for rules
    useStaging.ts          # TanStack Query hooks for staging
    useAudit.ts            # TanStack Query hooks for audit
  components/
    rules/
      RuleCard.tsx         # Individual rule display with stats, enable/disable
      RuleList.tsx         # Sortable list container with dnd-kit
      RuleFilters.tsx      # Per-mailbox filter
    staging/
      StagedEmailRow.tsx   # Individual staged email with countdown timer
      StagingFilters.tsx   # Per-mailbox filter
    audit/
      AuditRow.tsx         # Audit entry with undo button
      AuditFilters.tsx     # Mailbox, rule, action type, date range filters
  pages/
    RulesPage.tsx          # Replace ComingSoonPage at /rules
    StagingPage.tsx        # Replace ComingSoonPage at /staging
    AuditLogPage.tsx       # Replace ComingSoonPage at /audit
```

### Pattern 1: Rule Engine as Service Layer

**What:** The rule engine is a pure service function called when webhook events arrive, NOT a standalone worker. It intercepts `handleCreated` in the event collector flow and evaluates rules before saving the event.

**When to use:** Every time a new email arrives (changeType: 'created')

**Architecture:**
```typescript
// ruleEngine.ts
export async function evaluateRulesForMessage(
  userId: Types.ObjectId,
  mailboxId: Types.ObjectId,
  message: GraphMessage,
  accessToken: string,
): Promise<{ matched: boolean; ruleId?: string; actions?: IRuleAction[] }> {
  // 1. Check kill switch (User.preferences.automationPaused)
  const user = await User.findById(userId).select('preferences.automationPaused');
  if (user?.preferences.automationPaused) return { matched: false };

  // 2. Check whitelist (Mailbox.settings + org-wide)
  const isWhitelisted = await checkWhitelist(mailboxId, message.from.emailAddress);
  if (isWhitelisted) return { matched: false };

  // 3. Evaluate rules by priority (first-match-wins)
  const rules = await Rule.find({
    userId, mailboxId, isEnabled: true
  }).sort({ priority: 1 });

  for (const rule of rules) {
    if (matchesConditions(rule.conditions, message)) {
      return { matched: true, ruleId: rule._id.toString(), actions: rule.actions };
    }
  }

  return { matched: false };
}
```

**Key design decision:** The rule engine runs inline with webhook event processing (inside BullMQ webhook-events worker), NOT as a separate queue. This ensures <5 minute processing time from email arrival. The staging-processor queue handles only the deferred execution of staged items.

### Pattern 2: Graph API Action Executor

**What:** A service that translates our internal action types to Graph API calls, routing destructive actions through staging.

**Architecture:**
```typescript
// actionExecutor.ts
export async function executeActions(
  mailboxEmail: string,
  messageId: string,
  actions: IRuleAction[],
  ruleId: string,
  accessToken: string,
): Promise<void> {
  const sortedActions = [...actions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  for (const action of sortedActions) {
    switch (action.actionType) {
      case 'delete':
        // Route to staging, NOT direct delete
        await stageForDeletion(mailboxEmail, messageId, ruleId, accessToken);
        break;
      case 'move':
        // POST /users/{email}/messages/{id}/move
        await graphFetch(`/users/${mailboxEmail}/messages/${messageId}/move`, accessToken, {
          method: 'POST',
          body: JSON.stringify({ destinationId: action.toFolder }),
        });
        break;
      case 'markRead':
        // PATCH /users/{email}/messages/{id}
        await graphFetch(`/users/${mailboxEmail}/messages/${messageId}`, accessToken, {
          method: 'PATCH',
          body: JSON.stringify({ isRead: true }),
        });
        break;
      case 'categorize':
        await graphFetch(`/users/${mailboxEmail}/messages/${messageId}`, accessToken, {
          method: 'PATCH',
          body: JSON.stringify({ categories: [action.category] }),
        });
        break;
      case 'archive':
        // Move to Archive folder
        await graphFetch(`/users/${mailboxEmail}/messages/${messageId}/move`, accessToken, {
          method: 'POST',
          body: JSON.stringify({ destinationId: 'archive' }),
        });
        break;
    }
  }
}
```

### Pattern 3: Pattern-to-Rule Conversion

**What:** Translates an approved Pattern into a Rule document and optionally a Graph API messageRule.

**Key mapping:**
```typescript
// Pattern condition -> Rule conditions
// pattern.condition.senderEmail -> rule.conditions.senderEmail
// pattern.condition.senderDomain -> rule.conditions.senderDomain
// pattern.condition.subjectPattern -> rule.conditions.subjectContains

// Pattern suggestedAction -> Rule actions[]
// pattern.suggestedAction.actionType -> rule.actions[0].actionType
// pattern.suggestedAction.toFolder -> rule.actions[0].toFolder
// pattern.suggestedAction.category -> rule.actions[0].category

// Rule -> Graph API messageRule
// rule.conditions.senderEmail -> messageRule.conditions.fromAddresses[{emailAddress:{address:...}}]
// rule.conditions.senderDomain -> messageRule.conditions.senderContains[domain]
// rule.conditions.subjectContains -> messageRule.conditions.subjectContains[...]
// rule.actions[type=move] -> messageRule.actions.moveToFolder = folderId
// rule.actions[type=delete] -> messageRule.actions.moveToFolder = stagingFolderId
// rule.actions[type=markRead] -> messageRule.actions.markAsRead = true
// rule.actions[type=categorize] -> messageRule.actions.assignCategories = [category]
```

### Pattern 4: dnd-kit Sortable List for Rules

**What:** Vertical sortable list for rule priority reordering.

**Architecture:**
```typescript
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function SortableRuleItem({ rule }: { rule: Rule }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: rule._id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <GripVertical {...listeners} /> {/* drag handle */}
      <RuleCard rule={rule} />
    </div>
  );
}

function RuleList({ rules }: { rules: Rule[] }) {
  const ruleIds = rules.map(r => r._id);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (active.id !== over?.id) {
      // Reorder and call PUT /api/rules/reorder
    }
  }

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ruleIds} strategy={verticalListSortingStrategy}>
        {rules.map(rule => <SortableRuleItem key={rule._id} rule={rule} />)}
      </SortableContext>
    </DndContext>
  );
}
```

### Pattern 5: Countdown Timer for Staging Page

**What:** Real-time countdown using `date-fns` (already installed) with `useEffect` interval.

```typescript
function useCountdown(expiresAt: string) {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    const update = () => {
      const ms = new Date(expiresAt).getTime() - Date.now();
      if (ms <= 0) { setRemaining('Expired'); return; }
      const hours = Math.floor(ms / 3600000);
      const minutes = Math.floor((ms % 3600000) / 60000);
      setRemaining(`${hours}h ${minutes}m`);
    };
    update();
    const interval = setInterval(update, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [expiresAt]);

  return remaining;
}
```

### Anti-Patterns to Avoid

- **Direct permanentDelete via Graph API:** NEVER use `POST /users/{email}/messages/{id}/permanentDelete`. All deletes go through staging first, then move to Deleted Items. This is a core safety requirement (SAFE-03).
- **Rule evaluation in a separate queue:** Don't create a new BullMQ queue for rule evaluation. The webhook-events processor already runs per-message; adding rule evaluation there keeps latency low. Only the staging processor needs its own scheduled job.
- **Graph API messageRule as the sole rule engine:** Graph API messageRules only apply to Inbox and don't support staging, whitelist, or audit. Our local rule engine must do the evaluation; Graph messageRules are an optional sync for rules that can be expressed natively.
- **Polling for staging countdown:** Don't poll the backend for countdown updates. Calculate remaining time client-side from `expiresAt` timestamp.
- **Unbounded rule queries:** Always scope rules by `userId + mailboxId` and use the compound index. Never query all rules in the system.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Drag-and-drop list reordering | Custom mouse/touch event handlers | `@dnd-kit/core` + `@dnd-kit/sortable` | Keyboard accessibility, screen reader support, touch device support, animation -- all handled by dnd-kit |
| Countdown timers | Custom date math | `date-fns` `differenceInMinutes`, `differenceInHours` | Already installed, handles edge cases (DST, timezone) |
| Audit log pagination | Custom skip/limit logic | Reuse pagination pattern from patterns routes | Same query params (page, limit), same response shape |

**Key insight:** The hardest part of Phase 6 is NOT any single component -- it's the wiring. The rule engine must integrate with the webhook event processor, the staging manager must coordinate between Graph API folder operations and MongoDB state, and the undo service must reverse actions by reading audit log details. Test the integration points, not just individual services.

## Common Pitfalls

### Pitfall 1: Staging Folder Not Found on New Mailboxes

**What goes wrong:** The rule engine tries to move an email to "MSEDB Staging" folder but the folder doesn't exist yet in the user's mailbox.
**Why it happens:** The staging folder must be created per-mailbox via Graph API before any staging operations.
**How to avoid:** Create the staging folder lazily on first staging operation per mailbox. Cache the folder ID in the Mailbox document or Redis. Check for existing folder by name before creating.
**Warning signs:** GraphApiError 400 or 404 when trying to move to staging folder.

### Pitfall 2: Graph API Rate Limiting on Batch Actions

**What goes wrong:** The staging processor runs every 30 minutes and tries to execute many expired items at once, hitting Graph API throttling (429 responses).
**Why it happens:** Graph API has per-user rate limits. Executing 50+ moves in a burst triggers throttling.
**How to avoid:** Process staged items with a small concurrency limit (e.g., 5 at a time). Check for `Retry-After` header on 429 responses and respect it. Use `Promise.allSettled` to handle partial failures gracefully.
**Warning signs:** 429 responses in logs, staging items stuck in "staged" status.

### Pitfall 3: Race Condition Between Rule Evaluation and Manual User Actions

**What goes wrong:** User manually moves an email while the rule engine is also trying to move it, resulting in the email being in an unexpected folder or a 404 error.
**Why it happens:** Webhook notifications have latency; the rule engine may process a "created" event for an email the user has already acted on.
**How to avoid:** The action executor should handle 404 gracefully (message already moved/deleted). Log the conflict but don't fail the job. Mark the audit entry as "conflict -- user acted first."
**Warning signs:** Frequent 404 errors in action executor logs.

### Pitfall 4: Undo After Message Permanently Deleted

**What goes wrong:** User clicks "undo" on an audit entry, but the email has been permanently deleted from Deleted Items by Exchange retention policy.
**Why it happens:** Exchange can purge Deleted Items after retention period (default 14-30 days). Our 48-hour undo window is within this, but external factors could clear it.
**How to avoid:** The undo service should handle 404 gracefully and inform the user that the message is no longer available. Log the failure but don't crash.
**Warning signs:** Undo operations returning 404 for messages that should exist.

### Pitfall 5: Staging Folder Becomes Invisible Black Hole

**What goes wrong:** Emails enter staging but users forget about them. After 24 hours, destructive actions execute silently.
**Why it happens:** No notification that staging happened; no visible badge; no urgency.
**How to avoid:** Socket.IO push notification on every staging entry. Badge count on the Staging nav item and dashboard. Email digest for staged items (future -- Phase 7). The ROADMAP explicitly calls this out as a critical pitfall.
**Warning signs:** High staging execution rate with zero rescues.

### Pitfall 6: StagedEmail TTL Index Deletes Documents Before Execution

**What goes wrong:** The existing TTL index on StagedEmail (`expireAfterSeconds: 0` on `expiresAt`) causes MongoDB to delete staged documents at their expiry time, before the staging processor can execute them.
**Why it happens:** The `expiresAt` field is currently set to the grace period end. The TTL index triggers at that exact time, but the staging processor runs every 30 minutes -- documents may be deleted before the processor picks them up.
**How to avoid:** Either (a) remove the TTL index and manage cleanup manually in the staging processor, or (b) set `expiresAt` on the TTL index to a much later time (e.g., `expiresAt + 7 days` for cleanup of already-executed/rescued documents). Recommended approach: use `expiresAt` as the grace period deadline for the processor to check, and add a separate `cleanupAt` field for TTL deletion (or just let the processor clean up old documents).
**Warning signs:** StagedEmail documents disappearing from MongoDB before the staging processor runs.

## Code Examples

### Graph API: Create Mail Folder ("MSEDB Staging")

```typescript
// Source: https://learn.microsoft.com/en-us/graph/api/user-post-mailfolders
async function ensureStagingFolder(
  mailboxEmail: string,
  accessToken: string,
): Promise<string> {
  // Check if folder already exists
  const listResponse = await graphFetch(
    `/users/${mailboxEmail}/mailFolders?$filter=displayName eq 'MSEDB Staging'&$select=id,displayName`,
    accessToken,
  );
  const { value } = await listResponse.json() as { value: Array<{ id: string }> };

  if (value.length > 0) {
    return value[0].id; // Already exists
  }

  // Create the folder
  const createResponse = await graphFetch(
    `/users/${mailboxEmail}/mailFolders`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ displayName: 'MSEDB Staging' }),
    },
  );
  const folder = await createResponse.json() as { id: string };
  return folder.id;
}
```

### Graph API: Move Message

```typescript
// Source: https://learn.microsoft.com/en-us/graph/api/message-move
async function moveMessage(
  mailboxEmail: string,
  messageId: string,
  destinationFolderId: string,
  accessToken: string,
): Promise<void> {
  await graphFetch(
    `/users/${mailboxEmail}/messages/${messageId}/move`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ destinationId: destinationFolderId }),
    },
  );
}
```

### Graph API: Update Message (Mark Read, Categorize)

```typescript
// Source: https://learn.microsoft.com/en-us/graph/api/message-update
async function updateMessage(
  mailboxEmail: string,
  messageId: string,
  updates: { isRead?: boolean; categories?: string[] },
  accessToken: string,
): Promise<void> {
  await graphFetch(
    `/users/${mailboxEmail}/messages/${messageId}`,
    accessToken,
    {
      method: 'PATCH',
      body: JSON.stringify(updates),
    },
  );
}
```

### Graph API: Create messageRule (Pattern-to-Rule Sync)

```typescript
// Source: https://learn.microsoft.com/en-us/graph/api/mailfolder-post-messagerules
async function createGraphMessageRule(
  mailboxEmail: string,
  rule: IRule,
  stagingFolderId: string,
  accessToken: string,
): Promise<string> {
  const graphRule: Record<string, unknown> = {
    displayName: rule.name,
    sequence: rule.priority,
    isEnabled: rule.isEnabled,
    conditions: {},
    actions: { stopProcessingRules: true }, // first-match-wins
  };

  // Map conditions
  if (rule.conditions.senderEmail) {
    (graphRule.conditions as Record<string, unknown>).fromAddresses = [
      { emailAddress: { address: rule.conditions.senderEmail } },
    ];
  }
  if (rule.conditions.senderDomain) {
    (graphRule.conditions as Record<string, unknown>).senderContains = [
      rule.conditions.senderDomain,
    ];
  }
  if (rule.conditions.subjectContains) {
    (graphRule.conditions as Record<string, unknown>).subjectContains = [
      rule.conditions.subjectContains,
    ];
  }

  // Map actions -- route deletes to staging folder
  const actions = graphRule.actions as Record<string, unknown>;
  for (const action of rule.actions) {
    switch (action.actionType) {
      case 'delete':
        actions.moveToFolder = stagingFolderId; // Route to staging, not delete
        break;
      case 'move':
        actions.moveToFolder = action.toFolder;
        break;
      case 'markRead':
        actions.markAsRead = true;
        break;
      case 'categorize':
        actions.assignCategories = [action.category];
        break;
    }
  }

  const response = await graphFetch(
    `/users/${mailboxEmail}/mailFolders/inbox/messageRules`,
    accessToken,
    { method: 'POST', body: JSON.stringify(graphRule) },
  );
  const created = await response.json() as { id: string };
  return created.id;
}
```

### BullMQ Staging Processor

```typescript
// Source: Existing processorMap pattern in queues.ts
export async function processStagingItems(job: Job): Promise<void> {
  // Find all staged items where expiresAt <= now and status = 'staged'
  const expiredItems = await StagedEmail.find({
    status: 'staged',
    expiresAt: { $lte: new Date() },
  }).limit(100); // Process in batches

  for (const item of expiredItems) {
    try {
      const accessToken = await getAccessTokenForMailbox(item.mailboxId.toString());
      const mailbox = await Mailbox.findById(item.mailboxId).select('email');

      // Execute the staged actions
      await executeActions(mailbox!.email, item.messageId, item.actions, item.ruleId.toString(), accessToken);

      item.status = 'executed';
      item.executedAt = new Date();
      await item.save();

      // Audit log
      await AuditLog.create({
        userId: item.userId,
        mailboxId: item.mailboxId,
        action: 'email_executed',
        targetType: 'email',
        targetId: item.messageId,
        details: { ruleId: item.ruleId, actions: item.actions },
        undoable: true,
      });
    } catch (err) {
      logger.error('Failed to execute staged item', { stagedEmailId: item._id, error: err });
    }
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `react-beautiful-dnd` | `@hello-pangea/dnd` or `@dnd-kit/core` | 2022-2023 | react-beautiful-dnd is unmaintained. hello-pangea/dnd is the maintained fork but lacks React 19 support. `@dnd-kit/core` v6 is the current standard for React 19 projects. |
| Graph SDK (`@microsoft/microsoft-graph-client`) | Native `fetch` with thin wrapper (`graphFetch`) | Project decision (Phase 3) | This project uses native fetch via `graphFetch()` in `graphClient.ts`. All Phase 6 Graph API calls MUST use this same pattern -- do NOT introduce the Graph SDK. |
| Separate rule evaluation service | Inline rule evaluation in webhook processor | Architecture decision | Rules evaluate during webhook event processing, not as a separate async job. Only staging execution is deferred. |

**Deprecated/outdated:**
- `react-beautiful-dnd`: Deprecated by Atlassian, no React 18+ support. Do not use.
- Graph API `permanentDelete`: Exists in the API but MUST NOT be used in this project (SAFE-03 requirement: soft-delete only).

## Open Questions

1. **Graph API messageRule sync -- required or optional?**
   - What we know: The PRD references Graph API messageRuleActions (AUTO-01). Our local rule engine handles evaluation internally. Graph messageRules would provide server-side rule execution by Exchange.
   - What's unclear: Whether to create Graph messageRules as a sync mechanism (so rules also work when our backend is down) or rely solely on our local engine.
   - Recommendation: Make Graph messageRule creation optional/deferred. The local engine is required for staging, whitelist, and audit. Graph sync can be added later as an enhancement. For v1, pattern approval creates a Rule document in our DB only. The `graphRuleId` field already exists on the model for future use.

2. **Org-wide whitelist storage**
   - What we know: Mailbox.settings has per-mailbox whitelists. SAFE-04 also requires "org-wide" admin-managed whitelists.
   - What's unclear: Where to store org-wide whitelist. The `org_settings` collection is referenced in the PRD but no OrgSettings model exists yet.
   - Recommendation: Create a simple `Whitelist` model (or embed in a new `OrgSettings` model) for org-wide entries. The rule engine checks both per-mailbox (Mailbox.settings) and org-wide whitelists. Alternatively, a simple JSON array in Redis could suffice for v1.

3. **Model changes needed for StagedEmail TTL**
   - What we know: The existing StagedEmail schema has a TTL index on `expiresAt` with `expireAfterSeconds: 0`. This means MongoDB auto-deletes documents when `expiresAt` passes.
   - What's unclear: The staging processor needs documents to still exist after `expiresAt` so it can execute them.
   - Recommendation: Remove the TTL index on `expiresAt` and add a TTL index on a new `cleanupAt` field set to `expiresAt + 7 days`. This gives the processor time to execute and keeps old documents for audit purposes before cleanup.

## Sources

### Primary (HIGH confidence)
- Microsoft Graph API messageRule resource type: https://learn.microsoft.com/en-us/graph/api/resources/messagerule?view=graph-rest-1.0
- Microsoft Graph API messageRuleActions: https://learn.microsoft.com/en-us/graph/api/resources/messageruleactions?view=graph-rest-1.0
- Microsoft Graph API messageRulePredicates: https://learn.microsoft.com/en-us/graph/api/resources/messagerulepredicates?view=graph-rest-1.0
- Microsoft Graph API create messageRule: https://learn.microsoft.com/en-us/graph/api/mailfolder-post-messagerules?view=graph-rest-1.0
- Microsoft Graph API move message: https://learn.microsoft.com/en-us/graph/api/message-move?view=graph-rest-1.0
- Microsoft Graph API update message: https://learn.microsoft.com/en-us/graph/api/message-update?view=graph-rest-1.0
- Microsoft Graph API create mail folder: https://learn.microsoft.com/en-us/graph/api/user-post-mailfolders?view=graph-rest-1.0
- Existing codebase analysis (all models, services, routes, frontend components read directly)

### Secondary (MEDIUM confidence)
- `@dnd-kit/core` peer dependency (`>=16.8.0`) verified via GitHub package.json: https://github.com/clauderic/dnd-kit
- `@hello-pangea/dnd` React 19 incompatibility confirmed via GitHub issue: https://github.com/hello-pangea/dnd/issues/863
- dnd-kit sortable documentation: https://docs.dndkit.com/presets/sortable

### Tertiary (LOW confidence)
- None -- all critical claims verified with primary or secondary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in use except dnd-kit; dnd-kit peer deps verified via GitHub
- Architecture: HIGH - All patterns derive from existing codebase patterns (processorMap, graphFetch, Socket.IO rooms, TanStack Query hooks)
- Graph API integration: HIGH - All endpoints verified against official Microsoft documentation
- Pitfalls: HIGH - Based on analysis of existing model schemas (TTL index issue) and Graph API behavior (rate limiting, 404 handling)
- dnd-kit React 19 compatibility: MEDIUM - Peer dep says `>=16.8.0` but no explicit React 19 testing documented

**Research date:** 2026-02-17
**Valid until:** 2026-03-17 (stable domain -- Graph API v1.0 and dnd-kit v6 are mature)
