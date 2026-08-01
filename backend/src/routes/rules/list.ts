import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { getUserId } from '../../auth/middleware.js';
import { Rule } from '../../models/Rule.js';
import { parsePagination } from '../../utils/pagination.js';

const listRouter = Router();

/**
 * GET /api/rules
 *
 * List rules for the current user with optional mailbox filter.
 * Query params: mailboxId (optional), page (default 1), limit (default 50, max 100)
 */
listRouter.get('/', async (req: Request, res: Response) => {
  const userId = getUserId(req);

  // Pagination
  const { page, limit } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 100 });

  // Build filter
  const filter: Record<string, unknown> = { userId };
  const { mailboxId, search, sort } = req.query;
  if (mailboxId && typeof mailboxId === 'string') {
    filter.mailboxId = mailboxId;
  }
  if (search && typeof search === 'string' && search.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = { $regex: escaped, $options: 'i' };
    filter.$or = [
      { name: regex },
      { 'conditions.senderEmail': regex },
      { 'conditions.senderDomain': regex },
      { 'conditions.subjectContains': regex },
      { 'conditions.bodyContains': regex },
    ];
  }

  // For email/domain sorts, use aggregation to extract and sort by computed field
  let rules: unknown[];
  let total: number;

  if (sort === 'email' || sort === 'domain') {
    const aggFilter: Record<string, unknown> = { ...filter, userId: new Types.ObjectId(userId) };
    if (mailboxId && typeof mailboxId === 'string') {
      aggFilter.mailboxId = new Types.ObjectId(mailboxId);
    }
    // Extract first email if array, fall back to empty string
    const emailExpr = {
      $toLower: {
        $cond: [
          { $isArray: '$conditions.senderEmail' },
          { $ifNull: [{ $arrayElemAt: ['$conditions.senderEmail', 0] }, ''] },
          { $ifNull: ['$conditions.senderEmail', ''] },
        ],
      },
    };
    const sortKey = sort === 'domain'
      ? { $toLower: { $ifNull: ['$conditions.senderDomain', { $arrayElemAt: [{ $split: [emailExpr, '@'] }, 1] }] } }
      : emailExpr;

    [rules, total] = await Promise.all([
      Rule.aggregate([
        { $match: aggFilter },
        { $addFields: { _sortKey: sortKey } },
        { $sort: { _sortKey: 1, createdAt: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
        { $project: { _sortKey: 0 } },
      ]),
      Rule.countDocuments(filter),
    ]);
  } else {
    [rules, total] = await Promise.all([
      Rule.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Rule.countDocuments(filter),
    ]);
  }

  res.json({
    rules,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

export default listRouter;
