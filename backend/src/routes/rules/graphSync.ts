import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { getUserId } from '../../auth/middleware.js';
import { Mailbox } from '../../models/Mailbox.js';
import { convertPatternToRule } from '../../services/ruleConverter.js';
import { getAccessTokenForMailbox } from '../../auth/tokenManager.js';
import { syncAllRulesToGraph } from '../../services/graphRuleSync.js';
import {
  NotFoundError,
  ValidationError,
} from '../../middleware/errorHandler.js';

const graphSyncRouter = Router();

/**
 * POST /api/rules/from-pattern
 *
 * Convert an approved pattern to a rule (AUTO-04).
 * Body: { patternId }
 */
graphSyncRouter.post('/from-pattern', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { patternId } = req.body as { patternId?: string };

  if (!patternId) {
    throw new ValidationError('patternId is required');
  }

  const rule = await convertPatternToRule(patternId, new Types.ObjectId(userId));

  res.status(201).json({ rule });
});

/**
 * POST /api/rules/sync-to-graph
 *
 * Bulk-sync all enabled rules for a mailbox to Graph inbox rules.
 * Body: { mailboxId }
 */
graphSyncRouter.post('/sync-to-graph', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { mailboxId } = req.body as { mailboxId?: string };

  if (!mailboxId) {
    throw new ValidationError('mailboxId is required');
  }

  const mailbox = await Mailbox.findOne({ _id: mailboxId, userId });
  if (!mailbox) {
    throw new NotFoundError('Mailbox not found');
  }

  const accessToken = await getAccessTokenForMailbox(mailboxId);
  const result = await syncAllRulesToGraph(userId, mailboxId, mailbox.email, accessToken);

  res.json(result);
});

export default graphSyncRouter;
