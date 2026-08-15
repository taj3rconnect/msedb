import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { getUserId } from '../../auth/middleware.js';
import { EmailEvent } from '../../models/EmailEvent.js';
import { Mailbox } from '../../models/Mailbox.js';
import { getRedisClient } from '../../config/redis.js';
import { graphFetch } from '../../services/graphClient.js';
import { getAccessTokenForMailbox } from '../../auth/tokenManager.js';
import { AppError, ValidationError } from '../../middleware/errorHandler.js';
import { generateOllamaCompletion } from '../../services/ollamaClient.js';
import { config } from '../../config/index.js';

const summarizeRouter = Router();

/**
 * POST /api/events/summarize-today
 *
 * Uses AI to summarize today's emails, grouped by importance.
 * Body: { mailboxId?: string }
 */
summarizeRouter.post('/summarize-today', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { mailboxId } = req.body;

  // Query today's arrived events
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const filter: Record<string, unknown> = {
    userId,
    eventType: 'arrived',
    receivedAt: { $gte: startOfDay, $lte: endOfDay },
  };
  if (mailboxId && typeof mailboxId === 'string') {
    filter.mailboxId = mailboxId;
  }

  // Filter to inbox folder only (same logic as GET /events with folder=inbox)
  const mailboxesToResolve = mailboxId && typeof mailboxId === 'string'
    ? await Mailbox.find({ _id: mailboxId }).select('email').lean()
    : await Mailbox.find({ userId, isConnected: true }).select('email').lean();

  const redis = getRedisClient();
  const inboxFolderValues: string[] = ['Inbox'];
  for (const mb of mailboxesToResolve) {
    if (mb.email) {
      const cachedFolderId = await redis.get(`folder:${mb.email}:wk:Inbox`);
      if (cachedFolderId) inboxFolderValues.push(cachedFolderId);
    }
  }
  filter.toFolder = { $in: inboxFolderValues };

  // Exclude deleted emails
  filter.isDeleted = { $ne: true };

  // Build aggregation-safe filter with proper ObjectId casting
  const aggFilterBase: Record<string, unknown> = {
    userId: new Types.ObjectId(userId),
    eventType: 'arrived',
    receivedAt: { $gte: startOfDay, $lte: endOfDay },
    toFolder: { $in: inboxFolderValues },
  };
  if (mailboxId && typeof mailboxId === 'string') {
    aggFilterBase.mailboxId = new Types.ObjectId(mailboxId);
  }

  const aggFilterExclDeleted = { ...aggFilterBase, isDeleted: { $ne: true } };

  // Count today's inbox arrivals (including deleted) and read/unread for non-deleted
  const [events, readUnreadCounts, todayTotalCount] = await Promise.all([
    EmailEvent.find(filter)
      .sort({ receivedAt: -1 })
      .limit(200)
      .select('sender subject importance isRead categories metadata.isNewsletter hasAttachments receivedAt')
      .lean(),
    EmailEvent.aggregate([
      { $match: aggFilterExclDeleted },
      { $group: { _id: '$isRead', count: { $sum: 1 } } },
    ]),
    // Total arrived in inbox today (including deleted) — to compute deleted count
    EmailEvent.countDocuments({
      userId,
      eventType: 'arrived',
      receivedAt: { $gte: startOfDay, $lte: endOfDay },
      toFolder: { $in: inboxFolderValues },
      ...(mailboxId && typeof mailboxId === 'string' ? { mailboxId } : {}),
    }),
  ]);

  // Compute accurate read/unread stats from aggregation
  let readCount = 0;
  let unreadCount = 0;
  for (const bucket of readUnreadCounts) {
    if (bucket._id === true) readCount = bucket.count;
    else unreadCount = bucket.count;
  }
  const activeCount = readCount + unreadCount;
  const deletedCount = todayTotalCount - activeCount;
  const stats = { total: activeCount, read: readCount, unread: unreadCount, deleted: deletedCount };

  if (events.length === 0) {
    res.json({ summary: '<p style="color:#888">No emails received today.</p>', stats });
    return;
  }

  // Build text list for the LLM
  const emailList = events.map((e, i) => {
    const sender = e.sender?.name
      ? `${e.sender.name} <${e.sender.email}>`
      : (e.sender?.email || 'Unknown');
    const subject = e.subject || '(no subject)';
    const importance = e.importance || 'normal';
    const isNewsletter = (e as any).metadata?.isNewsletter ? 'yes' : 'no';
    const isRead = e.isRead ? 'read' : 'unread';
    const attachments = e.hasAttachments ? 'has attachments' : '';
    const categories = e.categories?.length ? `categories: ${e.categories.join(', ')}` : '';
    const time = new Date(e.receivedAt ?? e.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    return `${i + 1}. [${time}] From: ${sender} | Subject: ${subject} | Importance: ${importance} | Newsletter: ${isNewsletter} | ${isRead} ${attachments} ${categories}`.trim();
  }).join('\n');

  const truncatedNote = activeCount > events.length
    ? `\n\nNote: Showing ${events.length} of ${activeCount} total emails received today.`
    : '';

  const prompt = `You are an email assistant. Summarize the following ${events.length} emails received today (${activeCount} total). Group them into these categories (use ALL that apply, skip empty categories):

1. **Needs Your Response** — emails that clearly require a reply or action (meetings to accept, questions asked, approvals needed)
2. **Important Updates** — significant emails that don't need a reply but should be read (announcements, reports, notifications from people)
3. **FYI / Updates** — informational emails, automated notifications, status updates
4. **Newsletters & Low Priority** — marketing, newsletters, bulk emails, promotions

Rules:
- Maximum 1 line per email, be very brief
- For "Needs Your Response" items, wrap each line in <span style="color:#ef4444;font-weight:600">...</span>
- Use HTML formatting. Each category as <h3> with a count. Each email as a <div> with sender name bolded.
- At the top, add a brief 1-sentence overall summary (e.g. "23 emails today — 3 need your attention")
- Do NOT use markdown, only HTML
- If an email is unread, prefix with a blue dot: <span style="color:#3b82f6">●</span>

Here are today's emails:
${emailList}${truncatedNote}`;

  try {
    const summary = await generateOllamaCompletion(prompt, {
      model: config.ollamaWriteModel,
      temperature: 0.3,
      numPredict: 2048,
    });

    res.json({ summary: summary.trim() || '<p>Failed to generate summary.</p>', stats });
  } catch (err: any) {
    console.error('Ollama summary error:', err.message);
    throw new AppError(`AI summary failed: ${err.message}`, 500);
  }
});

/**
 * GET /api/events/summarize-today/csv
 *
 * Downloads today's emails as a CSV file.
 * Query: ?mailboxId (optional)
 */
summarizeRouter.get('/summarize-today/csv', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { mailboxId } = req.query;

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const filter: Record<string, unknown> = {
    userId,
    eventType: 'arrived',
    receivedAt: { $gte: startOfDay, $lte: endOfDay },
  };
  if (mailboxId && typeof mailboxId === 'string') {
    filter.mailboxId = mailboxId;
  }

  // Filter to inbox folder only
  const csvMailboxes = mailboxId && typeof mailboxId === 'string'
    ? await Mailbox.find({ _id: mailboxId }).select('email').lean()
    : await Mailbox.find({ userId, isConnected: true }).select('email').lean();
  const csvRedis = getRedisClient();
  const csvInboxFolders: string[] = ['Inbox'];
  for (const mb of csvMailboxes) {
    if (mb.email) {
      const fid = await csvRedis.get(`folder:${mb.email}:wk:Inbox`);
      if (fid) csvInboxFolders.push(fid);
    }
  }
  filter.toFolder = { $in: csvInboxFolders };

  // Exclude deleted emails
  filter.isDeleted = { $ne: true };

  const events = await EmailEvent.find(filter)
    .sort({ receivedAt: -1 })
    .limit(500)
    .select('sender subject importance isRead hasAttachments categories receivedAt timestamp')
    .lean();

  // Build CSV
  const escapeCsv = (val: string) => {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };

  const header = 'Time,From Name,From Email,Subject,Importance,Read,Has Attachments,Categories';
  const rows = events.map((e) => {
    const time = new Date(e.receivedAt ?? e.timestamp).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
    return [
      escapeCsv(time),
      escapeCsv(e.sender?.name || ''),
      escapeCsv(e.sender?.email || ''),
      escapeCsv(e.subject || ''),
      escapeCsv(e.importance || 'normal'),
      e.isRead ? 'Yes' : 'No',
      e.hasAttachments ? 'Yes' : 'No',
      escapeCsv(e.categories?.join('; ') || ''),
    ].join(',');
  });

  const csv = [header, ...rows].join('\n');
  const dateStr = now.toISOString().slice(0, 10);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="email-summary-${dateStr}.csv"`);
  res.send(csv);
});

/**
 * POST /api/events/summarize-today/send
 *
 * Sends the summary as an email via Graph API sendMail.
 * Body: { to: string, summary: string }
 */
summarizeRouter.post('/summarize-today/send', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { to, summary } = req.body;

  if (!to || !summary) {
    throw new ValidationError('Missing "to" or "summary" in request body');
  }

  // Find the first connected mailbox to send from
  const mailbox = await Mailbox.findOne({ userId, isConnected: true }).lean();
  if (!mailbox) {
    throw new ValidationError('No connected mailbox to send from');
  }

  try {
    const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const sendMailBody = {
      message: {
        subject: `Daily Email Summary — ${today}`,
        body: {
          contentType: 'HTML',
          content: summary,
        },
        toRecipients: to.split(/[,;]+/).map((email: string) => ({
          emailAddress: { address: email.trim() },
        })),
      },
      saveToSentItems: false,
    };

    await graphFetch(
      `/users/${mailbox.email}/sendMail`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify(sendMailBody),
      },
    );

    res.json({ success: true });
  } catch (err: any) {
    console.error('Send summary email error:', err.message);
    throw new AppError(`Failed to send email: ${err.message}`, 500);
  }
});

export default summarizeRouter;
