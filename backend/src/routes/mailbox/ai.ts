import { Router, type Request, type Response } from 'express';
import { Mailbox } from '../../models/Mailbox.js';
import { getAccessTokenForMailbox } from '../../auth/tokenManager.js';
import { graphFetch } from '../../services/graphClient.js';
import { streamOllamaTokens } from '../../services/ollamaClient.js';
import { config } from '../../config/index.js';
import { NotFoundError, ValidationError } from '../../middleware/errorHandler.js';

const aiRouter = Router();

// ---- AI Write ----

const AI_WRITE_PROMPTS: Record<string, (body: string, subject: string) => string> = {
  'check-grammar': (body) =>
    `Fix any typos, spelling mistakes, and grammar errors in the following email text. Keep the meaning, tone, and structure exactly the same. Only correct errors — do not rephrase or change the writing style. Return ONLY the corrected text, nothing else, no explanations.\n\nEmail text:\n${body}`,
  'write': (body, subject) =>
    `You are an email writing assistant. Write a professional, concise email based on the brief below. Output exactly two parts separated by a blank line:\nLine 1: SUBJECT: <your suggested subject line>\nRest: the email body starting with a greeting.\n\nDo not include any other labels, headers, or commentary. Example format:\nSUBJECT: Meeting Follow-up\n\nHi John,\n\nJust following up on our meeting...\n\nBrief: ${body || 'write a polite professional email'}${subject ? `\nContext subject hint: ${subject}` : ''}`,
  'rewrite': (body) =>
    `Rewrite the following email to be clearer, more professional, and better structured. Keep the same meaning and intent. Return ONLY the rewritten email body text, nothing else.\n\nOriginal:\n${body}`,
};

/**
 * POST /api/mailboxes/:id/ai-write
 * Streams LLM-generated text using Qwen for grammar check, write, or rewrite.
 * Body: { action: 'check-grammar' | 'write' | 'rewrite', body: string, subject?: string }
 */
aiRouter.post('/:id/ai-write', async (req: Request, res: Response) => {
  const mailbox = await Mailbox.findOne({ _id: req.params.id, userId: req.user!.userId });
  if (!mailbox) throw new NotFoundError('Mailbox not found');

  const { action, body = '', subject = '' } = req.body as { action: string; body: string; subject: string };
  const promptFn = AI_WRITE_PROMPTS[action];
  if (!promptFn) throw new ValidationError('action must be check-grammar, write, or rewrite');

  const prompt = promptFn(body, subject);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  await streamOllamaTokens(res, prompt, {
    model: config.ollamaWriteModel,
    temperature: 0.3,
    numPredict: 1500,
    errorLogMessage: 'AI write stream error',
  });
});

// ---- Auto Respond ----

/**
 * POST /api/mailboxes/:id/messages/:messageId/auto-respond
 * Fetches thread + sent tone samples, streams a short crisp reply via Qwen.
 */
aiRouter.post('/:id/messages/:messageId/auto-respond', async (req: Request, res: Response) => {
  const mailbox = await Mailbox.findOne({ _id: req.params.id, userId: req.user!.userId });
  if (!mailbox) throw new NotFoundError('Mailbox not found');

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());

  // 1. Fetch current message (need conversationId + body)
  const msgRes = await graphFetch(
    `/users/${mailbox.email}/messages/${req.params.messageId}?$select=id,subject,bodyPreview,body,from,toRecipients,conversationId,receivedDateTime`,
    accessToken,
  );
  const msg = (await msgRes.json()) as { subject?: string; bodyPreview?: string; body?: { content: string; contentType: string }; from?: { emailAddress: { address?: string; name?: string } }; conversationId?: string };

  // 2. Fetch last 6 messages in the conversation thread
  let threadContext = '';
  if (msg.conversationId) {
    try {
      const threadRes = await graphFetch(
        `/users/${mailbox.email}/messages?$filter=conversationId eq '${msg.conversationId}'&$top=6&$orderby=receivedDateTime asc&$select=from,bodyPreview,receivedDateTime`,
        accessToken,
      );
      const threadData = (await threadRes.json()) as { value?: { from?: { emailAddress?: { address?: string; name?: string } }; bodyPreview?: string; receivedDateTime?: string }[] };
      if (threadData.value?.length) {
        threadContext = threadData.value.map((m) =>
          `[${m.from?.emailAddress?.name || m.from?.emailAddress?.address || 'Unknown'}]: ${m.bodyPreview?.slice(0, 300) || ''}`
        ).join('\n---\n');
      }
    } catch { /* non-fatal */ }
  }

  // 3. Fetch last 4 sent emails for tone sampling
  let toneSamples = '';
  try {
    const sentRes = await graphFetch(
      `/users/${mailbox.email}/mailFolders/SentItems/messages?$top=4&$select=bodyPreview`,
      accessToken,
    );
    const sentData = (await sentRes.json()) as { value?: { bodyPreview?: string }[] };
    if (sentData.value?.length) {
      toneSamples = sentData.value.map((m) => m.bodyPreview?.slice(0, 200) || '').filter(Boolean).join('\n---\n');
    }
  } catch { /* non-fatal */ }

  // Strip plain text from HTML body if needed
  const emailBody = msg.body?.contentType === 'html'
    ? msg.body.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800)
    : (msg.body?.content || msg.bodyPreview || '').slice(0, 800);

  const prompt = `You are composing an email reply on behalf of the user. The user's communication style is: very short, crisp, straight to the point, concise — no fluff, no filler words, no unnecessary pleasantries.

${toneSamples ? `Examples of the user's writing style (sent emails):\n${toneSamples}\n\n` : ''}Email thread context:\n${threadContext || '(no thread)'}\n\nLatest email to respond to:\nFrom: ${msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || 'Unknown'}\nSubject: ${msg.subject || ''}\n${emailBody}\n\nWrite a reply in the user's style: short, crisp, straight to the point. Start directly — no "I hope this email finds you well" or similar fluff. Return ONLY the reply body text.`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  await streamOllamaTokens(res, prompt, {
    model: config.ollamaWriteModel,
    temperature: 0.3,
    numPredict: 600,
    errorLogMessage: 'Auto-respond stream error',
  });
});

export default aiRouter;
