import { Types } from 'mongoose';
import { graphFetch, GraphApiError } from './graphClient.js';
import { AuditLog, type IAuditLog } from '../models/AuditLog.js';
import { Mailbox } from '../models/Mailbox.js';
import { StagedEmail } from '../models/StagedEmail.js';
import { getAccessTokenForMailbox } from '../auth/tokenManager.js';
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import logger from '../config/logger.js';

/** Maximum age of an audit entry that can be undone (48 hours in ms). */
const UNDO_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Undo an automated action within the 48-hour safety window.
 *
 * Supports undoing:
 * - rule_executed: reverses move, markRead, categorize, flag actions via Graph API
 * - email_executed: moves email back from Deleted Items to original folder
 * - email_staged: rescues a staged email by marking it as rescued and moving it back
 *
 * SAFETY: Never calls permanentDelete (SAFE-03).
 *
 * @throws NotFoundError if audit entry not found
 * @throws ValidationError if entry is not undoable, already undone, or past 48h window
 */
export async function undoAction(
  auditLogId: string,
  userId: Types.ObjectId,
): Promise<IAuditLog> {
  // Find the audit entry
  const auditEntry = await AuditLog.findOne({
    _id: auditLogId,
    userId,
  });

  if (!auditEntry) {
    throw new NotFoundError('Audit log entry not found');
  }

  if (!auditEntry.undoable) {
    throw new ValidationError('This action is not undoable');
  }

  if (auditEntry.undoneAt) {
    throw new ValidationError('This action has already been undone');
  }

  // Check 48-hour window
  const ageMs = Date.now() - auditEntry.createdAt.getTime();
  if (ageMs > UNDO_WINDOW_MS) {
    throw new ValidationError('Undo window has expired');
  }

  // Get mailbox and access token
  if (!auditEntry.mailboxId) {
    throw new ValidationError('Audit entry has no associated mailbox');
  }

  const mailbox = await Mailbox.findById(auditEntry.mailboxId);
  if (!mailbox) {
    throw new NotFoundError('Mailbox not found');
  }

  const accessToken = await getAccessTokenForMailbox(auditEntry.mailboxId.toString());
  const email = mailbox.email;

  // Dispatch based on action type
  switch (auditEntry.action) {
    case 'rule_executed':
      await undoRuleExecuted(auditEntry, email, accessToken);
      break;

    case 'email_executed':
      await undoEmailExecuted(auditEntry, email, accessToken);
      break;

    case 'email_staged':
      await undoEmailStaged(auditEntry, email, accessToken);
      break;

    default:
      throw new ValidationError(`Undo not supported for action type: ${auditEntry.action}`);
  }

  // Mark the audit entry as undone
  auditEntry.undoneAt = new Date();
  auditEntry.undoneBy = userId;
  await auditEntry.save();

  // Create a new audit log for the undo action
  await AuditLog.create({
    userId,
    mailboxId: auditEntry.mailboxId,
    action: 'undo_action',
    targetType: auditEntry.targetType,
    targetId: auditEntry.targetId,
    details: {
      originalAuditLogId: auditEntry._id?.toString(),
      originalAction: auditEntry.action,
    },
    undoable: false,
  });

  logger.info('Action undone successfully', {
    auditLogId: auditEntry._id,
    action: auditEntry.action,
    userId: userId.toString(),
  });

  return auditEntry;
}

/**
 * Undo a rule_executed action.
 * Reverses each action in the rule execution (in reverse order).
 */
async function undoRuleExecuted(
  auditEntry: IAuditLog,
  email: string,
  accessToken: string,
): Promise<void> {
  const details = auditEntry.details as Record<string, unknown> | undefined;
  if (!details) {
    throw new ValidationError('Audit entry missing details for undo');
  }

  const messageId = (details.messageId as string | undefined) || auditEntry.targetId;
  const originalFolder = details.originalFolder as string | undefined;
  const actions = details.actions as Array<{ actionType: string; toFolder?: string }> | undefined;

  if (!messageId) {
    throw new ValidationError('Audit entry missing messageId');
  }

  if (!actions || actions.length === 0) {
    logger.warn('No actions to undo for rule_executed', { auditLogId: auditEntry._id });
    return;
  }

  // Reverse the actions in reverse order
  const reversedActions = [...actions].reverse();

  for (const action of reversedActions) {
    try {
      switch (action.actionType) {
        case 'move':
        case 'archive':
          if (originalFolder) {
            await graphFetch(
              `/users/${encodeURIComponent(email)}/messages/${messageId}/move`,
              accessToken,
              {
                method: 'POST',
                body: JSON.stringify({ destinationId: originalFolder }),
              },
            );
          }
          break;

        case 'markRead':
          await graphFetch(
            `/users/${encodeURIComponent(email)}/messages/${messageId}`,
            accessToken,
            {
              method: 'PATCH',
              body: JSON.stringify({ isRead: false }),
            },
          );
          break;

        case 'categorize':
          await graphFetch(
            `/users/${encodeURIComponent(email)}/messages/${messageId}`,
            accessToken,
            {
              method: 'PATCH',
              body: JSON.stringify({ categories: [] }),
            },
          );
          break;

        case 'flag':
          await graphFetch(
            `/users/${encodeURIComponent(email)}/messages/${messageId}`,
            accessToken,
            {
              method: 'PATCH',
              body: JSON.stringify({ flag: { flagStatus: 'notFlagged' } }),
            },
          );
          break;

        case 'delete':
          // Delete went through staging, handled by email_staged/email_executed undo
          logger.info('Delete action undo handled via staging flow', {
            auditLogId: auditEntry._id,
          });
          break;

        default:
          logger.warn('Unknown action type in undo', {
            actionType: action.actionType,
            auditLogId: auditEntry._id,
          });
      }
    } catch (error) {
      if (error instanceof GraphApiError && error.status === 404) {
        // Message no longer available (purged by Exchange retention)
        logger.warn('Message no longer available for undo', {
          messageId,
          actionType: action.actionType,
          auditLogId: auditEntry._id,
        });
        if (!auditEntry.details) {
          auditEntry.details = {};
        }
        (auditEntry.details as Record<string, unknown>).undoPartial = true;
        (auditEntry.details as Record<string, unknown>).undoReason = 'Message no longer available';
        auditEntry.markModified('details');
      } else {
        throw error;
      }
    }
  }
}

/**
 * Undo an email_executed action.
 * The email was moved to Deleted Items by the staging processor -- move it back.
 */
async function undoEmailExecuted(
  auditEntry: IAuditLog,
  email: string,
  accessToken: string,
): Promise<void> {
  const details = auditEntry.details as Record<string, unknown> | undefined;
  if (!details) {
    throw new ValidationError('Audit entry missing details for undo');
  }

  const messageId = (details.messageId as string | undefined) || auditEntry.targetId;
  const originalFolder = details.originalFolder as string | undefined;

  if (!messageId) {
    throw new ValidationError('Audit entry missing messageId');
  }

  if (!originalFolder) {
    throw new ValidationError('Audit entry missing originalFolder');
  }

  try {
    await graphFetch(
      `/users/${encodeURIComponent(email)}/messages/${messageId}/move`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({ destinationId: originalFolder }),
      },
    );
  } catch (error) {
    if (error instanceof GraphApiError && error.status === 404) {
      // Email may have been permanently purged by Exchange retention
      logger.warn('Message no longer available for undo (may have been purged)', {
        messageId,
        auditLogId: auditEntry._id,
      });
      if (!auditEntry.details) {
        auditEntry.details = {};
      }
      (auditEntry.details as Record<string, unknown>).undoFailed = true;
      (auditEntry.details as Record<string, unknown>).undoReason = 'Message no longer available';
      auditEntry.markModified('details');
      // Still mark as undone (best effort), but note the partial failure
      return;
    }
    throw error;
  }
}

/**
 * Undo an email_staged action.
 * The email is still in the staging folder -- rescue it by moving it back
 * and updating the StagedEmail status.
 */
async function undoEmailStaged(
  auditEntry: IAuditLog,
  email: string,
  accessToken: string,
): Promise<void> {
  const details = auditEntry.details as Record<string, unknown> | undefined;
  if (!details) {
    throw new ValidationError('Audit entry missing details for undo');
  }

  const messageId = details.messageId as string | undefined;
  const originalFolder = details.originalFolder as string | undefined;
  const stagedEmailId = details.stagedEmailId as string | undefined;

  if (!messageId) {
    throw new ValidationError('Audit entry missing messageId');
  }

  if (!originalFolder) {
    throw new ValidationError('Audit entry missing originalFolder');
  }

  // Update StagedEmail status to 'rescued' if we have the reference
  if (stagedEmailId) {
    await StagedEmail.findByIdAndUpdate(stagedEmailId, {
      status: 'rescued',
      rescuedAt: new Date(),
    });
  } else {
    // Try to find by messageId
    await StagedEmail.findOneAndUpdate(
      { messageId, userId: auditEntry.userId, status: 'staged' },
      { status: 'rescued', rescuedAt: new Date() },
    );
  }

  // Move email back to original folder
  try {
    await graphFetch(
      `/users/${encodeURIComponent(email)}/messages/${messageId}/move`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({ destinationId: originalFolder }),
      },
    );
  } catch (error) {
    if (error instanceof GraphApiError && error.status === 404) {
      logger.warn('Staged message no longer available for rescue', {
        messageId,
        auditLogId: auditEntry._id,
      });
      if (!auditEntry.details) {
        auditEntry.details = {};
      }
      (auditEntry.details as Record<string, unknown>).undoPartial = true;
      (auditEntry.details as Record<string, unknown>).undoReason = 'Message no longer available';
      auditEntry.markModified('details');
      return;
    }
    throw error;
  }
}
