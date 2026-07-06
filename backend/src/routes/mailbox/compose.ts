import { Router, type Request, type Response } from 'express';
import { Mailbox } from '../../models/Mailbox.js';
import { getAccessTokenForMailbox } from '../../auth/tokenManager.js';
import { graphFetch } from '../../services/graphClient.js';
import logger from '../../config/logger.js';
import { NotFoundError, ValidationError } from '../../middleware/errorHandler.js';
import { createTrackedEmail } from '../../services/trackingService.js';

const composeRouter = Router();

/**
 * Inject tracking pixel HTML into an email body.
 * Inserts before </body> if present, otherwise appends.
 */
function injectTrackingPixel(html: string, pixelHtml: string): string {
  const bodyCloseIdx = html.lastIndexOf('</body>');
  if (bodyCloseIdx !== -1) {
    return html.slice(0, bodyCloseIdx) + pixelHtml + html.slice(bodyCloseIdx);
  }
  return html + pixelHtml;
}

/**
 * Prepend user's reply text into a Graph-generated draft HTML body.
 * Uses multiple fallback strategies to ensure the text is always inserted.
 */
function prependReplyHtml(draftBodyContent: string, replyText: string): string {
  const replyHtml = `<div style="font-family:Calibri,Arial,Helvetica,sans-serif;font-size:11pt;color:#000000">${replyText.replace(/\n/g, '<br>')}</div><br>`;

  // Strategy 1: Insert after the appendonsend marker (Graph's standard insertion point)
  const appendOnSend = draftBodyContent.match(/<div\s+id\s*=\s*["']appendonsend["'][^>]*>[\s\S]*?<\/div>/i);
  if (appendOnSend) {
    const insertPos = appendOnSend.index! + appendOnSend[0].length;
    return draftBodyContent.slice(0, insertPos) + replyHtml + draftBodyContent.slice(insertPos);
  }

  // Strategy 2: Insert right after the opening <body> tag
  const bodyTag = draftBodyContent.match(/<body[^>]*>/i);
  if (bodyTag) {
    const insertPos = bodyTag.index! + bodyTag[0].length;
    return draftBodyContent.slice(0, insertPos) + replyHtml + draftBodyContent.slice(insertPos);
  }

  // Strategy 3: Prepend to whatever content exists
  return replyHtml + draftBodyContent;
}

// ---- Reply & Forward ----

/**
 * POST /api/mailboxes/:id/reply
 *
 * Two-step reply: createReply draft (with proper HTML + quoted original) → send.
 * Produces Outlook-identical formatting that passes spam filters.
 * Body: { messageId, body, contentType? }
 */
composeRouter.post('/:id/reply', async (req: Request, res: Response) => {
  const { messageId, body, cc, bcc, track = true } = req.body as {
    messageId?: string;
    body?: string;
    cc?: string[];
    bcc?: string[];
    track?: boolean;
  };

  if (!messageId) throw new ValidationError('messageId is required');
  if (!body || !body.trim()) throw new ValidationError('body is required');

  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: req.user!.userId,
  });
  if (!mailbox) throw new NotFoundError('Mailbox not found');

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());

  // Step 1: Create draft reply — empty body gives us the quoted original
  const createRes = await graphFetch(
    `/users/${mailbox.email}/messages/${messageId}/createReply`,
    accessToken,
    { method: 'POST', body: JSON.stringify({}) },
  );
  const draft = (await createRes.json()) as { id: string; body: { content: string; contentType: string } };

  // Step 2: Prepend user's reply as Outlook-formatted HTML into the draft body
  let updatedContent = prependReplyHtml(draft.body.content, body.trim());

  // Inject tracking pixel (only if tracking is enabled)
  if (track) {
    const replyDraft = (await graphFetch(
      `/users/${mailbox.email}/messages/${draft.id}?$select=subject,toRecipients`,
      accessToken,
    ).then((r) => r.json())) as { subject?: string; toRecipients?: { emailAddress: { address?: string } }[] };

    const { pixelHtml: replyPixel } = await createTrackedEmail({
      userId: req.user!.userId,
      mailboxId: req.params.id as string,
      subject: replyDraft.subject,
      recipients: replyDraft.toRecipients?.map((r) => r.emailAddress.address || '').filter(Boolean) || [],
    });
    updatedContent = injectTrackingPixel(updatedContent, replyPixel);
  }

  const replyPatch: Record<string, unknown> = {
    body: { contentType: 'HTML', content: updatedContent },
    importance: 'normal',
  };
  if (cc?.length) replyPatch.ccRecipients = cc.map((e) => ({ emailAddress: { address: e } }));
  if (bcc?.length) replyPatch.bccRecipients = bcc.map((e) => ({ emailAddress: { address: e } }));

  await graphFetch(
    `/users/${mailbox.email}/messages/${draft.id}`,
    accessToken,
    { method: 'PATCH', body: JSON.stringify(replyPatch) },
  );

  // Step 3: Send the draft
  await graphFetch(
    `/users/${mailbox.email}/messages/${draft.id}/send`,
    accessToken,
    { method: 'POST' },
  );

  logger.info('Reply sent (tracked)', {
    mailboxId: req.params.id,
    messageId,
    userId: req.user!.userId,
  });

  res.json({ success: true });
});

/**
 * POST /api/mailboxes/:id/reply-all
 *
 * Two-step reply-all: createReplyAll draft → send.
 * Body: { messageId, body, contentType? }
 */
composeRouter.post('/:id/reply-all', async (req: Request, res: Response) => {
  const { messageId, body, cc, bcc, track = true } = req.body as {
    messageId?: string;
    body?: string;
    cc?: string[];
    bcc?: string[];
    track?: boolean;
  };

  if (!messageId) throw new ValidationError('messageId is required');
  if (!body || !body.trim()) throw new ValidationError('body is required');

  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: req.user!.userId,
  });
  if (!mailbox) throw new NotFoundError('Mailbox not found');

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());

  // Step 1: Create draft reply-all
  const createRes = await graphFetch(
    `/users/${mailbox.email}/messages/${messageId}/createReplyAll`,
    accessToken,
    { method: 'POST', body: JSON.stringify({}) },
  );
  const draft = (await createRes.json()) as { id: string; body: { content: string; contentType: string } };

  // Step 2: Prepend user's reply as Outlook-formatted HTML
  let updatedContentAll = prependReplyHtml(draft.body.content, body.trim());

  // Inject tracking pixel (only if tracking is enabled)
  if (track) {
    const replyAllDraft = (await graphFetch(
      `/users/${mailbox.email}/messages/${draft.id}?$select=subject,toRecipients,ccRecipients`,
      accessToken,
    ).then((r) => r.json())) as { subject?: string; toRecipients?: { emailAddress: { address?: string } }[]; ccRecipients?: { emailAddress: { address?: string } }[] };

    const allRecips = [
      ...(replyAllDraft.toRecipients || []),
      ...(replyAllDraft.ccRecipients || []),
    ].map((r) => r.emailAddress.address || '').filter(Boolean);

    const { pixelHtml: replyAllPixel } = await createTrackedEmail({
      userId: req.user!.userId,
      mailboxId: req.params.id as string,
      subject: replyAllDraft.subject,
      recipients: allRecips,
    });
    updatedContentAll = injectTrackingPixel(updatedContentAll, replyAllPixel);
  }

  const replyAllPatch: Record<string, unknown> = {
    body: { contentType: 'HTML', content: updatedContentAll },
    importance: 'normal',
  };
  if (cc?.length) replyAllPatch.ccRecipients = cc.map((e) => ({ emailAddress: { address: e } }));
  if (bcc?.length) replyAllPatch.bccRecipients = bcc.map((e) => ({ emailAddress: { address: e } }));

  await graphFetch(
    `/users/${mailbox.email}/messages/${draft.id}`,
    accessToken,
    { method: 'PATCH', body: JSON.stringify(replyAllPatch) },
  );

  // Step 3: Send
  await graphFetch(
    `/users/${mailbox.email}/messages/${draft.id}/send`,
    accessToken,
    { method: 'POST' },
  );

  logger.info('Reply-all sent (tracked)', {
    mailboxId: req.params.id,
    messageId,
    userId: req.user!.userId,
  });

  res.json({ success: true });
});

/**
 * POST /api/mailboxes/:id/forward
 *
 * Two-step forward: createForward draft → set recipients → send.
 * Body: { messageId, toRecipients: [{email, name?}], body, contentType? }
 */
composeRouter.post('/:id/forward', async (req: Request, res: Response) => {
  const { messageId, toRecipients, body } = req.body as {
    messageId?: string;
    toRecipients?: { email: string; name?: string }[];
    body?: string;
  };

  if (!messageId) throw new ValidationError('messageId is required');
  if (!toRecipients || !Array.isArray(toRecipients) || toRecipients.length === 0) {
    throw new ValidationError('toRecipients is required and must be a non-empty array');
  }
  if (!body || !body.trim()) throw new ValidationError('body is required');

  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: req.user!.userId,
  });
  if (!mailbox) throw new NotFoundError('Mailbox not found');

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());

  // Step 1: Create draft forward
  const createRes = await graphFetch(
    `/users/${mailbox.email}/messages/${messageId}/createForward`,
    accessToken,
    { method: 'POST', body: JSON.stringify({}) },
  );
  const draft = (await createRes.json()) as { id: string; subject?: string; body: { content: string; contentType: string } };

  // Step 2: Set recipients and prepend user's comment
  let fwdContent = prependReplyHtml(draft.body.content, body.trim());

  // Inject tracking pixel
  const { pixelHtml: fwdPixel } = await createTrackedEmail({
    userId: req.user!.userId,
    mailboxId: req.params.id as string,
    subject: draft.subject,
    recipients: toRecipients.map((r) => r.email),
  });
  fwdContent = injectTrackingPixel(fwdContent, fwdPixel);

  await graphFetch(
    `/users/${mailbox.email}/messages/${draft.id}`,
    accessToken,
    {
      method: 'PATCH',
      body: JSON.stringify({
        toRecipients: toRecipients.map((r) => ({
          emailAddress: { address: r.email, name: r.name || r.email },
        })),
        body: { contentType: 'HTML', content: fwdContent },
        importance: 'normal',
      }),
    },
  );

  // Step 3: Send
  await graphFetch(
    `/users/${mailbox.email}/messages/${draft.id}/send`,
    accessToken,
    { method: 'POST' },
  );

  logger.info('Message forwarded (tracked)', {
    mailboxId: req.params.id,
    messageId,
    toRecipients: toRecipients.map((r) => r.email),
    userId: req.user!.userId,
  });

  res.json({ success: true });
});

// ---- Send new email ----

/**
 * POST /api/mailboxes/:id/send-email
 *
 * Compose and send a new email via Graph API sendMail.
 * Body: { to: string[], cc?: string[], bcc?: string[], subject: string, body: string, contentType?: 'Text' | 'HTML' }
 */
composeRouter.post('/:id/send-email', async (req: Request, res: Response) => {
  const { to, cc, bcc, subject, body, contentType, track } = req.body as {
    to?: string[];
    cc?: string[];
    bcc?: string[];
    subject?: string;
    body?: string;
    contentType?: 'Text' | 'HTML';
    track?: boolean;
  };

  if (!to || !Array.isArray(to) || to.length === 0) {
    throw new ValidationError('to is required and must be a non-empty array');
  }
  if (!subject) throw new ValidationError('subject is required');
  if (!body) throw new ValidationError('body is required');

  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: req.user!.userId,
  });
  if (!mailbox) throw new NotFoundError('Mailbox not found');

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());

  const mapRecipients = (addrs: string[]) =>
    addrs.map((address) => ({ emailAddress: { address } }));

  // Step 1: Create draft message
  const draftMsg: Record<string, unknown> = {
    subject,
    body: { contentType: contentType || 'Text', content: body },
    toRecipients: mapRecipients(to),
  };
  if (cc && cc.length > 0) draftMsg.ccRecipients = mapRecipients(cc);
  if (bcc && bcc.length > 0) draftMsg.bccRecipients = mapRecipients(bcc);

  const draftRes = await graphFetch(
    `/users/${mailbox.email}/messages`,
    accessToken,
    { method: 'POST', body: JSON.stringify(draftMsg) },
  );
  const draft = (await draftRes.json()) as { id: string; body: { content: string; contentType: string } };

  // Step 2: Optionally inject tracking pixel
  let htmlContent = draft.body.content;
  if (draft.body.contentType === 'Text' || (!contentType || contentType === 'Text')) {
    // Wrap plain text in basic HTML
    htmlContent = `<html><body><pre>${htmlContent}</pre></body></html>`;
  }
  if (track !== false) {
    const { pixelHtml } = await createTrackedEmail({
      userId: req.user!.userId,
      mailboxId: req.params.id as string,
      subject,
      recipients: [...to, ...(cc || []), ...(bcc || [])],
    });
    htmlContent = injectTrackingPixel(htmlContent, pixelHtml);
  }

  await graphFetch(
    `/users/${mailbox.email}/messages/${draft.id}`,
    accessToken,
    {
      method: 'PATCH',
      body: JSON.stringify({
        body: { contentType: 'HTML', content: htmlContent },
      }),
    },
  );

  // Step 3: Send the draft
  await graphFetch(
    `/users/${mailbox.email}/messages/${draft.id}/send`,
    accessToken,
    { method: 'POST' },
  );

  logger.info('New email sent (tracked)', {
    mailboxId: req.params.id,
    from: mailbox.email,
    to,
    subject,
    userId: req.user!.userId,
  });

  res.json({ success: true });
});

export default composeRouter;
