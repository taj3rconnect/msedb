import { Types } from 'mongoose';
import { Pattern, type IPattern } from '../models/Pattern.js';
import { Rule, type IRuleConditions, type IRuleAction } from '../models/Rule.js';
import { AuditLog } from '../models/AuditLog.js';
import { NotFoundError, ConflictError } from '../middleware/errorHandler.js';
import logger from '../config/logger.js';

/**
 * Build a human-readable rule name from a pattern.
 *
 * Format: "Auto: {ActionType} from {senderEmail|senderDomain|'matching subjects'}"
 */
export function buildRuleName(pattern: IPattern): string {
  const actionType = pattern.suggestedAction.actionType;
  const capitalizedAction = actionType.charAt(0).toUpperCase() + actionType.slice(1);

  const { senderEmail, senderDomain, subjectPattern } = pattern.condition;

  let target: string;
  if (senderEmail) {
    target = senderEmail;
  } else if (senderDomain) {
    target = senderDomain;
  } else if (subjectPattern) {
    target = 'matching subjects';
  } else {
    target = 'matched emails';
  }

  return `Auto: ${capitalizedAction} from ${target}`;
}

/**
 * Convert an approved Pattern into a Rule document with correctly mapped
 * conditions and multi-action support.
 *
 * Idempotent: calling twice for the same pattern returns the existing rule.
 *
 * Creates an AuditLog entry on rule creation.
 *
 * @throws NotFoundError if pattern not found for user
 * @throws ConflictError if pattern status is not 'approved'
 */
export async function convertPatternToRule(
  patternId: string | Types.ObjectId,
  userId: Types.ObjectId,
): Promise<InstanceType<typeof Rule>> {
  // Find pattern by id and userId
  const pattern = await Pattern.findOne({
    _id: patternId,
    userId,
  });

  if (!pattern) {
    throw new NotFoundError('Pattern not found');
  }

  if (pattern.status !== 'approved') {
    throw new ConflictError(`Pattern must be approved to convert to rule (current status: ${pattern.status})`);
  }

  // Idempotent: check if a rule already exists for this pattern
  const existingRule = await Rule.findOne({ sourcePatternId: pattern._id });
  if (existingRule) {
    logger.info('Rule already exists for pattern', {
      patternId: pattern._id,
      ruleId: existingRule._id,
    });
    return existingRule;
  }

  // Map pattern conditions to rule conditions
  const conditions: IRuleConditions = {};
  if (pattern.condition.senderEmail) {
    conditions.senderEmail = pattern.condition.senderEmail;
  }
  if (pattern.condition.senderDomain) {
    conditions.senderDomain = pattern.condition.senderDomain;
  }
  if (pattern.condition.subjectPattern) {
    conditions.subjectContains = pattern.condition.subjectPattern;
  }
  if (pattern.condition.fromFolder) {
    conditions.fromFolder = pattern.condition.fromFolder;
  }

  // Map pattern suggestedAction to rule actions array (multi-action support: AUTO-01)
  const actions: IRuleAction[] = [];

  // Primary action
  const primaryAction: IRuleAction = {
    actionType: pattern.suggestedAction.actionType,
    order: 0,
  };
  if (pattern.suggestedAction.toFolder) {
    primaryAction.toFolder = pattern.suggestedAction.toFolder;
  }
  if (pattern.suggestedAction.category) {
    primaryAction.category = pattern.suggestedAction.category;
  }
  actions.push(primaryAction);

  // Secondary action: move/archive commonly paired with markRead
  if (pattern.suggestedAction.actionType === 'move' || pattern.suggestedAction.actionType === 'archive') {
    actions.push({
      actionType: 'markRead',
      order: 1,
    });
  }

  // Generate rule name
  const name = buildRuleName(pattern);

  // Find the highest existing priority for this user+mailbox and assign next
  const highestPriorityRule = await Rule.findOne({
    userId,
    mailboxId: pattern.mailboxId,
  })
    .sort({ priority: -1 })
    .select('priority')
    .lean();

  const priority = highestPriorityRule ? highestPriorityRule.priority + 1 : 0;

  // Create Rule document
  const rule = await Rule.create({
    userId,
    mailboxId: pattern.mailboxId,
    name,
    sourcePatternId: pattern._id,
    isEnabled: true,
    priority,
    conditions,
    actions,
    stats: {
      totalExecutions: 0,
      emailsProcessed: 0,
    },
    scope: 'user',
  });

  // Create AuditLog entry
  await AuditLog.create({
    userId,
    mailboxId: pattern.mailboxId,
    action: 'rule_created',
    targetType: 'rule',
    targetId: rule._id?.toString(),
    details: {
      sourcePatternId: pattern._id?.toString(),
      conditions,
      actions,
      name,
    },
    undoable: false,
  });

  logger.info('Converted pattern to rule', {
    patternId: pattern._id,
    ruleId: rule._id,
    name,
    actionsCount: actions.length,
  });

  return rule;
}
