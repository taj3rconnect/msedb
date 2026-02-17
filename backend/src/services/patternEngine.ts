import { Types } from 'mongoose';
import { EmailEvent } from '../models/EmailEvent.js';
import { Pattern, type IPattern } from '../models/Pattern.js';
import logger from '../config/logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SUGGESTION_THRESHOLDS: Record<string, number> = {
  delete: 98,
  move: 85,
  archive: 85,
  markRead: 80,
};

export const MIN_OBSERVATION_DAYS = 14;
export const DEFAULT_OBSERVATION_WINDOW = 90;

const RECENCY_WINDOW_DAYS = 7;
const REJECTION_COOLDOWN_DAYS = 30;
const MIN_SENDER_EVENTS = 10;
const MIN_FOLDER_MOVES = 5;
const MAX_EVIDENCE_ITEMS = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfidenceInput {
  actionCount: number;
  totalEvents: number;
  firstSeen: Date;
  lastSeen: Date;
  recentActionCount: number;
  recentTotalEvents: number;
}

interface SenderAggregationResult {
  _id: {
    senderEmail: string;
    senderDomain: string;
  };
  totalEvents: number;
  arrivedCount: number;
  deletedCount: number;
  movedCount: number;
  readCount: number;
  firstSeen: Date;
  lastSeen: Date;
  evidence: Array<{
    messageId: string;
    timestamp: Date;
    eventType: string;
  }>;
}

interface FolderRoutingAggregationResult {
  _id: {
    senderEmail: string;
    toFolder: string;
  };
  moveCount: number;
  firstSeen: Date;
  lastSeen: Date;
  evidence: Array<{
    messageId: string;
    timestamp: Date;
    eventType: string;
  }>;
}

interface RecencyResult {
  _id: null;
  actionCount: number;
  totalEvents: number;
}

// ---------------------------------------------------------------------------
// Pure Functions
// ---------------------------------------------------------------------------

/**
 * Calculate confidence score for a pattern.
 *
 * Formula:
 *   baseRate = (actionCount / totalEvents) * 100
 *   sampleMultiplier = min(1.0 + log10(totalEvents / 10) * 0.05, 1.1)
 *   recencyFactor = (see below)
 *   confidence = min(100, round(baseRate * sampleMultiplier * recencyFactor))
 *
 * Recency factor:
 *   If recentTotalEvents >= 3, compute divergence between recent rate
 *   and overall rate. Penalty up to 15% (factor floor = 0.85).
 */
export function calculateConfidence(input: ConfidenceInput): number {
  const { actionCount, totalEvents, recentActionCount, recentTotalEvents } = input;

  if (totalEvents === 0) return 0;

  // Base rate as percentage
  const baseRate = (actionCount / totalEvents) * 100;

  // Sample size multiplier: logarithmic bonus for larger samples
  // At 10 events = 1.0x, 100 events = 1.05x, 1000+ events = 1.1x max
  const logFactor = totalEvents >= 10 ? Math.log10(totalEvents / 10) : 0;
  const sampleMultiplier = Math.min(1.0 + logFactor * 0.05, 1.1);

  // Recency factor: penalize if recent behavior diverges from overall
  let recencyFactor = 1.0;
  if (recentTotalEvents >= 3) {
    const recentRate = recentActionCount / recentTotalEvents;
    const overallRate = actionCount / totalEvents;
    const divergence = Math.abs(overallRate - recentRate);
    // Penalty = divergence * 0.5, capped so factor doesn't go below 0.85
    const penalty = divergence * 0.5;
    recencyFactor = Math.max(0.85, 1.0 - penalty);
  }

  const confidence = Math.min(100, Math.round(baseRate * sampleMultiplier * recencyFactor));
  return confidence;
}

/**
 * Determine whether a pattern should be suggested to the user.
 *
 * Checks:
 *   1. Confidence meets or exceeds the action-type threshold
 *   2. Pattern has been observed for at least MIN_OBSERVATION_DAYS
 */
export function shouldSuggestPattern(
  confidence: number,
  actionType: string,
  firstSeen: Date,
): boolean {
  // Check observation period
  const daysSinceFirstSeen = (Date.now() - firstSeen.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceFirstSeen < MIN_OBSERVATION_DAYS) {
    return false;
  }

  // Check threshold
  const threshold = SUGGESTION_THRESHOLDS[actionType];
  if (threshold === undefined) {
    // Unknown action type -- do not suggest
    return false;
  }

  return confidence >= threshold;
}

// ---------------------------------------------------------------------------
// Aggregation Functions
// ---------------------------------------------------------------------------

/**
 * Detect sender-level patterns by aggregating EmailEvents.
 *
 * Groups by sender.email + sender.domain, counts per-action-type,
 * filters to senders with 10+ total events, excludes automated events,
 * and collects top 10 recent events as evidence.
 */
export async function detectSenderPatterns(
  userId: Types.ObjectId,
  mailboxId: Types.ObjectId,
  observationWindowDays: number = DEFAULT_OBSERVATION_WINDOW,
): Promise<SenderAggregationResult[]> {
  const windowStart = new Date(Date.now() - observationWindowDays * 24 * 60 * 60 * 1000);

  const results = await EmailEvent.aggregate<SenderAggregationResult>([
    {
      $match: {
        userId,
        mailboxId,
        timestamp: { $gte: windowStart },
        'metadata.automatedByRule': { $exists: false },
        'sender.email': { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: {
          senderEmail: '$sender.email',
          senderDomain: '$sender.domain',
        },
        totalEvents: { $sum: 1 },
        arrivedCount: {
          $sum: { $cond: [{ $eq: ['$eventType', 'arrived'] }, 1, 0] },
        },
        deletedCount: {
          $sum: { $cond: [{ $eq: ['$eventType', 'deleted'] }, 1, 0] },
        },
        movedCount: {
          $sum: { $cond: [{ $eq: ['$eventType', 'moved'] }, 1, 0] },
        },
        readCount: {
          $sum: { $cond: [{ $eq: ['$eventType', 'read'] }, 1, 0] },
        },
        firstSeen: { $min: '$timestamp' },
        lastSeen: { $max: '$timestamp' },
        recentEvents: {
          $topN: {
            n: MAX_EVIDENCE_ITEMS,
            sortBy: { timestamp: -1 as const },
            output: {
              messageId: '$messageId',
              timestamp: '$timestamp',
              eventType: '$eventType',
            },
          },
        },
      },
    },
    {
      $match: {
        totalEvents: { $gte: MIN_SENDER_EVENTS },
      },
    },
    {
      $addFields: {
        evidence: '$recentEvents',
      },
    },
    {
      $project: {
        recentEvents: 0,
      },
    },
  ]);

  return results;
}

/**
 * Detect folder routing patterns.
 *
 * Filters to eventType='moved', groups by sender.email + toFolder,
 * requires 5+ moves to the same folder from the same sender.
 */
export async function detectFolderRoutingPatterns(
  userId: Types.ObjectId,
  mailboxId: Types.ObjectId,
  observationWindowDays: number = DEFAULT_OBSERVATION_WINDOW,
): Promise<FolderRoutingAggregationResult[]> {
  const windowStart = new Date(Date.now() - observationWindowDays * 24 * 60 * 60 * 1000);

  const results = await EmailEvent.aggregate<FolderRoutingAggregationResult>([
    {
      $match: {
        userId,
        mailboxId,
        eventType: 'moved',
        timestamp: { $gte: windowStart },
        'metadata.automatedByRule': { $exists: false },
        'sender.email': { $exists: true, $ne: null },
        toFolder: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: {
          senderEmail: '$sender.email',
          toFolder: '$toFolder',
        },
        moveCount: { $sum: 1 },
        firstSeen: { $min: '$timestamp' },
        lastSeen: { $max: '$timestamp' },
        evidence: {
          $topN: {
            n: MAX_EVIDENCE_ITEMS,
            sortBy: { timestamp: -1 as const },
            output: {
              messageId: '$messageId',
              timestamp: '$timestamp',
              eventType: '$eventType',
            },
          },
        },
      },
    },
    {
      $match: {
        moveCount: { $gte: MIN_FOLDER_MOVES },
      },
    },
  ]);

  return results;
}

/**
 * Get recency stats for a specific sender action in the last N days.
 */
async function getRecencyStats(
  userId: Types.ObjectId,
  mailboxId: Types.ObjectId,
  senderEmail: string,
  actionType: string,
  windowDays: number = RECENCY_WINDOW_DAYS,
): Promise<{ recentActionCount: number; recentTotalEvents: number }> {
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const results = await EmailEvent.aggregate<RecencyResult>([
    {
      $match: {
        userId,
        mailboxId,
        'sender.email': senderEmail,
        timestamp: { $gte: windowStart },
        'metadata.automatedByRule': { $exists: false },
      },
    },
    {
      $group: {
        _id: null,
        totalEvents: { $sum: 1 },
        actionCount: {
          $sum: { $cond: [{ $eq: ['$eventType', actionType] }, 1, 0] },
        },
      },
    },
  ]);

  if (results.length === 0) {
    return { recentActionCount: 0, recentTotalEvents: 0 };
  }

  return {
    recentActionCount: results[0].actionCount,
    recentTotalEvents: results[0].totalEvents,
  };
}

// ---------------------------------------------------------------------------
// Upsert / Persistence Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a rejected pattern exists with an active cooldown.
 */
async function isInRejectionCooldown(
  userId: Types.ObjectId,
  mailboxId: Types.ObjectId,
  patternType: string,
  senderEmail: string,
  actionType: string,
): Promise<boolean> {
  const rejected = await Pattern.findOne({
    userId,
    mailboxId,
    patternType,
    'condition.senderEmail': senderEmail,
    'suggestedAction.actionType': actionType,
    status: 'rejected',
    rejectionCooldownUntil: { $gt: new Date() },
  });

  return rejected !== null;
}

/**
 * Upsert a pattern: update existing detected/suggested, skip approved/rejected,
 * check cooldown for rejected.
 */
async function upsertPattern(params: {
  userId: Types.ObjectId;
  mailboxId: Types.ObjectId;
  patternType: 'sender' | 'folder-routing';
  senderEmail: string;
  senderDomain?: string;
  actionType: string;
  toFolder?: string;
  confidence: number;
  sampleSize: number;
  exceptionCount: number;
  evidence: Array<{ messageId: string; timestamp: Date; action: string }>;
  suggest: boolean;
}): Promise<void> {
  const {
    userId,
    mailboxId,
    patternType,
    senderEmail,
    senderDomain,
    actionType,
    toFolder,
    confidence,
    sampleSize,
    exceptionCount,
    evidence,
    suggest,
  } = params;

  // Check rejection cooldown
  const inCooldown = await isInRejectionCooldown(
    userId,
    mailboxId,
    patternType,
    senderEmail,
    actionType,
  );
  if (inCooldown) {
    logger.debug('Pattern in rejection cooldown, skipping', {
      senderEmail,
      actionType,
    });
    return;
  }

  // Try to find existing pattern in detected/suggested status
  const existing = await Pattern.findOne({
    userId,
    mailboxId,
    patternType,
    'condition.senderEmail': senderEmail,
    'suggestedAction.actionType': actionType,
    status: { $nin: ['approved', 'rejected'] },
  });

  const status = suggest ? 'suggested' : 'detected';

  if (existing) {
    // Update existing pattern
    existing.confidence = confidence;
    existing.sampleSize = sampleSize;
    existing.exceptionCount = exceptionCount;
    existing.evidence = evidence.slice(0, MAX_EVIDENCE_ITEMS) as IPattern['evidence'];
    existing.status = status;
    existing.lastAnalyzedAt = new Date();
    await existing.save();
  } else {
    // Check if approved pattern exists (don't create duplicate)
    const approved = await Pattern.findOne({
      userId,
      mailboxId,
      patternType,
      'condition.senderEmail': senderEmail,
      'suggestedAction.actionType': actionType,
      status: 'approved',
    });
    if (approved) {
      return; // Don't create a duplicate for an already-approved pattern
    }

    // Create new pattern
    await Pattern.create({
      userId,
      mailboxId,
      patternType,
      status,
      confidence,
      sampleSize,
      exceptionCount,
      condition: {
        senderEmail,
        senderDomain,
      },
      suggestedAction: {
        actionType,
        ...(toFolder ? { toFolder } : {}),
      },
      evidence: evidence.slice(0, MAX_EVIDENCE_ITEMS),
      lastAnalyzedAt: new Date(),
    });
  }
}

// ---------------------------------------------------------------------------
// Main Orchestrator
// ---------------------------------------------------------------------------

/**
 * Analyze a mailbox for patterns.
 *
 * Runs both sender-level and folder routing detection, calculates
 * confidence with 7-day recency window, gates via shouldSuggestPattern,
 * and persists results with upsert strategy.
 *
 * Called by BullMQ processor and on-demand API.
 */
export async function analyzeMailboxPatterns(
  userId: Types.ObjectId,
  mailboxId: Types.ObjectId,
): Promise<{ senderPatterns: number; folderRoutingPatterns: number }> {
  const counters = { senderPatterns: 0, folderRoutingPatterns: 0 };

  // --- Sender-level detection ---
  const senderResults = await detectSenderPatterns(userId, mailboxId);

  for (const result of senderResults) {
    const { senderEmail, senderDomain } = result._id;
    const arrivedCount = result.arrivedCount || 0;

    if (arrivedCount === 0) continue; // No arrived events -- can't compute meaningful ratio

    // Evaluate each action type against arrived count
    const actionTypes: Array<{
      type: string;
      count: number;
    }> = [
      { type: 'deleted', count: result.deletedCount },
      { type: 'moved', count: result.movedCount },
      { type: 'read', count: result.readCount },
    ];

    for (const action of actionTypes) {
      if (action.count === 0) continue;

      // Map event type to action type for thresholds
      const actionType = mapEventTypeToActionType(action.type);

      // Get recency stats for this sender + action
      const recency = await getRecencyStats(
        userId,
        mailboxId,
        senderEmail,
        action.type,
      );

      const confidence = calculateConfidence({
        actionCount: action.count,
        totalEvents: arrivedCount,
        firstSeen: result.firstSeen,
        lastSeen: result.lastSeen,
        recentActionCount: recency.recentActionCount,
        recentTotalEvents: recency.recentTotalEvents,
      });

      const suggest = shouldSuggestPattern(confidence, actionType, result.firstSeen);

      // Only persist if confidence is meaningful (> 50% avoids noise)
      if (confidence >= 50) {
        await upsertPattern({
          userId,
          mailboxId,
          patternType: 'sender',
          senderEmail,
          senderDomain,
          actionType,
          confidence,
          sampleSize: arrivedCount,
          exceptionCount: arrivedCount - action.count,
          evidence: result.evidence.map((e) => ({
            messageId: e.messageId,
            timestamp: e.timestamp,
            action: e.eventType,
          })),
          suggest,
        });

        counters.senderPatterns++;
      }
    }
  }

  // --- Folder routing detection ---
  const folderResults = await detectFolderRoutingPatterns(userId, mailboxId);

  for (const result of folderResults) {
    const { senderEmail, toFolder } = result._id;

    // For folder routing, get the total arrived count for this sender
    // to compute a meaningful ratio
    const senderTotal = await EmailEvent.countDocuments({
      userId,
      mailboxId,
      'sender.email': senderEmail,
      eventType: 'arrived',
      'metadata.automatedByRule': { $exists: false },
    });

    if (senderTotal === 0) continue;

    const recency = await getRecencyStats(userId, mailboxId, senderEmail, 'moved');

    const confidence = calculateConfidence({
      actionCount: result.moveCount,
      totalEvents: senderTotal,
      firstSeen: result.firstSeen,
      lastSeen: result.lastSeen,
      recentActionCount: recency.recentActionCount,
      recentTotalEvents: recency.recentTotalEvents,
    });

    const suggest = shouldSuggestPattern(confidence, 'move', result.firstSeen);

    await upsertPattern({
      userId,
      mailboxId,
      patternType: 'folder-routing',
      senderEmail,
      actionType: 'move',
      toFolder,
      confidence,
      sampleSize: senderTotal,
      exceptionCount: senderTotal - result.moveCount,
      evidence: result.evidence.map((e) => ({
        messageId: e.messageId,
        timestamp: e.timestamp,
        action: e.eventType,
      })),
      suggest,
    });

    counters.folderRoutingPatterns++;
  }

  logger.info('Mailbox pattern analysis complete', {
    userId: userId.toString(),
    mailboxId: mailboxId.toString(),
    ...counters,
  });

  return counters;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map EmailEvent eventType to Pattern suggestedAction.actionType.
 */
function mapEventTypeToActionType(eventType: string): string {
  switch (eventType) {
    case 'deleted':
      return 'delete';
    case 'moved':
      return 'move';
    case 'read':
      return 'markRead';
    case 'flagged':
      return 'flag';
    case 'categorized':
      return 'categorize';
    default:
      return eventType;
  }
}
