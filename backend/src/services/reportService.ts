import { AuditLog } from '../models/AuditLog.js';
import { Mailbox, type IMailbox } from '../models/Mailbox.js';

export interface MailboxCounts {
  email: string;
  deleted: number;
  movedAndRead: number;
  movedOnly: number;
  markedRead: number;
}

export interface ActivityReport {
  mailboxes: MailboxCounts[];
  totals: MailboxCounts;
}

/**
 * Categorize a rule_executed audit entry based on its details.actions array.
 * Actions are strings like: 'delete (direct)', 'delete (staged)', 'move to <folderId>', 'markRead', etc.
 */
export function categorizeActions(actions: string[]): 'deleted' | 'movedAndRead' | 'movedOnly' | 'markedRead' | 'other' {
  const hasDelete = actions.some((a) => a.startsWith('delete'));
  const hasMove = actions.some((a) => a.startsWith('move to') || a === 'archive');
  const hasMarkRead = actions.includes('markRead');

  if (hasDelete) return 'deleted';
  if (hasMove && hasMarkRead) return 'movedAndRead';
  if (hasMove) return 'movedOnly';
  if (hasMarkRead) return 'markedRead';
  return 'other';
}

/**
 * Query audit logs for rule_executed actions within a date range and
 * produce per-mailbox and total counts.
 *
 * @param mailboxes - Pre-fetched connected mailboxes to report on
 * @param start - Period start (UTC)
 * @param end - Period end (UTC)
 */
export async function getActivityCounts(
  mailboxes: IMailbox[],
  start: Date,
  end: Date,
): Promise<ActivityReport> {
  const mailboxIdToEmail = new Map<string, string>();
  for (const mb of mailboxes) {
    mailboxIdToEmail.set(mb._id!.toString(), mb.email);
  }

  const auditLogs = await AuditLog.find({
    action: 'rule_executed',
    mailboxId: { $in: mailboxes.map((m) => m._id) },
    createdAt: { $gte: start, $lte: end },
  }).lean();

  // Initialize counts per mailbox
  const countsMap = new Map<string, MailboxCounts>();
  for (const mb of mailboxes) {
    countsMap.set(mb.email, {
      email: mb.email,
      deleted: 0,
      movedAndRead: 0,
      movedOnly: 0,
      markedRead: 0,
    });
  }

  // Tally
  for (const log of auditLogs) {
    const email = mailboxIdToEmail.get(log.mailboxId?.toString() ?? '');
    if (!email) continue;
    const counts = countsMap.get(email);
    if (!counts) continue;

    const actions = (log.details?.actions as string[]) ?? [];
    const category = categorizeActions(actions);

    switch (category) {
      case 'deleted': counts.deleted++; break;
      case 'movedAndRead': counts.movedAndRead++; break;
      case 'movedOnly': counts.movedOnly++; break;
      case 'markedRead': counts.markedRead++; break;
    }
  }

  const mailboxCounts = Array.from(countsMap.values());
  const totals: MailboxCounts = {
    email: 'TOTAL',
    deleted: mailboxCounts.reduce((s, c) => s + c.deleted, 0),
    movedAndRead: mailboxCounts.reduce((s, c) => s + c.movedAndRead, 0),
    movedOnly: mailboxCounts.reduce((s, c) => s + c.movedOnly, 0),
    markedRead: mailboxCounts.reduce((s, c) => s + c.markedRead, 0),
  };

  return { mailboxes: mailboxCounts, totals };
}

/**
 * Find connected mailboxes by email addresses.
 */
export async function findMailboxesByEmails(emails: string[]): Promise<IMailbox[]> {
  return Mailbox.find({ email: { $in: emails }, isConnected: true });
}

/**
 * Find connected mailboxes for a specific user.
 */
export async function findMailboxesByUser(userId: string): Promise<IMailbox[]> {
  return Mailbox.find({ userId, isConnected: true });
}
