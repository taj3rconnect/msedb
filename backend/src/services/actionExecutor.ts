import type { Types } from 'mongoose';
import { graphFetch, GraphApiError } from './graphClient.js';
import { createStagedEmail, ensureStagingFolder } from './stagingManager.js';
import { Rule, type IRuleAction } from '../models/Rule.js';
import { EmailEvent } from '../models/EmailEvent.js';
import { AuditLog } from '../models/AuditLog.js';
import logger from '../config/logger.js';

/**
 * Read the NEW message id out of a Graph `/move` response body.
 *
 * Graph returns the moved message resource (with its new folder-scoped `id`).
 * Returns null when the body carries no usable id, in which case the caller
 * keeps the id it already had.
 */
async function readMovedMessageId(response: unknown): Promise<string | null> {
  const json = (response as { json?: () => Promise<unknown> } | null)?.json;
  if (typeof json !== 'function') return null;
  try {
    const data = (await json.call(response)) as { id?: unknown } | null;
    const id = data?.id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch (error) {
    logger.warn('Could not read new message id from Graph move response', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Execute a list of rule actions against a message via Microsoft Graph API.
 *
 * SAFETY: Delete actions are NEVER permanent. All deletes are routed through
 * the staging folder (SAFE-03 compliance). The message is moved to the staging
 * folder and a StagedEmail record is created for the grace-period processor.
 *
 * Handles 404 gracefully -- if the message was already moved/deleted by the
 * user, logs a warning but does not fail the entire execution.
 *
 * After all actions complete, updates rule execution stats and creates an
 * audit trail entry.
 */
export async function executeActions(params: {
  mailboxEmail: string;
  messageId: string;
  actions: IRuleAction[];
  ruleId: Types.ObjectId;
  userId: Types.ObjectId;
  mailboxId: Types.ObjectId;
  originalFolder: string;
  accessToken: string;
  skipStaging?: boolean;
}): Promise<void> {
  const {
    mailboxEmail,
    messageId,
    actions,
    ruleId,
    userId,
    mailboxId,
    originalFolder,
    accessToken,
    skipStaging = false,
  } = params;

  // Sort actions by order (ascending), nulls last
  const sortedActions = [...actions].sort((a, b) => {
    const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
    return orderA - orderB;
  });

  const userPath = `/users/${encodeURIComponent(mailboxEmail)}`;
  const executedActions: string[] = [];
  let thrownError: unknown;

  // Graph message ids are FOLDER-SCOPED: a move/archive assigns the message a
  // NEW id and returns the moved resource in the response body. Subsequent
  // actions in the same rule must target that new id, or they 404 against the
  // stale pre-move id and the rest of the approved actions are silently skipped.
  let currentMessageId = messageId;

  const adoptMovedMessageId = async (response: unknown): Promise<void> => {
    const newId = await readMovedMessageId(response);
    if (newId) currentMessageId = newId;
  };

  try {
    for (const action of sortedActions) {
      try {
        switch (action.actionType) {
          case 'delete': {
            if (skipStaging) {
              // Direct delete — skip staging for user-initiated quick actions
              const moved = await graphFetch(
                `${userPath}/messages/${currentMessageId}/move`,
                accessToken,
                {
                  method: 'POST',
                  body: JSON.stringify({ destinationId: 'deleteditems' }),
                },
              );
              await adoptMovedMessageId(moved);
              executedActions.push('delete (direct)');
            } else {
              // Route through staging folder for webhook-triggered automation
              const stagingFolderId = await ensureStagingFolder(
                mailboxEmail,
                accessToken,
              );
              const moved = await graphFetch(
                `${userPath}/messages/${currentMessageId}/move`,
                accessToken,
                {
                  method: 'POST',
                  body: JSON.stringify({ destinationId: stagingFolderId }),
                },
              );
              await adoptMovedMessageId(moved);
              await createStagedEmail({
                userId,
                mailboxId,
                ruleId,
                messageId: currentMessageId,
                originalFolder,
                actions: [{ actionType: 'delete' }],
              });
              executedActions.push('delete (staged)');
            }
            break;
          }

          case 'move': {
            if (!action.toFolder) {
              logger.warn('Move action missing toFolder', {
                ruleId: ruleId.toString(),
                messageId,
              });
              break;
            }
            const moved = await graphFetch(
              `${userPath}/messages/${currentMessageId}/move`,
              accessToken,
              {
                method: 'POST',
                body: JSON.stringify({ destinationId: action.toFolder }),
              },
            );
            await adoptMovedMessageId(moved);
            executedActions.push(`move to ${action.toFolder}`);
            break;
          }

          case 'markRead': {
            await graphFetch(
              `${userPath}/messages/${currentMessageId}`,
              accessToken,
              {
                method: 'PATCH',
                body: JSON.stringify({ isRead: true }),
              },
            );
            // Update our DB so the inbox page reflects the change
            await EmailEvent.updateMany(
              { userId, mailboxId, messageId },
              { $set: { isRead: true } },
            );
            executedActions.push('markRead');
            break;
          }

          case 'categorize': {
            if (!action.category) {
              logger.warn('Categorize action missing category', {
                ruleId: ruleId.toString(),
                messageId,
              });
              break;
            }
            await graphFetch(
              `${userPath}/messages/${currentMessageId}`,
              accessToken,
              {
                method: 'PATCH',
                body: JSON.stringify({ categories: [action.category] }),
              },
            );
            executedActions.push(`categorize as ${action.category}`);
            break;
          }

          case 'archive': {
            const moved = await graphFetch(
              `${userPath}/messages/${currentMessageId}/move`,
              accessToken,
              {
                method: 'POST',
                body: JSON.stringify({ destinationId: 'archive' }),
              },
            );
            await adoptMovedMessageId(moved);
            executedActions.push('archive');
            break;
          }

          case 'flag': {
            await graphFetch(
              `${userPath}/messages/${currentMessageId}`,
              accessToken,
              {
                method: 'PATCH',
                body: JSON.stringify({
                  flag: { flagStatus: 'flagged' },
                }),
              },
            );
            executedActions.push('flag');
            break;
          }

          case 'forward': {
            const recipients = (action.forwardTo ?? [])
              .map((r) => r.trim())
              .filter(Boolean);
            if (recipients.length === 0) {
              logger.warn('Forward action missing recipients', {
                ruleId: ruleId.toString(),
                messageId,
              });
              break;
            }
            // ACT-02 interim mitigation: a BullMQ retry re-runs this whole
            // function from scratch (attempts:3, exponential backoff -- see
            // jobs/queues.ts) with no memory of a prior attempt's
            // executedActions, so a forward that already succeeded before a
            // LATER action in the same rule failed would otherwise get
            // re-sent to real recipients on every retry. The prior attempt's
            // finally block already wrote an audit row recording it, so
            // check that before sending again. Forward is the only
            // genuinely non-idempotent action here -- move/archive/flag/
            // markRead/categorize all either no-op or 404 cleanly on
            // repeat -- so this targets the actual risk without needing a
            // full per-action idempotency ledger, which is a schema change
            // deferred to docs/qa/2026-08-18-e2707e0/REPORT.md's carry-over.
            const recentForward = await AuditLog.findOne({
              action: 'rule_executed',
              targetId: messageId,
              'details.ruleId': ruleId.toString(),
              'details.actions': /^forward to /,
              createdAt: { $gte: new Date(Date.now() - 15 * 60 * 1000) },
            }).lean();

            if (recentForward) {
              logger.warn('Skipping forward -- already sent in a recent attempt for this rule/message (retry dedup)', {
                ruleId: ruleId.toString(),
                messageId,
              });
              executedActions.push('forward (skipped -- already sent this retry window)');
              break;
            }

            await graphFetch(
              `${userPath}/messages/${currentMessageId}/forward`,
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
            executedActions.push(`forward to ${recipients.join(', ')}`);
            break;
          }

          default:
            logger.warn('Unknown action type', {
              actionType: action.actionType,
              ruleId: ruleId.toString(),
            });
        }
      } catch (error) {
        // Handle 404 gracefully -- message may have been moved/deleted by user
        if (error instanceof GraphApiError && error.status === 404) {
          logger.warn('Message not found during action execution (user may have moved/deleted)', {
            messageId,
            actionType: action.actionType,
            ruleId: ruleId.toString(),
          });
          break; // Stop processing further actions for this message
        }
        throw error; // Re-throw non-404 errors
      }
    }
  } catch (error) {
    // Record the error but still persist stats/audit for actions already executed
    thrownError = error;
  } finally {
    // Update rule execution stats. totalExecutions/emailsProcessed only
    // count runs that actually did something -- an immediate 404 (message
    // already moved/deleted) breaks the loop before any action completes,
    // and counting that as a processed email would over-report rule
    // effectiveness. lastExecutedAt still updates unconditionally: the rule
    // WAS evaluated at this time, whether or not anything executed.
    const statsUpdate: {
      $set: Record<string, unknown>;
      $inc?: Record<string, number>;
    } = { $set: { 'stats.lastExecutedAt': new Date() } };
    if (executedActions.length > 0) {
      statsUpdate.$inc = {
        'stats.totalExecutions': 1,
        'stats.emailsProcessed': 1,
      };
    }
    await Rule.findByIdAndUpdate(ruleId, statsUpdate);

    // Audit trail
    await AuditLog.create({
      userId,
      mailboxId,
      action: 'rule_executed',
      targetType: 'email',
      targetId: messageId,
      details: {
        ruleId: ruleId.toString(),
        actions: executedActions,
        messageId,
        originalFolder,
      },
      undoable: true,
    });

    logger.info('Rule actions executed', {
      ruleId: ruleId.toString(),
      messageId,
      actions: executedActions,
    });
  }

  if (thrownError) throw thrownError;
}
