import type { Job } from 'bullmq';
import { getAccessTokenForMailbox } from '../../auth/tokenManager.js';
import { graphFetch } from '../../services/graphClient.js';
import { getActivityCounts, findMailboxesByEmails, type MailboxCounts } from '../../services/reportService.js';
import logger from '../../config/logger.js';

const TARGET_EMAILS = [
  'taj@aptask.com',
  'taj@jobtalk.ai',
  'taj@yenaom.ai',
];

const SEND_FROM = 'taj@aptask.com';
const SEND_TO = 'taj@jobtalk.ai';

/**
 * BullMQ processor: Daily Activity Report
 *
 * Runs at 9 AM EST. Queries audit logs for rule_executed actions in the
 * last 24 hours across three mailboxes, builds an HTML report, and sends
 * it via Graph API.
 */
export async function processDailyReport(job: Job): Promise<void> {
  logger.info('Daily report processor started', { jobId: job.id });

  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const mailboxes = await findMailboxesByEmails(TARGET_EMAILS);
  if (mailboxes.length === 0) {
    logger.warn('No connected mailboxes found for daily report');
    return;
  }

  const { mailboxes: mailboxCounts, totals } = await getActivityCounts(mailboxes, twentyFourHoursAgo, now);

  // Ensure consistent ordering: TARGET_EMAILS order
  const orderedCounts = TARGET_EMAILS
    .map((email) => mailboxCounts.find((c) => c.email === email))
    .filter((c): c is MailboxCounts => c !== undefined);

  // Format dates for the report header
  const formatDate = (d: Date) =>
    d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', year: '2-digit' });
  const formatTime = (d: Date) =>
    d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: true });

  const reportDate = formatDate(now);
  const periodStart = `${formatDate(twentyFourHoursAgo)} ${formatTime(twentyFourHoursAgo)}`;
  const periodEnd = `${formatDate(now)} ${formatTime(now)}`;

  const html = buildReportHtml(orderedCounts, totals, reportDate, periodStart, periodEnd);

  // Find the sending mailbox (taj@aptask.com)
  const sendMailbox = mailboxes.find((m) => m.email === SEND_FROM);
  if (!sendMailbox) {
    logger.error('Sending mailbox not found', { email: SEND_FROM });
    return;
  }

  try {
    const accessToken = await getAccessTokenForMailbox(sendMailbox._id!.toString());

    await graphFetch(
      `/users/${encodeURIComponent(SEND_FROM)}/sendMail`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          message: {
            subject: `MSEDB Daily Report — ${reportDate}`,
            body: { contentType: 'HTML', content: html },
            toRecipients: [{ emailAddress: { address: SEND_TO } }],
          },
          saveToSentItems: 'true',
        }),
      },
    );

    logger.info('Daily report email sent', {
      to: SEND_TO,
      from: SEND_FROM,
      totalEntries: orderedCounts.reduce((s, c) => s + c.deleted + c.movedAndRead + c.movedOnly + c.markedRead, 0),
    });
  } catch (error) {
    logger.error('Failed to send daily report email', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error; // Let BullMQ retry
  }
}

function buildReportHtml(
  mailboxCounts: MailboxCounts[],
  totals: MailboxCounts,
  reportDate: string,
  periodStart: string,
  periodEnd: string,
): string {
  const row = (c: MailboxCounts, isTotalRow = false) => {
    const style = isTotalRow
      ? 'font-weight:bold; background:#f0f4ff;'
      : '';
    const total = c.deleted + c.movedAndRead + c.movedOnly + c.markedRead;
    return `
      <tr style="${style}">
        <td style="padding:8px 12px; border:1px solid #ddd;">${c.email}</td>
        <td style="padding:8px 12px; border:1px solid #ddd; text-align:center;">${c.deleted}</td>
        <td style="padding:8px 12px; border:1px solid #ddd; text-align:center;">${c.movedAndRead}</td>
        <td style="padding:8px 12px; border:1px solid #ddd; text-align:center;">${c.movedOnly}</td>
        <td style="padding:8px 12px; border:1px solid #ddd; text-align:center;">${c.markedRead}</td>
        <td style="padding:8px 12px; border:1px solid #ddd; text-align:center; font-weight:bold;">${total}</td>
      </tr>`;
  };

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #333; max-width: 700px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #1a237e, #283593); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
    <h1 style="margin:0; font-size:22px;">MSEDB Daily Activity Report</h1>
    <p style="margin:8px 0 0; opacity:0.9; font-size:14px;">${reportDate} &mdash; Last 24 Hours</p>
  </div>

  <div style="background: #fafafa; padding: 16px 24px; border-left: 1px solid #ddd; border-right: 1px solid #ddd;">
    <p style="margin:0; font-size:13px; color:#666;">
      Period: <strong>${periodStart}</strong> &rarr; <strong>${periodEnd}</strong> (EST)
    </p>
  </div>

  <div style="padding: 0; border: 1px solid #ddd; border-top: none; border-radius: 0 0 8px 8px; overflow: hidden;">
    <table style="width:100%; border-collapse:collapse; font-size:14px;">
      <thead>
        <tr style="background:#e8eaf6;">
          <th style="padding:10px 12px; border:1px solid #ddd; text-align:left;">Mailbox</th>
          <th style="padding:10px 12px; border:1px solid #ddd; text-align:center;">Deleted</th>
          <th style="padding:10px 12px; border:1px solid #ddd; text-align:center;">Moved &amp; Read</th>
          <th style="padding:10px 12px; border:1px solid #ddd; text-align:center;">Moved Only</th>
          <th style="padding:10px 12px; border:1px solid #ddd; text-align:center;">Mark Read</th>
          <th style="padding:10px 12px; border:1px solid #ddd; text-align:center;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${mailboxCounts.map((c) => row(c)).join('')}
        ${row(totals, true)}
      </tbody>
    </table>
  </div>

  <p style="margin:20px 0 0; font-size:12px; color:#999; text-align:center;">
    Automated report from MSEDB &mdash; Microsoft Email Dashboard
  </p>
</body>
</html>`;
}
