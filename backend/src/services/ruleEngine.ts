import { Types } from 'mongoose';
import { User } from '../models/User.js';
import { Rule, type IRuleAction, type IRuleConditions } from '../models/Rule.js';
import { EmailEvent } from '../models/EmailEvent.js';
import { isWhitelisted } from './whitelistService.js';
import { graphFetch } from './graphClient.js';
import logger from '../config/logger.js';
import type { GraphMessage } from './metadataExtractor.js';

interface RuleEvaluationResult {
  matched: boolean;
  ruleId?: string;
  actions?: IRuleAction[];
  skipStaging?: boolean;
}

/**
 * Evaluate all enabled rules for a given message.
 *
 * Evaluation order (SAFE-01 / SAFE-02 compliance):
 *   1. Kill switch -- if user has automation paused, no rules fire
 *   2. Whitelist -- if sender is whitelisted, no rules fire
 *   3. Priority rules -- first-match-wins, sorted by priority (ascending)
 *
 * @param userId - The user who owns the rules
 * @param mailboxId - The mailbox the message belongs to
 * @param message - The Graph API message object
 * @param _accessToken - Reserved for future use (e.g., enrichment)
 * @returns The matched rule's ID and actions, or { matched: false }
 */
export async function evaluateRulesForMessage(
  userId: Types.ObjectId,
  mailboxId: Types.ObjectId,
  message: GraphMessage,
  _accessToken: string,
): Promise<RuleEvaluationResult> {
  // Step 1: Check kill switch
  const user = await User.findById(userId).select('preferences.automationPaused');
  if (user?.preferences?.automationPaused === true) {
    return { matched: false };
  }

  // Step 2: Check whitelist
  const senderAddress = message.from?.emailAddress?.address;
  if (senderAddress) {
    const whitelisted = await isWhitelisted(mailboxId, senderAddress);
    if (whitelisted) {
      return { matched: false };
    }
  }

  // Step 3: Query rules, sorted by priority (ascending), first-match-wins
  const rules = await Rule.find({
    userId,
    mailboxId,
    isEnabled: true,
  }).sort({ priority: 1 });

  for (const rule of rules) {
    if (matchesConditions(rule.conditions, message)) {
      return {
        matched: true,
        ruleId: rule._id.toString(),
        actions: rule.actions,
        skipStaging: rule.skipStaging ?? false,
      };
    }
  }

  return { matched: false };
}

/**
 * Check if a message matches a set of rule conditions.
 * ALL set conditions must match (AND logic).
 *
 * @param conditions - The rule conditions to check
 * @param message - The Graph API message object
 * @returns true if all set conditions match
 */
export function matchesConditions(
  conditions: IRuleConditions,
  message: GraphMessage,
): boolean {
  const senderAddress = message.from?.emailAddress?.address?.toLowerCase() ?? '';

  // senderEmail: case-insensitive exact match (supports single string or array)
  if (conditions.senderEmail) {
    const senders = Array.isArray(conditions.senderEmail)
      ? conditions.senderEmail
      : [conditions.senderEmail];
    if (!senders.some((s) => s.toLowerCase() === senderAddress)) {
      return false;
    }
  }

  // senderDomain: case-insensitive domain match
  if (conditions.senderDomain) {
    const domain = senderAddress.split('@')[1] ?? '';
    if (domain !== conditions.senderDomain.toLowerCase()) {
      return false;
    }
  }

  // subjectContains: case-insensitive substring match
  if (conditions.subjectContains) {
    const subject = (message.subject ?? '').toLowerCase();
    if (!subject.includes(conditions.subjectContains.toLowerCase())) {
      return false;
    }
  }

  // bodyContains: case-insensitive substring match against bodyPreview
  if (conditions.bodyContains) {
    const body = (message.bodyPreview ?? '').toLowerCase();
    if (!body.includes(conditions.bodyContains.toLowerCase())) {
      return false;
    }
  }

  // fromFolder: exact parentFolderId match
  if (conditions.fromFolder) {
    if (message.parentFolderId !== conditions.fromFolder) {
      return false;
    }
  }

  return true;
}

/**
 * Shared simulation helper: runs a read-only query against EmailEvent
 * to estimate how many historical emails would match given conditions.
 * Used by both POST /api/rules/simulate (ad-hoc) and POST /api/rules/:id/simulate (saved rule).
 */
export async function simulateRule(
  userId: string,
  mailboxId: string,
  conditions: {
    senderEmail?: string | string[];
    senderDomain?: string;
    subjectContains?: string;
    bodyContains?: string;
    fromFolder?: string;
  },
  dateRange?: '30d' | '60d' | '90d',
) {
  const days = dateRange === '60d' ? 60 : dateRange === '90d' ? 90 : 30;
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Base filter: arrived events only, not automated by rules
  const baseFilter: Record<string, unknown> = {
    userId: new Types.ObjectId(userId),
    mailboxId: new Types.ObjectId(mailboxId),
    eventType: 'arrived',
    'metadata.automatedByRule': { $exists: false },
    timestamp: { $gte: since },
  };

  // Build condition-specific filter
  const filter: Record<string, unknown> = { ...baseFilter };

  // senderEmail — case-insensitive match
  const senders = conditions.senderEmail
    ? Array.isArray(conditions.senderEmail)
      ? conditions.senderEmail
      : [conditions.senderEmail]
    : [];
  if (senders.length > 0) {
    filter['sender.email'] = {
      $in: senders.map((s) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')),
    };
  }

  // senderDomain — exact match
  if (conditions.senderDomain) {
    filter['sender.domain'] = conditions.senderDomain.toLowerCase();
  }

  // subjectContains — case-insensitive regex
  if (conditions.subjectContains) {
    const escaped = conditions.subjectContains.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.subject = { $regex: escaped, $options: 'i' };
  }

  // fromFolder — exact match
  if (conditions.fromFolder) {
    filter.fromFolder = conditions.fromFolder;
  }

  // bodyContains is skipped — EmailEvent doesn't store body text
  const bodyContainsSkipped = !!conditions.bodyContains;

  // Run 3 parallel queries
  const [totalMatched, emails, scannedCount] = await Promise.all([
    EmailEvent.countDocuments(filter),
    EmailEvent.find(filter)
      .sort({ timestamp: -1 })
      .limit(50)
      .select('sender subject timestamp fromFolder isRead importance')
      .lean(),
    EmailEvent.countDocuments(baseFilter),
  ]);

  return {
    totalMatched,
    emails: emails.map((e) => ({
      _id: e._id.toString(),
      sender: e.sender,
      subject: e.subject,
      timestamp: e.timestamp,
      fromFolder: e.fromFolder,
      isRead: e.isRead,
      importance: e.importance,
    })),
    dateRange: `${days}d`,
    scannedCount,
    ...(bodyContainsSkipped ? { bodyContainsSkipped: true } : {}),
  };
}

export interface RunNowMessage {
  id: string;
  from?: { emailAddress: { address?: string } };
  subject?: string;
  bodyPreview?: string;
}

/**
 * "Run Now" message-finding step: fetch all unread messages from the mailbox
 * via Graph API, then filter client-side by the rule's conditions.
 *
 * NOTE: $search (KQL) and $filter CANNOT be combined for messages in Graph API.
 * Strategy: fetch all unread messages ($filter=isRead eq false) and do all
 * condition matching (sender, domain, subject, body) client-side.
 */
export async function findMatchingMessagesForRule(
  email: string,
  accessToken: string,
  conditions: IRuleConditions,
): Promise<RunNowMessage[]> {
  const senders = conditions.senderEmail
    ? Array.isArray(conditions.senderEmail)
      ? conditions.senderEmail
      : [conditions.senderEmail]
    : [];

  const selectParts = ['id', 'from'];
  if (conditions.subjectContains || conditions.bodyContains) selectParts.push('subject', 'bodyPreview');
  const selectFields = [...new Set(selectParts)].join(',');
  const filterStr = encodeURIComponent('isRead eq false');

  // Fetch all unread messages from the mailbox (paginated via @odata.nextLink)
  const allMessages: RunNowMessage[] = [];
  const initialUrl = `/users/${email}/messages?$select=${selectFields}&$filter=${filterStr}&$top=100`;
  logger.info('RunRule: fetching unread messages', { initialUrl, senders, email });
  let nextUrl: string | null = initialUrl;

  while (nextUrl) {
    const response = await graphFetch(nextUrl, accessToken);
    const data = (await response.json()) as {
      value: RunNowMessage[];
      '@odata.nextLink'?: string;
    };
    for (const msg of data.value) {
      allMessages.push(msg);
    }
    nextUrl = data['@odata.nextLink'] ?? null;
  }

  logger.info('RunRule: fetch complete', { totalFetched: allMessages.length, sampleFrom: allMessages.slice(0, 3).map((m) => m.from?.emailAddress?.address) });

  // Client-side filtering
  let filteredMessages = allMessages;

  // Exact sender email match
  if (senders.length > 0) {
    const senderSet = new Set(senders.map((s) => s.toLowerCase()));
    filteredMessages = filteredMessages.filter((msg) => {
      const addr = msg.from?.emailAddress?.address?.toLowerCase() ?? '';
      return senderSet.has(addr);
    });
  }

  // senderDomain: client-side endsWith
  if (conditions.senderDomain) {
    const domainLower = conditions.senderDomain.toLowerCase();
    filteredMessages = filteredMessages.filter((msg) => {
      const addr = msg.from?.emailAddress?.address?.toLowerCase() ?? '';
      const domain = addr.split('@')[1] ?? '';
      return domain === domainLower;
    });
  }

  // subjectContains: client-side case-insensitive
  if (conditions.subjectContains) {
    const needle = conditions.subjectContains.toLowerCase();
    filteredMessages = filteredMessages.filter(
      (msg) => (msg.subject ?? '').toLowerCase().includes(needle),
    );
  }

  // bodyContains: client-side case-insensitive (uses bodyPreview)
  if (conditions.bodyContains) {
    const needle = conditions.bodyContains.toLowerCase();
    filteredMessages = filteredMessages.filter(
      (msg) => (msg.bodyPreview ?? '').toLowerCase().includes(needle),
    );
  }

  return filteredMessages;
}

/**
 * "Run Now" action-application step: applies the rule's actions directly to
 * each matched message via Graph API.
 *
 * DELIBERATE BEHAVIOR PRESERVATION: this duplicates (rather than reuses)
 * `actionExecutor.ts::executeActions` on purpose. `executeActions` always
 * routes deletes through the staging folder and writes one AuditLog entry
 * per message; the pre-existing "Run Now" behavior deletes directly (no
 * staging) and the route writes a single aggregate AuditLog entry for the
 * whole run. Whether "Run Now" should stage deletes is a pending product
 * decision (see docs/large-file-split-plan.md §3.2) — do not "fix" this
 * here, it would silently change stored data (rule stats, audit trail).
 */
export async function applyRuleActionsToMessages(params: {
  email: string;
  accessToken: string;
  actions: IRuleAction[];
  messageIds: string[];
  userId: string;
  mailboxId: Types.ObjectId;
  ruleId: string;
}): Promise<{ applied: number; failed: number }> {
  const { email, accessToken, actions, messageIds, userId, mailboxId, ruleId } = params;

  let applied = 0;
  let failed = 0;

  for (const msgId of messageIds) {
    try {
      for (const action of actions) {
        switch (action.actionType) {
          case 'delete':
            await graphFetch(
              `/users/${email}/messages/${msgId}/move`,
              accessToken,
              {
                method: 'POST',
                body: JSON.stringify({ destinationId: 'deleteditems' }),
              },
            );
            break;
          case 'move':
            if (action.toFolder) {
              await graphFetch(
                `/users/${email}/messages/${msgId}/move`,
                accessToken,
                {
                  method: 'POST',
                  body: JSON.stringify({ destinationId: action.toFolder }),
                },
              );
            }
            break;
          case 'markRead':
            await graphFetch(
              `/users/${email}/messages/${msgId}`,
              accessToken,
              {
                method: 'PATCH',
                body: JSON.stringify({ isRead: true }),
              },
            );
            // Update our DB so inbox page reflects the change
            await EmailEvent.updateMany(
              { userId: new Types.ObjectId(userId), mailboxId, messageId: msgId },
              { $set: { isRead: true } },
            );
            break;
          case 'archive':
            await graphFetch(
              `/users/${email}/messages/${msgId}/move`,
              accessToken,
              {
                method: 'POST',
                body: JSON.stringify({ destinationId: 'archive' }),
              },
            );
            break;
          case 'forward': {
            const recipients = (action.forwardTo ?? [])
              .map((r) => r.trim())
              .filter(Boolean);
            if (recipients.length > 0) {
              await graphFetch(
                `/users/${email}/messages/${msgId}/forward`,
                accessToken,
                {
                  method: 'POST',
                  body: JSON.stringify({
                    comment: 'Automatically forwarded by an MSEDB rule.',
                    toRecipients: recipients.map((address) => ({
                      emailAddress: { address },
                    })),
                  }),
                },
              );
            }
            break;
          }
        }
      }
      applied++;
    } catch (err) {
      failed++;
      logger.warn('Failed to apply rule action to message', {
        ruleId,
        messageId: msgId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { applied, failed };
}
