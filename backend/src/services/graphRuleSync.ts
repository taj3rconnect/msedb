import { graphFetch, GraphApiError } from './graphClient.js';
import { Rule, type IRuleConditions, type IRuleAction } from '../models/Rule.js';
import logger from '../config/logger.js';

/**
 * Microsoft Graph messageRule shape (subset we use).
 * Docs: https://learn.microsoft.com/en-us/graph/api/resources/messagerule
 */
interface GraphMessageRule {
  id?: string;
  displayName: string;
  sequence: number;
  isEnabled: boolean;
  conditions: {
    fromAddresses?: Array<{ emailAddress: { address: string } }>;
    senderContains?: string[];
  };
  actions: {
    moveToFolder?: string;
    delete?: boolean;
    markAsRead?: boolean;
    stopProcessingRules?: boolean;
  };
}

/**
 * Convert MSEDB rule conditions + actions into a Graph messageRule body.
 * Returns null if the rule can't be mapped to a Graph inbox rule.
 */
function toGraphRule(
  name: string,
  conditions: IRuleConditions,
  actions: IRuleAction[],
  isEnabled: boolean,
): GraphMessageRule | null {
  const graphConditions: GraphMessageRule['conditions'] = {};

  // Map sender conditions
  if (conditions.senderEmail) {
    const emails = Array.isArray(conditions.senderEmail)
      ? conditions.senderEmail
      : [conditions.senderEmail];
    graphConditions.fromAddresses = emails.map((addr) => ({
      emailAddress: { address: addr },
    }));
  } else if (conditions.senderDomain) {
    // Domain-based: use senderContains with @domain
    graphConditions.senderContains = [`@${conditions.senderDomain}`];
  } else {
    // Can't create a Graph rule without sender conditions
    // (subject/body filters aren't worth syncing server-side)
    return null;
  }

  // Map actions
  const graphActions: GraphMessageRule['actions'] = {
    stopProcessingRules: true,
  };

  for (const action of actions) {
    switch (action.actionType) {
      case 'delete':
        graphActions.moveToFolder = 'deleteditems';
        break;
      case 'markRead':
        graphActions.markAsRead = true;
        break;
      case 'archive':
        graphActions.moveToFolder = 'archive';
        break;
      case 'move':
        if (action.toFolder) {
          graphActions.moveToFolder = action.toFolder;
        }
        break;
      // flag, categorize — not supported as Graph inbox rule actions, skip
    }
  }

  // Must have at least one action
  if (!graphActions.moveToFolder && !graphActions.markAsRead && !graphActions.delete) {
    return null;
  }

  return {
    displayName: `MSEDB: ${name}`,
    sequence: 1,
    isEnabled,
    conditions: graphConditions,
    actions: graphActions,
  };
}

/**
 * Create or update a Microsoft Graph inbox rule for the given MSEDB rule.
 * Stores the Graph rule ID in the MSEDB rule's graphRuleId field.
 *
 * If the rule already has a graphRuleId, updates the existing Graph rule.
 * If not, creates a new one.
 */
export async function syncRuleToGraph(
  ruleId: string,
  mailboxEmail: string,
  accessToken: string,
): Promise<string | null> {
  const rule = await Rule.findById(ruleId);
  if (!rule) return null;

  const graphBody = toGraphRule(rule.name, rule.conditions, rule.actions, rule.isEnabled);
  if (!graphBody) {
    logger.debug('Rule cannot be mapped to Graph inbox rule', { ruleId });
    return null;
  }

  const userPath = `/users/${encodeURIComponent(mailboxEmail)}`;

  try {
    if (rule.graphRuleId) {
      // Update existing Graph rule
      await graphFetch(
        `${userPath}/mailFolders/inbox/messageRules/${rule.graphRuleId}`,
        accessToken,
        {
          method: 'PATCH',
          body: JSON.stringify(graphBody),
        },
      );
      logger.info('Graph inbox rule updated', {
        ruleId,
        graphRuleId: rule.graphRuleId,
        mailboxEmail,
      });
      return rule.graphRuleId;
    } else {
      // Create new Graph rule
      const response = await graphFetch(
        `${userPath}/mailFolders/inbox/messageRules`,
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify(graphBody),
        },
      );
      const data = (await response.json()) as { id: string };
      const graphRuleId = data.id;

      // Store Graph rule ID in MSEDB rule
      rule.graphRuleId = graphRuleId;
      await rule.save();

      logger.info('Graph inbox rule created', {
        ruleId,
        graphRuleId,
        mailboxEmail,
        displayName: graphBody.displayName,
      });
      return graphRuleId;
    }
  } catch (err) {
    if (err instanceof GraphApiError && err.status === 404 && rule.graphRuleId) {
      // Graph rule was deleted externally, create a new one
      rule.graphRuleId = undefined;
      await rule.save();
      return syncRuleToGraph(ruleId, mailboxEmail, accessToken);
    }
    logger.error('Failed to sync rule to Graph', {
      ruleId,
      graphRuleId: rule.graphRuleId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Delete the Graph inbox rule associated with an MSEDB rule.
 */
export async function deleteGraphRule(
  ruleId: string,
  mailboxEmail: string,
  accessToken: string,
): Promise<void> {
  const rule = await Rule.findById(ruleId);
  if (!rule?.graphRuleId) return;

  const userPath = `/users/${encodeURIComponent(mailboxEmail)}`;

  try {
    await graphFetch(
      `${userPath}/mailFolders/inbox/messageRules/${rule.graphRuleId}`,
      accessToken,
      { method: 'DELETE' },
    );
    logger.info('Graph inbox rule deleted', {
      ruleId,
      graphRuleId: rule.graphRuleId,
      mailboxEmail,
    });
  } catch (err) {
    if (err instanceof GraphApiError && err.status === 404) {
      // Already deleted — ignore
      logger.debug('Graph inbox rule already deleted', { ruleId, graphRuleId: rule.graphRuleId });
    } else {
      logger.error('Failed to delete Graph inbox rule', {
        ruleId,
        graphRuleId: rule.graphRuleId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Clear the reference
  rule.graphRuleId = undefined;
  await rule.save();
}

/**
 * Bulk-sync all enabled rules for a mailbox to Graph inbox rules.
 * Returns stats: { synced, skipped, failed }.
 */
export async function syncAllRulesToGraph(
  userId: string,
  mailboxId: string,
  mailboxEmail: string,
  accessToken: string,
): Promise<{ synced: number; skipped: number; failed: number }> {
  const rules = await Rule.find({
    userId,
    mailboxId,
    isEnabled: true,
  });

  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const rule of rules) {
    try {
      const result = await syncRuleToGraph(
        rule._id.toString(),
        mailboxEmail,
        accessToken,
      );
      if (result) {
        synced++;
      } else {
        skipped++;
      }
    } catch {
      failed++;
    }
  }

  logger.info('Bulk Graph rule sync completed', {
    userId,
    mailboxId,
    mailboxEmail,
    synced,
    skipped,
    failed,
    total: rules.length,
  });

  return { synced, skipped, failed };
}
