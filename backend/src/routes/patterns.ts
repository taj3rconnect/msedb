import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { requireAuth, getUserId } from '../auth/middleware.js';
import { Pattern } from '../models/Pattern.js';
import { Mailbox } from '../models/Mailbox.js';
import { Rule } from '../models/Rule.js';
import { AuditLog } from '../models/AuditLog.js';
import { User } from '../models/User.js';
import { queues } from '../jobs/queues.js';
import { convertPatternToRule } from '../services/ruleConverter.js';
import { getAccessTokenForMailbox } from '../auth/tokenManager.js';
import { graphFetch } from '../services/graphClient.js';
import logger from '../config/logger.js';
import { parsePagination } from '../utils/pagination.js';
import {
  NotFoundError,
  ConflictError,
  ValidationError,
} from '../middleware/errorHandler.js';

const patternsRouter = Router();

// All pattern routes require authentication
patternsRouter.use(requireAuth);

// Valid action types for customization
const VALID_ACTION_TYPES = ['delete', 'move', 'archive', 'markRead', 'flag', 'categorize'] as const;

// Upper bound on a single bulk-approve request — keeps one click from queuing
// an unbounded number of Graph-backed rule creations.
const BULK_APPROVE_MAX = 500;

/**
 * GET /api/patterns
 *
 * Returns paginated patterns for the authenticated user.
 * Query params: mailboxId (optional), status (optional, comma-separated), page, limit
 */
patternsRouter.get('/', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { mailboxId, status, hasRule, search } = req.query;

  // Pagination
  const { page, limit } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });

  // Build filter using $and to safely combine multiple $or clauses
  const filterClauses: Record<string, unknown>[] = [{ userId }];
  if (mailboxId && typeof mailboxId === 'string') {
    filterClauses.push({ mailboxId });
  }
  if (status && typeof status === 'string') {
    const statuses = status.split(',').map((s) => s.trim()).filter(Boolean);
    if (statuses.length === 1) {
      filterClauses.push({ status: statuses[0] });
    } else if (statuses.length > 1) {
      filterClauses.push({ status: { $in: statuses } });
    }
  }

  // Search filter: case-insensitive match on sender email, domain, or subject pattern
  if (search && typeof search === 'string' && search.trim()) {
    const searchRegex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filterClauses.push({
      $or: [
        { 'condition.senderEmail': searchRegex },
        { 'condition.senderDomain': searchRegex },
        { 'condition.subjectPattern': searchRegex },
      ],
    });
  }

  // If hasRule filter is specified, pre-lookup rules by sourcePatternId OR sender email/domain
  // so pagination reflects the correct filtered total. Rules created via quick actions (Ban/Delete,
  // MarkRead) don't have sourcePatternId but match on conditions.senderEmail/senderDomain.
  if (hasRule === 'true' || hasRule === 'false') {
    const ruleQuery: Record<string, unknown> = { userId };
    if (mailboxId && typeof mailboxId === 'string') ruleQuery.mailboxId = mailboxId;
    const rulesAll = await Rule.find(ruleQuery)
      .select('sourcePatternId conditions.senderEmail conditions.senderDomain')
      .lean();

    const rulePatternIds = rulesAll.map((r) => r.sourcePatternId?.toString()).filter(Boolean) as string[];
    const ruleSenderEmails = rulesAll
      .flatMap((r) =>
        Array.isArray(r.conditions?.senderEmail)
          ? r.conditions.senderEmail
          : r.conditions?.senderEmail
            ? [r.conditions.senderEmail]
            : [],
      )
      .filter(Boolean) as string[];
    const ruleSenderDomains = rulesAll
      .map((r) => r.conditions?.senderDomain)
      .filter(Boolean) as string[];

    const matchClauses: Record<string, unknown>[] = [];
    if (rulePatternIds.length) matchClauses.push({ _id: { $in: rulePatternIds.map((id) => new Types.ObjectId(id)) } });
    if (ruleSenderEmails.length) matchClauses.push({ 'condition.senderEmail': { $in: ruleSenderEmails } });
    if (ruleSenderDomains.length) matchClauses.push({ 'condition.senderDomain': { $in: ruleSenderDomains } });

    if (hasRule === 'true') {
      filterClauses.push(matchClauses.length ? { $or: matchClauses } : { _id: { $in: [] } });
    } else {
      if (matchClauses.length) filterClauses.push({ $nor: matchClauses });
    }
  }

  const filter = filterClauses.length === 1 ? filterClauses[0] : { $and: filterClauses };

  // Parallel query + count
  const [patterns, total] = await Promise.all([
    Pattern.find(filter)
      .sort({ confidence: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Pattern.countDocuments(filter),
  ]);

  // Enrich patterns with hasRule — match by sourcePatternId OR sender email/domain
  const patternIds = patterns.map((p) => p._id);
  const patternSenderEmails = patterns.map((p) => p.condition?.senderEmail).filter(Boolean) as string[];
  const patternSenderDomains = patterns.map((p) => p.condition?.senderDomain).filter(Boolean) as string[];

  const enrichOrClauses: Record<string, unknown>[] = [{ sourcePatternId: { $in: patternIds } }];
  if (patternSenderEmails.length) enrichOrClauses.push({ 'conditions.senderEmail': { $in: patternSenderEmails } });
  if (patternSenderDomains.length) enrichOrClauses.push({ 'conditions.senderDomain': { $in: patternSenderDomains } });

  const rulesForPatterns = await Rule.find({ userId, $or: enrichOrClauses })
    .select('_id sourcePatternId conditions.senderEmail conditions.senderDomain')
    .lean();

  // Build lookup maps: patternId/email/domain → first matching ruleId
  const ruleByPatternId = new Map<string, string>();
  const ruleBySenderEmail = new Map<string, string>();
  const ruleBySenderDomain = new Map<string, string>();

  for (const r of rulesForPatterns) {
    const rid = r._id.toString();
    if (r.sourcePatternId) {
      const pid = r.sourcePatternId.toString();
      if (!ruleByPatternId.has(pid)) ruleByPatternId.set(pid, rid);
    }
    const emails = Array.isArray(r.conditions?.senderEmail)
      ? r.conditions.senderEmail
      : r.conditions?.senderEmail ? [r.conditions.senderEmail] : [];
    for (const e of emails) {
      const key = e.toLowerCase();
      if (!ruleBySenderEmail.has(key)) ruleBySenderEmail.set(key, rid);
    }
    if (r.conditions?.senderDomain) {
      const key = r.conditions.senderDomain.toLowerCase();
      if (!ruleBySenderDomain.has(key)) ruleBySenderDomain.set(key, rid);
    }
  }

  const enrichedPatterns = patterns.map((p) => {
    const pid = p._id.toString();
    const emailKey = p.condition?.senderEmail?.toLowerCase();
    const domainKey = p.condition?.senderDomain?.toLowerCase();
    const ruleId =
      ruleByPatternId.get(pid) ??
      (emailKey ? ruleBySenderEmail.get(emailKey) : undefined) ??
      (domainKey ? ruleBySenderDomain.get(domainKey) : undefined);
    return { ...p, hasRule: !!ruleId, ruleId: ruleId ?? null };
  });

  res.json({
    patterns: enrichedPatterns,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/**
 * POST /api/patterns/analyze
 *
 * Trigger on-demand pattern analysis for the current user.
 * Optional body: { mailboxId } for single-mailbox analysis.
 *
 * NOTE: This route MUST be defined before /:id routes to avoid
 * 'analyze' being captured as an :id parameter.
 */
patternsRouter.post('/analyze', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { mailboxId } = req.body as { mailboxId?: string };

  const job = await queues['pattern-analysis'].add('on-demand-analysis', {
    userId,
    mailboxId,
  });

  res.json({
    message: 'Pattern analysis queued',
    jobId: job.id,
  });
});

/**
 * GET /api/patterns/suggest
 *
 * Typeahead suggestions for the patterns search box. Returns distinct sender
 * emails and domains matching the query, aggregated in the database.
 * Query params: q (required, >= 1 char), mailboxId (optional), limit (default 10, max 25)
 */
patternsRouter.get('/suggest', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { q, mailboxId } = req.query;

  if (!q || typeof q !== 'string' || !q.trim()) {
    res.json({ suggestions: [] });
    return;
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 25);
  const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const searchRegex = new RegExp(escaped, 'i');

  const match: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
  if (mailboxId && typeof mailboxId === 'string') {
    match.mailboxId = new Types.ObjectId(mailboxId);
  }
  match.$or = [
    { 'condition.senderEmail': searchRegex },
    { 'condition.senderDomain': searchRegex },
  ];

  // Aggregate distinct sender values in the DB — never fetch-then-dedupe in app code.
  const rows = await Pattern.aggregate<{ _id: { value: string; type: string }; count: number }>([
    { $match: match },
    {
      $project: {
        values: {
          $filter: {
            input: [
              { value: '$condition.senderEmail', type: 'email' },
              { value: '$condition.senderDomain', type: 'domain' },
            ],
            as: 'v',
            cond: {
              $and: [
                { $ne: ['$$v.value', null] },
                { $ne: ['$$v.value', ''] },
                { $regexMatch: { input: { $ifNull: ['$$v.value', ''] }, regex: searchRegex } },
              ],
            },
          },
        },
      },
    },
    { $unwind: '$values' },
    { $group: { _id: { value: '$values.value', type: '$values.type' }, count: { $sum: 1 } } },
    { $sort: { count: -1, '_id.value': 1 } },
    { $limit: limit },
  ]);

  res.json({
    suggestions: rows.map((r) => ({
      value: r._id.value,
      type: r._id.type as 'email' | 'domain',
      count: r.count,
    })),
  });
});

/**
 * POST /api/patterns/bulk-approve
 *
 * Approve many patterns at once with a single chosen action, converting each
 * to a rule. Body: { patternIds: string[], actionType: 'delete' | 'markRead' }
 *
 * Never runs implicitly — the frontend only calls this on an explicit click,
 * preserving the "no rule without user approval" contract.
 */
patternsRouter.post('/bulk-approve', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { patternIds, actionType } = req.body as {
    patternIds?: unknown;
    actionType?: unknown;
  };

  if (!Array.isArray(patternIds) || patternIds.length === 0) {
    throw new ValidationError('patternIds must be a non-empty array');
  }
  if (patternIds.length > BULK_APPROVE_MAX) {
    throw new ValidationError(`Cannot process more than ${BULK_APPROVE_MAX} patterns in one request`);
  }
  if (!patternIds.every((id): id is string => typeof id === 'string' && Types.ObjectId.isValid(id))) {
    throw new ValidationError('patternIds must all be valid pattern ids');
  }
  if (actionType !== 'delete' && actionType !== 'markRead') {
    throw new ValidationError("actionType must be 'delete' or 'markRead'");
  }

  const uniqueIds = [...new Set(patternIds)];
  const patterns = await Pattern.find({ _id: { $in: uniqueIds }, userId });
  const found = new Set(patterns.map((p) => p._id.toString()));

  const results: Array<{
    patternId: string;
    status: 'created' | 'skipped' | 'failed';
    ruleId?: string;
    reason?: string;
  }> = uniqueIds
    .filter((id) => !found.has(id))
    .map((id) => ({ patternId: id, status: 'skipped' as const, reason: 'Pattern not found' }));

  for (const pattern of patterns) {
    const patternId = pattern._id.toString();

    if (pattern.status !== 'detected' && pattern.status !== 'suggested') {
      results.push({ patternId, status: 'skipped', reason: `Pattern is already ${pattern.status}` });
      continue;
    }

    try {
      const originalAction = {
        actionType: pattern.suggestedAction.actionType,
        toFolder: pattern.suggestedAction.toFolder,
        category: pattern.suggestedAction.category,
      };

      // Bulk actions are always terminal (delete / markRead) — no folder or category carries over.
      pattern.suggestedAction = { actionType };
      pattern.status = 'approved';
      pattern.approvedAt = new Date();
      await pattern.save();

      await AuditLog.create({
        userId,
        mailboxId: pattern.mailboxId,
        action: 'pattern_approved',
        targetType: 'pattern',
        targetId: patternId,
        details: {
          patternType: pattern.patternType,
          confidence: pattern.confidence,
          condition: pattern.condition,
          suggestedAction: pattern.suggestedAction,
          bulk: true,
          originalAction,
        },
      });

      const rule = await convertPatternToRule(pattern._id, new Types.ObjectId(userId));
      results.push({ patternId, status: 'created', ruleId: rule._id?.toString() });
    } catch (err) {
      // One bad pattern must not abort the batch — record it and keep going.
      logger.warn('Bulk pattern approval failed for one pattern', {
        patternId,
        error: err instanceof Error ? err.message : String(err),
      });
      results.push({
        patternId,
        status: 'failed',
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const created = results.filter((r) => r.status === 'created').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  logger.info('Bulk pattern approval complete', { userId, actionType, created, skipped, failed });

  res.json({ created, skipped, failed, total: uniqueIds.length, results });
});

/**
 * POST /api/patterns/bulk-suppress
 *
 * Permanently silence the senders behind the given patterns: add each one to
 * its mailbox's whitelist and mark the pattern rejected, so pattern analysis
 * never suggests a rule for that sender again.
 *
 * Body: { patternIds: string[], scope?: 'sender' | 'domain' }
 *   scope 'sender' (default) whitelists the exact address;
 *   scope 'domain' whitelists the whole sending domain.
 *
 * Non-destructive: existing rules are left untouched. They become inert on
 * their own because ruleEngine already refuses to act on whitelisted senders,
 * so nothing the user built is deleted behind their back.
 */
patternsRouter.post('/bulk-suppress', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { patternIds, scope = 'sender' } = req.body as {
    patternIds?: unknown;
    scope?: unknown;
  };

  if (!Array.isArray(patternIds) || patternIds.length === 0) {
    throw new ValidationError('patternIds must be a non-empty array');
  }
  if (patternIds.length > BULK_APPROVE_MAX) {
    throw new ValidationError(`Cannot process more than ${BULK_APPROVE_MAX} patterns in one request`);
  }
  if (!patternIds.every((id): id is string => typeof id === 'string' && Types.ObjectId.isValid(id))) {
    throw new ValidationError('patternIds must all be valid pattern ids');
  }
  if (scope !== 'sender' && scope !== 'domain') {
    throw new ValidationError("scope must be 'sender' or 'domain'");
  }

  const uniqueIds = [...new Set(patternIds)];
  const patterns = await Pattern.find({ _id: { $in: uniqueIds }, userId });

  // Group the values to whitelist by mailbox so each mailbox is written once,
  // rather than once per pattern.
  const byMailbox = new Map<string, { senders: Set<string>; domains: Set<string> }>();
  const suppressedValues: string[] = [];
  const skipped: Array<{ patternId: string; reason: string }> = [];

  for (const pattern of patterns) {
    const email = pattern.condition?.senderEmail?.trim();
    const domain = pattern.condition?.senderDomain?.trim();
    const value = scope === 'domain' ? (domain ?? email?.split('@')[1]) : (email ?? domain);

    if (!value) {
      skipped.push({ patternId: pattern._id.toString(), reason: 'Pattern has no sender to suppress' });
      continue;
    }

    const key = pattern.mailboxId.toString();
    if (!byMailbox.has(key)) byMailbox.set(key, { senders: new Set(), domains: new Set() });
    const bucket = byMailbox.get(key)!;
    // A value is a domain entry when we're in domain scope or it isn't an address.
    if (scope === 'domain' || !value.includes('@')) bucket.domains.add(value.toLowerCase());
    else bucket.senders.add(value.toLowerCase());
    suppressedValues.push(value.toLowerCase());
  }

  // Apply the whitelist additions — $addToSet keeps this idempotent.
  let mailboxesUpdated = 0;
  for (const [mailboxId, { senders, domains }] of byMailbox) {
    const addToSet: Record<string, unknown> = {};
    if (senders.size) addToSet['settings.whitelistedSenders'] = { $each: [...senders] };
    if (domains.size) addToSet['settings.whitelistedDomains'] = { $each: [...domains] };
    if (!Object.keys(addToSet).length) continue;

    const result = await Mailbox.updateOne({ _id: mailboxId, userId }, { $addToSet: addToSet });
    if (result.matchedCount > 0) mailboxesUpdated++;

    await AuditLog.create({
      userId,
      mailboxId,
      action: 'whitelist_updated',
      targetType: 'mailbox',
      targetId: mailboxId,
      details: {
        source: 'pattern_bulk_suppress',
        addedSenders: [...senders],
        addedDomains: [...domains],
      },
    });
  }

  // Mark the patterns rejected so they leave the suggestion queue immediately.
  // The whitelist — not this status — is what keeps them from coming back.
  const rejectableIds = patterns
    .filter((p) => p.status === 'detected' || p.status === 'suggested')
    .map((p) => p._id);

  const updateResult = await Pattern.updateMany(
    { _id: { $in: rejectableIds }, userId },
    {
      $set: {
        status: 'rejected',
        rejectedAt: new Date(),
        // Far-future: suppression is permanent, and the whitelist is the real gate.
        rejectionCooldownUntil: new Date('9999-12-31T00:00:00.000Z'),
      },
    },
  );

  logger.info('Bulk pattern suppression complete', {
    userId,
    scope,
    suppressed: suppressedValues.length,
    mailboxesUpdated,
    patternsRejected: updateResult.modifiedCount,
  });

  res.json({
    suppressed: suppressedValues.length,
    values: [...new Set(suppressedValues)],
    patternsRejected: updateResult.modifiedCount,
    mailboxesUpdated,
    skipped,
  });
});

/**
 * GET /api/patterns/:id/messages
 *
 * Fetch the 5 most recent messages matching this pattern's sender from Graph API.
 * Returns message list (id, subject, from, receivedDateTime, bodyPreview).
 */
patternsRouter.get('/:id/messages', async (req: Request, res: Response) => {
  const userId = getUserId(req);

  const pattern = await Pattern.findOne({ _id: req.params.id, userId });
  if (!pattern) {
    throw new NotFoundError('Pattern not found');
  }

  const mailbox = await Mailbox.findById(pattern.mailboxId).select('email');
  if (!mailbox) {
    throw new NotFoundError('Mailbox not found');
  }

  const senderEmail = pattern.condition.senderEmail;
  if (!senderEmail) {
    res.json({ messages: [] });
    return;
  }

  const accessToken = await getAccessTokenForMailbox(pattern.mailboxId.toString());

  const filter = `from/emailAddress/address eq '${senderEmail.replace(/'/g, "''")}'`;
  const select = 'id,subject,from,receivedDateTime,bodyPreview';
  const userPath = `/users/${encodeURIComponent(mailbox.email)}`;

  // Fetch from all messages first (inbox, sent, etc.)
  const graphPath = `${userPath}/messages?$filter=${encodeURIComponent(filter)}&$top=5&$select=${select}`;
  const response = await graphFetch(graphPath, accessToken);
  const data = await response.json() as { value: Array<{ receivedDateTime?: string; [k: string]: unknown }> };
  let messages = data.value ?? [];

  // If fewer than 5 results, also search Deleted Items for the rest
  if (messages.length < 5) {
    try {
      const remaining = 5 - messages.length;
      const deletedPath = `${userPath}/mailFolders/DeletedItems/messages?$filter=${encodeURIComponent(filter)}&$top=${remaining}&$select=${select}`;
      const deletedResponse = await graphFetch(deletedPath, accessToken);
      const deletedData = await deletedResponse.json() as { value: Array<{ receivedDateTime?: string; [k: string]: unknown }> };
      if (deletedData.value?.length) {
        // Mark deleted messages so frontend can indicate source
        messages = messages.concat(
          deletedData.value.map((m) => ({ ...m, _fromDeletedItems: true })),
        );
      }
    } catch (err) {
      logger.warn('Failed to fetch from Deleted Items', {
        patternId: req.params.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  messages.sort((a, b) =>
    new Date(b.receivedDateTime ?? 0).getTime() - new Date(a.receivedDateTime ?? 0).getTime(),
  );

  res.json({ messages });
});

/**
 * GET /api/patterns/:id/messages/:messageId
 *
 * Fetch a single message with full body for preview.
 */
patternsRouter.get('/:id/messages/:messageId', async (req: Request, res: Response) => {
  const userId = getUserId(req);

  const pattern = await Pattern.findOne({ _id: req.params.id, userId });
  if (!pattern) {
    throw new NotFoundError('Pattern not found');
  }

  const mailbox = await Mailbox.findById(pattern.mailboxId).select('email');
  if (!mailbox) {
    throw new NotFoundError('Mailbox not found');
  }

  const accessToken = await getAccessTokenForMailbox(pattern.mailboxId.toString());

  const select = 'id,subject,from,toRecipients,receivedDateTime,body,bodyPreview';
  const messageId = req.params.messageId as string;
  const userPath = `/users/${encodeURIComponent(mailbox.email)}`;
  const msgPath = `${userPath}/messages/${encodeURIComponent(messageId)}?$select=${select}`;

  let message: unknown;
  try {
    const response = await graphFetch(msgPath, accessToken);
    message = await response.json();
  } catch {
    // Message may be in Deleted Items — try there
    const deletedMsgPath = `${userPath}/mailFolders/DeletedItems/messages/${encodeURIComponent(messageId)}?$select=${select}`;
    const response = await graphFetch(deletedMsgPath, accessToken);
    message = await response.json();
  }

  res.json({ message });
});

/**
 * POST /api/patterns/:id/approve
 *
 * Approve a detected/suggested pattern.
 */
patternsRouter.post('/:id/approve', async (req: Request, res: Response) => {
  const userId = getUserId(req);

  const pattern = await Pattern.findOne({ _id: req.params.id, userId });
  if (!pattern) {
    throw new NotFoundError('Pattern not found');
  }

  if (pattern.status !== 'detected' && pattern.status !== 'suggested') {
    throw new ConflictError(`Pattern is already ${pattern.status}`);
  }

  pattern.status = 'approved';
  pattern.approvedAt = new Date();
  await pattern.save();

  await AuditLog.create({
    userId,
    mailboxId: pattern.mailboxId,
    action: 'pattern_approved',
    targetType: 'pattern',
    targetId: pattern._id.toString(),
    details: {
      patternType: pattern.patternType,
      confidence: pattern.confidence,
      condition: pattern.condition,
      suggestedAction: pattern.suggestedAction,
    },
  });

  // Auto-convert approved pattern to rule (ROADMAP success criterion 1)
  // Rule creation failure should not fail the approve response
  try {
    await convertPatternToRule(pattern._id, new Types.ObjectId(userId));
  } catch (err) {
    logger.warn('Auto-conversion of pattern to rule failed', {
      patternId: pattern._id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  res.json({ pattern });
});

/**
 * POST /api/patterns/:id/reject
 *
 * Reject a detected/suggested pattern with 30-day cooldown.
 */
patternsRouter.post('/:id/reject', async (req: Request, res: Response) => {
  const userId = getUserId(req);

  const pattern = await Pattern.findOne({ _id: req.params.id, userId });
  if (!pattern) {
    throw new NotFoundError('Pattern not found');
  }

  if (pattern.status !== 'detected' && pattern.status !== 'suggested') {
    throw new ConflictError(`Pattern is already ${pattern.status}`);
  }

  // Delete any rules associated with this pattern (by sourcePatternId or sender email/domain)
  const ruleDeleteClauses: Record<string, unknown>[] = [
    { sourcePatternId: pattern._id },
  ];
  if (pattern.condition?.senderEmail) {
    ruleDeleteClauses.push({ 'conditions.senderEmail': pattern.condition.senderEmail });
  }
  if (pattern.condition?.senderDomain) {
    ruleDeleteClauses.push({ 'conditions.senderDomain': pattern.condition.senderDomain });
  }
  const deleteResult = await Rule.deleteMany({ userId, $or: ruleDeleteClauses });
  if (deleteResult.deletedCount > 0) {
    logger.info('Deleted rules on pattern rejection', {
      patternId: pattern._id,
      deletedCount: deleteResult.deletedCount,
      userId,
    });
  }

  // Fetch user's pattern settings for cooldown duration
  const user = await User.findById(userId).select('patternSettings').lean();
  const cooldownDays = user?.patternSettings?.rejectionCooldownDays ?? 30;

  pattern.status = 'rejected';
  pattern.rejectedAt = new Date();
  pattern.rejectionCooldownUntil = new Date(Date.now() + cooldownDays * 24 * 60 * 60 * 1000);
  await pattern.save();

  await AuditLog.create({
    userId,
    mailboxId: pattern.mailboxId,
    action: 'pattern_rejected',
    targetType: 'pattern',
    targetId: pattern._id.toString(),
    details: {
      patternType: pattern.patternType,
      confidence: pattern.confidence,
      condition: pattern.condition,
      suggestedAction: pattern.suggestedAction,
      rulesDeleted: deleteResult.deletedCount,
    },
  });

  res.json({ pattern });
});

/**
 * POST /api/patterns/:id/customize
 *
 * Customize a pattern's suggested action and approve it.
 */
patternsRouter.post('/:id/customize', async (req: Request, res: Response) => {
  const userId = getUserId(req);

  const pattern = await Pattern.findOne({ _id: req.params.id, userId });
  if (!pattern) {
    throw new NotFoundError('Pattern not found');
  }

  if (pattern.status !== 'detected' && pattern.status !== 'suggested') {
    throw new ConflictError(`Pattern is already ${pattern.status}`);
  }

  const { suggestedAction } = req.body as {
    suggestedAction?: { actionType?: string; toFolder?: string; category?: string };
  };

  if (!suggestedAction?.actionType) {
    throw new ValidationError('suggestedAction.actionType is required');
  }

  if (!VALID_ACTION_TYPES.includes(suggestedAction.actionType as typeof VALID_ACTION_TYPES[number])) {
    throw new ValidationError(
      `Invalid actionType. Must be one of: ${VALID_ACTION_TYPES.join(', ')}`,
    );
  }

  // Save original action for audit trail
  const originalAction = {
    actionType: pattern.suggestedAction.actionType,
    toFolder: pattern.suggestedAction.toFolder,
    category: pattern.suggestedAction.category,
  };

  // Update suggested action
  pattern.suggestedAction = {
    actionType: suggestedAction.actionType as typeof VALID_ACTION_TYPES[number],
    ...(suggestedAction.toFolder ? { toFolder: suggestedAction.toFolder } : {}),
    ...(suggestedAction.category ? { category: suggestedAction.category } : {}),
  };

  pattern.status = 'approved';
  pattern.approvedAt = new Date();
  await pattern.save();

  await AuditLog.create({
    userId,
    mailboxId: pattern.mailboxId,
    action: 'pattern_approved',
    targetType: 'pattern',
    targetId: pattern._id.toString(),
    details: {
      patternType: pattern.patternType,
      confidence: pattern.confidence,
      condition: pattern.condition,
      suggestedAction: pattern.suggestedAction,
      customized: true,
      originalAction,
    },
  });

  // Auto-convert approved pattern to rule (ROADMAP success criterion 1)
  // Rule creation failure should not fail the approve response
  try {
    await convertPatternToRule(pattern._id, new Types.ObjectId(userId));
  } catch (err) {
    logger.warn('Auto-conversion of customized pattern to rule failed', {
      patternId: pattern._id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  res.json({ pattern });
});

export { patternsRouter };
