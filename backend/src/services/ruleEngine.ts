import type { Types } from 'mongoose';
import { User } from '../models/User.js';
import { Rule, type IRuleAction, type IRuleConditions } from '../models/Rule.js';
import { isWhitelisted } from './whitelistService.js';
import type { GraphMessage } from './metadataExtractor.js';

interface RuleEvaluationResult {
  matched: boolean;
  ruleId?: string;
  actions?: IRuleAction[];
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
