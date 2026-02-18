# Phase 5: Pattern Intelligence - Research

**Researched:** 2026-02-17
**Domain:** Email behavior pattern detection, confidence scoring, approval workflow UI
**Confidence:** HIGH

## Summary

Phase 5 transforms accumulated EmailEvent data into actionable pattern suggestions. The core challenge is a pure data engineering and algorithm design problem -- no external pattern detection libraries are needed. The system aggregates EmailEvent documents by sender (email and domain), computes action distributions (deleted/moved/archived/etc.), applies confidence scoring with asymmetric risk thresholds, and surfaces qualifying patterns as user-reviewable suggestion cards.

The existing codebase provides strong foundations: the Pattern model (Mongoose schema with status, confidence, sampleSize, exceptionCount, evidence, rejectionCooldownUntil fields), the pattern-analysis BullMQ queue (with scheduler running daily at 2 AM), the ProcessorMap pattern for wiring real processors, and the PendingSuggestionsSection stub on the dashboard. The work decomposes naturally into three concerns: (1) backend pattern detection engine + confidence scorer, (2) BullMQ processor + REST API endpoints, and (3) Patterns page UI with approve/reject/customize cards.

**Primary recommendation:** Build the pattern detection engine as a pure service module (`backend/src/services/patternEngine.ts`) that uses MongoDB aggregation pipelines on the EmailEvent collection, produces Pattern documents, and is called by both the BullMQ processor and an on-demand API. No external ML/stats libraries needed -- this is aggregation + arithmetic.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PATN-01 | Sender-level pattern detection -- detect consistent actions per sender | MongoDB aggregation pipeline grouping EmailEvents by `sender.email` and `sender.domain`, computing action distribution counts. Existing indexes on `{userId, sender.domain, timestamp}` and `{userId, eventType, timestamp}` support this. Need additional index on `{userId, mailboxId, sender.email, eventType}` for sender-email-level queries. |
| PATN-02 | Folder routing pattern detection -- detect consistent moves to specific folders | Same aggregation approach filtered to `eventType: 'moved'`, grouped by `sender.email` + `toFolder`. The existing `toFolder` field on EmailEvent captures destination. Folder name resolution via folderCache service (already built). |
| PATN-03 | Confidence scoring with asymmetric thresholds (98% delete, 85% move), 14-day minimum observation, sample size bonuses, recency penalties | Pure arithmetic function: `confidence = baseRate * sampleSizeMultiplier * recencyFactor`. No external libraries. The asymmetric thresholds are applied at the suggestion-gating step, not in the score itself. Pattern model's `confidence` field (0-100 number) stores the result. |
| PATN-04 | Pattern suggestion UI with approve/reject/customize workflow, evidence display | REST endpoints: `GET /api/patterns` (list), `POST /api/patterns/:id/approve`, `POST /api/patterns/:id/reject`, `POST /api/patterns/:id/customize`. Pattern model already has `status` field with enum `['detected', 'suggested', 'approved', 'rejected', 'expired']`, plus `rejectedAt` and `rejectionCooldownUntil` for 30-day cooldown. Evidence field capped at 10 items. |
| PAGE-02 | Patterns page with card-based layout, confidence visualization, sample evidence, approve/reject/customize actions | New `PatternsPage.tsx` replacing ComingSoonPage at `/patterns` route. Uses shadcn Card, Badge, Button. Confidence bar via CSS/Tailwind (no progress component needed). Filter by status and pattern type. TanStack Query for data fetching, optimistic updates for approve/reject. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| mongoose | ^8.23.0 | Aggregation pipelines for pattern detection | Already in project. Aggregation framework is the right tool for grouping events by sender and computing action distributions. |
| bullmq | ^5.69.3 | Scheduled pattern analysis job | Already in project. pattern-analysis queue already exists with 2 AM cron schedule. |
| express | ^5.0.1 | Pattern REST API endpoints | Already in project. Follows existing route pattern. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| date-fns | ^4.1.0 | Date arithmetic for 14-day observation window, 30-day cooldown | Already in frontend. Use `subDays`, `isAfter`, `addDays` for date comparisons in backend (install for backend if not present, or use native Date arithmetic). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom aggregation | External ML library (e.g., brain.js) | Overkill -- pattern detection here is counting and ratios, not classification. Custom aggregation is simpler, faster, and has zero dependencies. |
| MongoDB aggregation | Application-level grouping | MongoDB aggregation is dramatically more efficient -- it processes data server-side without transferring raw events to the app. Critical for performance with 10k+ events. |
| CSS width-based confidence bar | shadcn Progress component | Either works. CSS `width: ${confidence}%` on a div is simpler and avoids adding a shadcn component. But shadcn Progress is a one-command install if consistency is preferred. |

### Installation

No new npm packages are required. All libraries are already installed. If the planner decides to use shadcn Progress and Dialog components:
```bash
cd frontend && npx shadcn@latest add progress dialog alert-dialog
```

## Architecture Patterns

### Recommended Project Structure
```
backend/src/
├── services/
│   └── patternEngine.ts       # Core detection + scoring logic
├── jobs/processors/
│   └── patternAnalysis.ts     # BullMQ processor (calls patternEngine)
├── routes/
│   └── patterns.ts            # REST API for patterns CRUD + approve/reject/customize
├── models/
│   └── Pattern.ts             # Already exists -- no changes needed

frontend/src/
├── pages/
│   └── PatternsPage.tsx       # Full patterns page (replaces ComingSoonPage)
├── components/
│   └── patterns/
│       ├── PatternCard.tsx     # Individual pattern suggestion card
│       ├── PatternFilters.tsx  # Status/type filter controls
│       └── PatternCustomizeDialog.tsx  # Customize modal
├── api/
│   └── patterns.ts            # API functions for patterns endpoints
├── hooks/
│   └── usePatterns.ts         # TanStack Query hooks for patterns
```

### Pattern 1: MongoDB Aggregation Pipeline for Sender-Level Patterns
**What:** Group EmailEvents by userId + mailboxId + sender.email, compute action distribution, and identify dominant actions.
**When to use:** In the pattern detection engine to find sender-level behavioral patterns.
**Example:**
```typescript
// Sender-level action distribution aggregation
const pipeline = [
  {
    $match: {
      userId: new Types.ObjectId(userId),
      mailboxId: new Types.ObjectId(mailboxId),
      timestamp: { $gte: fourteenDaysAgo },
      'sender.email': { $exists: true, $ne: null },
    },
  },
  {
    $group: {
      _id: {
        senderEmail: '$sender.email',
        senderDomain: '$sender.domain',
        senderName: '$sender.name',
      },
      totalEvents: { $sum: 1 },
      deletedCount: {
        $sum: { $cond: [{ $eq: ['$eventType', 'deleted'] }, 1, 0] },
      },
      movedCount: {
        $sum: { $cond: [{ $eq: ['$eventType', 'moved'] }, 1, 0] },
      },
      arrivedCount: {
        $sum: { $cond: [{ $eq: ['$eventType', 'arrived'] }, 1, 0] },
      },
      firstSeen: { $min: '$timestamp' },
      lastSeen: { $max: '$timestamp' },
      // Collect recent evidence (messageIds + timestamps)
      recentEvents: {
        $topN: {
          n: 10,
          sortBy: { timestamp: -1 },
          output: {
            messageId: '$messageId',
            timestamp: '$timestamp',
            action: '$eventType',
          },
        },
      },
    },
  },
  {
    $match: {
      totalEvents: { $gte: 10 }, // Minimum sample size
    },
  },
];
```

### Pattern 2: Folder Routing Pattern Detection
**What:** Filter to 'moved' events, group by sender + toFolder, identify consistent routing.
**When to use:** Detecting that a user always moves emails from sender X to folder Y.
**Example:**
```typescript
// Folder routing aggregation
const folderPipeline = [
  {
    $match: {
      userId: new Types.ObjectId(userId),
      mailboxId: new Types.ObjectId(mailboxId),
      eventType: 'moved',
      timestamp: { $gte: fourteenDaysAgo },
      toFolder: { $exists: true, $ne: null },
    },
  },
  {
    $group: {
      _id: {
        senderEmail: '$sender.email',
        senderDomain: '$sender.domain',
        toFolder: '$toFolder',
      },
      moveCount: { $sum: 1 },
      firstSeen: { $min: '$timestamp' },
      lastSeen: { $max: '$timestamp' },
      recentEvents: {
        $topN: {
          n: 10,
          sortBy: { timestamp: -1 },
          output: {
            messageId: '$messageId',
            timestamp: '$timestamp',
            action: '$eventType',
          },
        },
      },
    },
  },
  {
    $match: {
      moveCount: { $gte: 5 }, // Lower threshold for move patterns
    },
  },
];
```

### Pattern 3: Confidence Scoring Algorithm
**What:** Calculate confidence as a composite score incorporating consistency rate, sample size, and recency.
**When to use:** After aggregation, before deciding whether to surface a pattern as a suggestion.
**Example:**
```typescript
interface ConfidenceInput {
  actionCount: number;    // Times user performed this action
  totalEvents: number;    // Total events from this sender
  firstSeen: Date;        // Earliest event
  lastSeen: Date;         // Most recent event
  recentActionCount: number;  // Actions in last 7 days (for recency check)
  recentTotalEvents: number;  // Total events in last 7 days
}

function calculateConfidence(input: ConfidenceInput): number {
  const {
    actionCount, totalEvents,
    recentActionCount, recentTotalEvents,
  } = input;

  // Base consistency rate (0-100)
  const baseRate = (actionCount / totalEvents) * 100;

  // Sample size bonus: logarithmic scale
  // 10 events = 1.0x, 50 events = ~1.05x, 100+ events = ~1.1x
  const sampleMultiplier = Math.min(
    1.0 + Math.log10(totalEvents / 10) * 0.05,
    1.1,
  );

  // Recency penalty: if recent behavior diverges from overall pattern
  let recencyFactor = 1.0;
  if (recentTotalEvents >= 3) {
    const recentRate = recentActionCount / recentTotalEvents;
    const overallRate = actionCount / totalEvents;
    const divergence = Math.abs(recentRate - overallRate);
    // Penalize up to 15% for significant recent divergence
    recencyFactor = Math.max(0.85, 1.0 - divergence * 0.5);
  }

  return Math.min(100, Math.round(baseRate * sampleMultiplier * recencyFactor));
}
```

### Pattern 4: ProcessorMap Integration
**What:** Wire the real pattern analysis processor into the existing BullMQ infrastructure.
**When to use:** Replace the placeholder `createProcessor('pattern-analysis')` in queues.ts.
**Example:**
```typescript
// In queues.ts, replace placeholder:
import { processPatternAnalysis } from './processors/patternAnalysis.js';

const processorMap: Record<QueueName, (job: Job) => Promise<void>> = {
  // ... existing processors
  'pattern-analysis': processPatternAnalysis,
  // ...
};
```

### Pattern 5: Pattern Update Strategy (Upsert)
**What:** When re-analyzing patterns, update existing Pattern documents rather than creating duplicates.
**When to use:** Every time the pattern analysis job runs. Uses a compound key of userId + mailboxId + patternType + condition fields.
**Example:**
```typescript
// Upsert pattern: find existing or create new
const existingPattern = await Pattern.findOne({
  userId,
  mailboxId,
  patternType: 'sender',
  'condition.senderEmail': senderEmail,
  'suggestedAction.actionType': dominantAction,
  status: { $nin: ['approved', 'rejected'] },
});

if (existingPattern) {
  // Update confidence and evidence
  existingPattern.confidence = newConfidence;
  existingPattern.sampleSize = totalEvents;
  existingPattern.exceptionCount = totalEvents - actionCount;
  existingPattern.evidence = recentEvidence;
  existingPattern.lastAnalyzedAt = new Date();
  await existingPattern.save();
} else {
  // Check if rejected within cooldown
  const rejectedPattern = await Pattern.findOne({
    userId,
    mailboxId,
    patternType: 'sender',
    'condition.senderEmail': senderEmail,
    status: 'rejected',
    rejectionCooldownUntil: { $gt: new Date() },
  });
  if (rejectedPattern) return; // Still in cooldown

  // Create new pattern
  await Pattern.create({ ... });
}
```

### Pattern 6: Approve/Reject/Customize API Pattern
**What:** REST endpoints following existing codebase conventions (requireAuth, userId scoping, route-level middleware).
**When to use:** Pattern management API.
**Example:**
```typescript
// POST /api/patterns/:id/approve
patternsRouter.post('/:id/approve', async (req, res) => {
  const userId = req.user!.userId;
  const pattern = await Pattern.findOne({ _id: req.params.id, userId });
  if (!pattern) throw new NotFoundError('Pattern not found');
  if (pattern.status === 'approved') throw new ConflictError('Already approved');

  pattern.status = 'approved';
  pattern.approvedAt = new Date();
  await pattern.save();

  // Create audit log entry
  await AuditLog.create({
    userId,
    mailboxId: pattern.mailboxId,
    action: 'pattern_approved',
    targetType: 'pattern',
    targetId: pattern._id.toString(),
    details: { patternType: pattern.patternType, confidence: pattern.confidence },
  });

  res.json(pattern);
});
```

### Anti-Patterns to Avoid
- **Loading all EmailEvents into memory:** Use MongoDB aggregation pipelines exclusively. With 90-day TTL and multiple mailboxes, the events collection could have millions of documents. Never `.find().lean()` all events.
- **Running pattern analysis synchronously in API requests:** Always run via BullMQ. The API can trigger an ad-hoc analysis job but must not block.
- **Creating duplicate patterns:** Always check for existing patterns with the same condition before creating new ones. Use the upsert strategy above.
- **Hard-coding folder IDs in patterns:** Store human-readable folder names (from folderCache) in pattern conditions, not opaque Graph API folder IDs.
- **Suggesting patterns on automated events:** If an event was triggered by an MSEDB rule (`metadata.automatedByRule` is set), exclude it from pattern analysis to avoid feedback loops.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Data aggregation | In-memory grouping/counting | MongoDB aggregation pipeline | Server-side processing, handles millions of documents, leverages indexes |
| Date arithmetic | Manual millisecond math | `Date` API / `date-fns` | Edge cases with DST, month boundaries are handled correctly |
| Job scheduling | Custom setInterval/cron | BullMQ upsertJobScheduler | Already set up, handles failures, retries, deduplication |
| Optimistic UI updates | Manual cache manipulation | TanStack Query mutation with `onMutate` | Built-in rollback on error, cache invalidation |

**Key insight:** The pattern detection engine is fundamentally an aggregation + arithmetic problem. MongoDB handles the heavy lifting (grouping, counting, sorting). The application layer only needs to interpret results and apply business rules (thresholds, cooldowns, recency checks).

## Common Pitfalls

### Pitfall 1: Pattern False Positives Destroying User Trust
**What goes wrong:** Suggesting "delete all emails from important-client@company.com" because the user deleted 3 out of 3 emails during a cleanup session.
**Why it happens:** Small sample sizes produce misleadingly high confidence. A 100% rate on 3 events is far less reliable than 97% on 100 events.
**How to avoid:** Enforce minimum 10 events AND minimum 14-day observation window. Apply sample size bonus only above 10 events. The asymmetric threshold (98% for delete vs 85% for move) adds a second safety layer for destructive actions.
**Warning signs:** Users rejecting a high percentage of suggestions. Track rejection rate as a health metric.

### Pitfall 2: Feedback Loops from Automated Events
**What goes wrong:** The system creates a rule that auto-deletes emails from sender X. Future emails from X get auto-deleted, producing more "deleted" events that reinforce the pattern with artificially inflated confidence.
**Why it happens:** Pattern analysis doesn't distinguish user actions from automated actions.
**How to avoid:** Filter out events where `metadata.automatedByRule` is set. Only analyze events from genuine user behavior.
**Warning signs:** Confidence scores only ever increase, never decrease.

### Pitfall 3: Stale Patterns After Behavior Changes
**What goes wrong:** User used to delete newsletters from sender X, but now reads them. The old pattern persists with high confidence because historical data dominates.
**Why it happens:** No recency weighting -- all events within the 90-day TTL window count equally.
**How to avoid:** Apply the recency penalty in confidence scoring. If the last 7 days of behavior diverges significantly from the overall pattern, reduce confidence. Consider a sliding window (e.g., weight recent 14 days more heavily than older data).
**Warning signs:** Users rejecting patterns they previously would have approved.

### Pitfall 4: Pattern Analysis Job Timeout on Large Mailboxes
**What goes wrong:** A user with thousands of events from hundreds of senders causes the pattern analysis job to run for minutes, potentially blocking the worker.
**Why it happens:** O(n) aggregation queries per user, and each sender may produce a pattern to evaluate.
**How to avoid:** Process users in batches. Set a reasonable job timeout. Use MongoDB's aggregation pipeline `$limit` to cap results. The BullMQ worker should have a generous timeout (e.g., 5 minutes per user) but not block indefinitely.
**Warning signs:** BullMQ job duration metrics showing increasing times.

### Pitfall 5: Race Conditions on Pattern Status
**What goes wrong:** User approves a pattern while the background job is simultaneously updating its confidence score, reverting the status back to 'detected'.
**Why it happens:** Upsert logic doesn't check for status transitions that should be preserved.
**How to avoid:** The upsert strategy must only update patterns in 'detected' or 'suggested' status. Never overwrite 'approved', 'rejected', or 'expired' patterns. Use `status: { $nin: ['approved', 'rejected'] }` in the query filter.
**Warning signs:** Users report approved patterns reverting to suggestions.

### Pitfall 6: 30-Day Cooldown Bypass
**What goes wrong:** A rejected pattern gets re-suggested immediately because the cooldown check fails.
**Why it happens:** Comparing `rejectionCooldownUntil` as a string instead of Date, or timezone mismatch.
**How to avoid:** Store `rejectionCooldownUntil` as a proper Date in MongoDB (already the case in the Pattern schema). Use `{ $gt: new Date() }` for comparison. Test with patterns rejected at various times.
**Warning signs:** Users complaining about seeing the same suggestion they already rejected.

## Code Examples

### MongoDB Aggregation for Sender-Level Patterns

```typescript
// Source: Verified against Mongoose 8.x aggregation API
// Produces sender-level action distribution for a single user+mailbox

async function detectSenderPatterns(
  userId: string,
  mailboxId: string,
  observationWindowDays: number = 90,
): Promise<SenderPatternResult[]> {
  const since = new Date();
  since.setDate(since.getDate() - observationWindowDays);

  const results = await EmailEvent.aggregate([
    {
      $match: {
        userId: new Types.ObjectId(userId),
        mailboxId: new Types.ObjectId(mailboxId),
        timestamp: { $gte: since },
        'sender.email': { $exists: true, $ne: null },
        // Exclude automated events to prevent feedback loops
        'metadata.automatedByRule': { $exists: false },
      },
    },
    {
      $group: {
        _id: {
          senderEmail: '$sender.email',
          senderDomain: '$sender.domain',
        },
        senderName: { $first: '$sender.name' },
        totalEvents: { $sum: 1 },
        deletedCount: {
          $sum: { $cond: [{ $eq: ['$eventType', 'deleted'] }, 1, 0] },
        },
        movedCount: {
          $sum: { $cond: [{ $eq: ['$eventType', 'moved'] }, 1, 0] },
        },
        readCount: {
          $sum: { $cond: [{ $eq: ['$eventType', 'read'] }, 1, 0] },
        },
        arrivedCount: {
          $sum: { $cond: [{ $eq: ['$eventType', 'arrived'] }, 1, 0] },
        },
        firstSeen: { $min: '$timestamp' },
        lastSeen: { $max: '$timestamp' },
      },
    },
    {
      $match: {
        totalEvents: { $gte: 10 }, // Minimum sample size
      },
    },
    { $sort: { totalEvents: -1 } },
  ]);

  return results;
}
```

### Confidence Thresholds and Gating

```typescript
// Asymmetric threshold gating
interface ThresholdConfig {
  delete: number;  // 98
  move: number;    // 85
  archive: number; // 85
  markRead: number; // 80
}

const SUGGESTION_THRESHOLDS: ThresholdConfig = {
  delete: 98,
  move: 85,
  archive: 85,
  markRead: 80,
};

const MIN_OBSERVATION_DAYS = 14;

function shouldSuggestPattern(
  confidence: number,
  actionType: string,
  firstSeen: Date,
): boolean {
  // Check minimum observation period
  const daysSinceFirstSeen = Math.floor(
    (Date.now() - firstSeen.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (daysSinceFirstSeen < MIN_OBSERVATION_DAYS) return false;

  // Check threshold for action type
  const threshold = SUGGESTION_THRESHOLDS[actionType as keyof ThresholdConfig];
  if (threshold === undefined) return false;

  return confidence >= threshold;
}
```

### Pattern Analysis BullMQ Processor

```typescript
// Source: Follows existing processor patterns from deltaSync.ts and webhookEvents.ts
import type { Job } from 'bullmq';
import { Mailbox } from '../../models/Mailbox.js';
import { analyzeMailboxPatterns } from '../../services/patternEngine.js';
import logger from '../../config/logger.js';

export async function processPatternAnalysis(job: Job): Promise<void> {
  logger.info('Pattern analysis job started', { jobId: job.id, jobName: job.name });

  // Get all connected mailboxes
  const mailboxes = await Mailbox.find({ isConnected: true });

  let analyzed = 0;
  let failed = 0;

  for (const mailbox of mailboxes) {
    try {
      await analyzeMailboxPatterns(
        mailbox.userId.toString(),
        mailbox._id.toString(),
      );
      analyzed++;
    } catch (err) {
      logger.error('Pattern analysis failed for mailbox', {
        mailboxId: mailbox._id.toString(),
        error: err instanceof Error ? err.message : String(err),
      });
      failed++;
    }
  }

  logger.info('Pattern analysis completed', {
    jobId: job.id,
    analyzed,
    failed,
    total: mailboxes.length,
  });
}
```

### TanStack Query Pattern for Frontend

```typescript
// Source: Follows existing useDashboard.ts hook pattern
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export function usePatterns(mailboxId?: string | null, status?: string) {
  return useQuery({
    queryKey: ['patterns', mailboxId ?? null, status ?? null],
    queryFn: () => {
      const params = new URLSearchParams();
      if (mailboxId) params.set('mailboxId', mailboxId);
      if (status) params.set('status', status);
      const qs = params.toString();
      return apiFetch(`/patterns${qs ? `?${qs}` : ''}`);
    },
  });
}

export function useApprovePattern() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patternId: string) =>
      apiFetch(`/patterns/${patternId}/approve`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patterns'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'stats'] });
    },
  });
}
```

### Pattern Card Component

```typescript
// Source: Follows existing Card/Badge patterns from StatsCards.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Check, X, Settings2 } from 'lucide-react';

interface PatternCardProps {
  pattern: {
    _id: string;
    patternType: 'sender' | 'folder-routing';
    confidence: number;
    sampleSize: number;
    exceptionCount: number;
    condition: { senderEmail?: string; senderDomain?: string };
    suggestedAction: { actionType: string; toFolder?: string };
    evidence: Array<{ messageId: string; timestamp: string; action: string }>;
  };
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onCustomize: (id: string) => void;
}

// Confidence bar color based on value
function confidenceColor(confidence: number): string {
  if (confidence >= 95) return 'bg-green-500';
  if (confidence >= 85) return 'bg-yellow-500';
  return 'bg-orange-500';
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Mongoose `repeat` option for BullMQ | `upsertJobScheduler` | BullMQ 5.x | Already using current approach in schedulers.ts |
| `$push` + `$slice` for capped arrays | `$topN` accumulator in aggregation | MongoDB 5.2+ / Mongoose 7+ | More efficient evidence collection in aggregation pipeline |
| Application-level data grouping | MongoDB aggregation pipeline | Always been available | Server-side is correct for this scale |

**Deprecated/outdated:**
- BullMQ `repeat` job option: replaced by `upsertJobScheduler` (already handled in project)
- `$group` + separate `$sort` + `$limit` for top-N: `$topN` accumulator does this in one stage (MongoDB 5.2+, available in MongoDB 7 which this project uses)

## Open Questions

1. **Pattern detection for domain-level vs email-level**
   - What we know: EmailEvent stores both `sender.email` and `sender.domain`. The Pattern model has both `condition.senderEmail` and `condition.senderDomain`.
   - What's unclear: Should we detect patterns at both levels independently? If a user deletes all emails from `notifications@linkedin.com`, should we also detect a domain-level pattern for `linkedin.com`?
   - Recommendation: Detect at email level first. If multiple senders from the same domain show the same pattern, the planner can consider domain-level rollup as an enhancement. Email-level is safer and more specific.

2. **What counts as the "total" for sender patterns**
   - What we know: We have event types: arrived, deleted, moved, read, flagged, categorized.
   - What's unclear: Is `totalEvents` every event for that sender, or only "meaningful" events (arrived + deleted + moved)? Should `read` events count toward the denominator?
   - Recommendation: Use `arrived` count as the denominator (total emails received from sender). Use `deleted`, `moved`, etc. as numerators. This gives the clearest ratio: "out of N emails from this sender, you deleted M."

3. **Dashboard pending suggestions integration**
   - What we know: PendingSuggestionsSection stub exists on DashboardPage with `suggestions?: unknown[]` prop.
   - What's unclear: Should dashboard show full pattern cards or just a count + link to Patterns page?
   - Recommendation: Show condensed summary cards (top 3-5 pending suggestions) with an "View All" link to the Patterns page. Full card UI lives on PatternsPage.

4. **Socket.IO real-time pattern notifications**
   - What we know: The system emits `email:event` via Socket.IO. Notification model has `pattern_detected` type.
   - What's unclear: Should the pattern analysis job emit Socket.IO events when new patterns are detected?
   - Recommendation: Yes -- emit `pattern:detected` event when new suggestions are created, so the dashboard can update in real-time. Create a Notification document as well. But this is a nice-to-have for this phase and can be deferred to Phase 7 (Notifications).

## Sources

### Primary (HIGH confidence)
- **Existing codebase analysis** - Direct inspection of Pattern model schema, EmailEvent model + indexes, BullMQ queue setup, frontend component patterns, API route conventions
- **MongoDB 7 aggregation docs** - `$group`, `$match`, `$topN` accumulator operators verified as available in MongoDB 7
- **Mongoose 8.x** - Aggregation pipeline API verified via existing usage in `backend/src/routes/events.ts` and `backend/src/routes/dashboard.ts`

### Secondary (MEDIUM confidence)
- **BullMQ 5.x** - ProcessorMap pattern and upsertJobScheduler verified via existing `queues.ts` and `schedulers.ts`
- **TanStack Query 5.x** - `useMutation` with `onSuccess` invalidation pattern verified via existing `useDashboard.ts` hooks
- **shadcn/ui** - Card, Badge, Button components verified as already installed in the project

### Tertiary (LOW confidence)
- None -- all findings are based on direct codebase inspection and established patterns already in use.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new libraries needed; all tools are already in the project
- Architecture: HIGH - Follows established patterns (MongoDB aggregation, BullMQ processor, Express routes, TanStack Query hooks) already proven in phases 1-4
- Pitfalls: HIGH - Derived from the specific requirements (asymmetric thresholds, cooldowns, feedback loops) and common data analysis gotchas

**Research date:** 2026-02-17
**Valid until:** 2026-03-17 (stable -- no fast-moving dependencies)
