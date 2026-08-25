import { Types } from 'mongoose';
import { EmailEvent } from '../models/EmailEvent.js';
import logger from '../config/logger.js';

/**
 * Rule-action provenance stamping.
 *
 * WHY THIS EXISTS
 * Before this, a rule that marked an email read did a bare
 * `$set: { isRead: true }` and a rule that deleted one wrote (at best) an
 * `automatedByRule` id with no timestamp. That made "what did my rules do
 * today?" unanswerable from the data, which is exactly what the inbox
 * Read/Deleted filters need.
 *
 * THE ONE INVARIANT
 * Only ever call these from a code path that is genuinely rule-driven. The
 * filters promise "as per the rules"; stamping a user's own quick-delete or
 * mark-read would quietly turn that promise into a lie. Manual inbox actions
 * deliberately go through other routes and stay unstamped.
 *
 * MATCHING NOTE
 * Always stamp with the message id the EmailEvent was RECORDED under (the id
 * seen at arrival), not a post-move id. Graph message ids are folder-scoped:
 * a move reassigns the id, so stamping with the moved id matches nothing.
 */

type StampParams = {
  userId: Types.ObjectId | string;
  mailboxId: Types.ObjectId | string;
  /** The arrival-time message id, NOT a post-move id. */
  messageId: string;
  ruleId: Types.ObjectId | string;
  at?: Date;
};

function toObjectId(value: Types.ObjectId | string): Types.ObjectId {
  return typeof value === 'string' ? new Types.ObjectId(value) : value;
}

async function stamp(
  params: StampParams,
  fields: Record<string, unknown>,
  what: string,
): Promise<void> {
  const { userId, mailboxId, messageId } = params;
  try {
    const result = await EmailEvent.updateMany(
      {
        userId: toObjectId(userId),
        mailboxId: toObjectId(mailboxId),
        messageId,
      },
      { $set: fields },
    );
    logger.debug('Stamped rule action provenance', {
      what,
      messageId,
      modified: result.modifiedCount,
    });
  } catch (err) {
    // Provenance is reporting metadata, not the action itself. The Graph call
    // has already succeeded by this point, so failing the whole rule execution
    // here would be worse than a gap in the filter counts. Log loudly instead
    // of throwing -- but never swallow it silently.
    logger.warn('Failed to stamp rule action provenance', {
      what,
      messageId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Record that a RULE marked this message read. */
export async function stampRuleMarkedRead(params: StampParams): Promise<void> {
  const at = params.at ?? new Date();
  await stamp(
    params,
    {
      isRead: true,
      'metadata.ruleMarkedReadAt': at,
      'metadata.ruleMarkedReadBy': toObjectId(params.ruleId),
      'metadata.automatedByRule': toObjectId(params.ruleId),
    },
    'markRead',
  );
}

/** Record that a RULE deleted this message. */
export async function stampRuleDeleted(params: StampParams): Promise<void> {
  const at = params.at ?? new Date();
  await stamp(
    params,
    {
      'metadata.ruleDeletedAt': at,
      'metadata.ruleDeletedBy': toObjectId(params.ruleId),
      'metadata.automatedByRule': toObjectId(params.ruleId),
    },
    'delete',
  );
}

/**
 * Undo a delete stamp because the user rescued the message from staging.
 *
 * A staged delete is stamped when the rule fires, but the grace period means
 * it may never actually happen. Without this, a rescued email would sit in the
 * "Deleted" filter forever claiming a rule deleted it.
 */
export async function clearRuleDeletedStamp(params: {
  userId: Types.ObjectId | string;
  mailboxId: Types.ObjectId | string;
  messageId: string;
}): Promise<void> {
  const { userId, mailboxId, messageId } = params;
  try {
    await EmailEvent.updateMany(
      {
        userId: toObjectId(userId),
        mailboxId: toObjectId(mailboxId),
        messageId,
      },
      {
        $unset: {
          'metadata.ruleDeletedAt': '',
          'metadata.ruleDeletedBy': '',
        },
      },
    );
  } catch (err) {
    logger.warn('Failed to clear rule delete stamp on rescue', {
      messageId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
