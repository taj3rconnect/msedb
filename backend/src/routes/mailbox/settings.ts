import { Router, type Request, type Response } from 'express';
import { getUserId } from '../../auth/middleware.js';
import { Mailbox } from '../../models/Mailbox.js';
import { getAccessTokenForMailbox } from '../../auth/tokenManager.js';
import { graphFetch } from '../../services/graphClient.js';
import { NotFoundError, ValidationError } from '../../middleware/errorHandler.js';

const settingsRouter = Router();

// ---- Signatures ----

/**
 * GET /api/mailboxes/:id/signatures
 * Returns the signature list for a mailbox.
 */
settingsRouter.get('/:id/signatures', async (req: Request, res: Response) => {
  const mailbox = await Mailbox.findOne({ _id: req.params.id, userId: getUserId(req) });
  if (!mailbox) throw new NotFoundError('Mailbox not found');
  res.json({ signatures: mailbox.settings.signatures ?? [] });
});

/**
 * PUT /api/mailboxes/:id/signatures
 * Replaces the full signature list for a mailbox.
 * Body: { signatures: [{ id, name, content, isDefault }] }
 */
settingsRouter.put('/:id/signatures', async (req: Request, res: Response) => {
  const mailbox = await Mailbox.findOne({ _id: req.params.id, userId: getUserId(req) });
  if (!mailbox) throw new NotFoundError('Mailbox not found');

  const { signatures } = req.body as { signatures: { id: string; name: string; content: string; isDefault: boolean }[] };
  if (!Array.isArray(signatures)) throw new ValidationError('signatures must be an array');

  // Enforce at most one default
  let defaultCount = 0;
  const cleaned = signatures.map((s) => {
    if (s.isDefault) defaultCount++;
    return { id: s.id, name: String(s.name).slice(0, 100), content: String(s.content).slice(0, 20000), isDefault: !!s.isDefault };
  });
  if (defaultCount > 1) throw new ValidationError('Only one signature can be set as default');

  mailbox.settings.signatures = cleaned as typeof mailbox.settings.signatures;
  await mailbox.save();
  res.json({ signatures: mailbox.settings.signatures });
});

// ---- Out-of-Office ----

/**
 * GET /api/mailboxes/:id/oof
 * Fetches automaticRepliesSetting from Graph.
 */
settingsRouter.get('/:id/oof', async (req: Request, res: Response) => {
  const mailbox = await Mailbox.findOne({ _id: req.params.id, userId: getUserId(req) });
  if (!mailbox) throw new NotFoundError('Mailbox not found');

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
  const response = await graphFetch(
    `/users/${mailbox.email}/mailboxSettings?$select=automaticRepliesSetting`,
    accessToken,
  );
  const data = (await response.json()) as { automaticRepliesSetting?: unknown };
  res.json({ oof: data.automaticRepliesSetting ?? null });
});

/**
 * PUT /api/mailboxes/:id/oof
 * Updates automaticRepliesSetting via Graph.
 * Body: { status, internalReplyMessage, externalReplyMessage, externalAudience?, scheduledStartDateTime?, scheduledEndDateTime? }
 */
settingsRouter.put('/:id/oof', async (req: Request, res: Response) => {
  const mailbox = await Mailbox.findOne({ _id: req.params.id, userId: getUserId(req) });
  if (!mailbox) throw new NotFoundError('Mailbox not found');

  const { status, internalReplyMessage, externalReplyMessage, externalAudience, scheduledStartDateTime, scheduledEndDateTime } = req.body;
  if (!['Disabled', 'AlwaysEnabled', 'Scheduled'].includes(status)) {
    throw new ValidationError('status must be Disabled, AlwaysEnabled, or Scheduled');
  }

  const setting: Record<string, unknown> = {
    status,
    internalReplyMessage: internalReplyMessage ?? '',
    externalReplyMessage: externalReplyMessage ?? '',
    externalAudience: externalAudience ?? 'all',
  };
  if (status === 'Scheduled' && scheduledStartDateTime && scheduledEndDateTime) {
    setting.scheduledStartDateTime = scheduledStartDateTime;
    setting.scheduledEndDateTime = scheduledEndDateTime;
  }

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
  await graphFetch(`/users/${mailbox.email}/mailboxSettings`, accessToken, {
    method: 'PATCH',
    body: JSON.stringify({ automaticRepliesSetting: setting }),
  });

  res.json({ oof: setting });
});

// ---- Categories ----

/**
 * GET /api/mailboxes/:id/categories
 * Fetches Outlook master categories from Graph.
 */
settingsRouter.get('/:id/categories', async (req: Request, res: Response) => {
  const mailbox = await Mailbox.findOne({ _id: req.params.id, userId: getUserId(req) });
  if (!mailbox) throw new NotFoundError('Mailbox not found');

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
  const response = await graphFetch(`/users/${mailbox.email}/outlook/masterCategories`, accessToken);
  const data = (await response.json()) as { value?: unknown[] };
  res.json({ categories: data.value ?? [] });
});

/**
 * POST /api/mailboxes/:id/categories
 * Creates an Outlook master category.
 * Body: { displayName, color }
 */
settingsRouter.post('/:id/categories', async (req: Request, res: Response) => {
  const mailbox = await Mailbox.findOne({ _id: req.params.id, userId: getUserId(req) });
  if (!mailbox) throw new NotFoundError('Mailbox not found');

  const { displayName, color } = req.body as { displayName: string; color: string };
  if (!displayName) throw new ValidationError('displayName is required');

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
  const response = await graphFetch(`/users/${mailbox.email}/outlook/masterCategories`, accessToken, {
    method: 'POST',
    body: JSON.stringify({ displayName, color: color ?? 'preset0' }),
  });
  const created = await response.json();
  res.status(201).json({ category: created });
});

/**
 * DELETE /api/mailboxes/:id/categories/:categoryId
 * Deletes an Outlook master category.
 */
settingsRouter.delete('/:id/categories/:categoryId', async (req: Request, res: Response) => {
  const mailbox = await Mailbox.findOne({ _id: req.params.id, userId: getUserId(req) });
  if (!mailbox) throw new NotFoundError('Mailbox not found');

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
  await graphFetch(`/users/${mailbox.email}/outlook/masterCategories/${req.params.categoryId}`, accessToken, {
    method: 'DELETE',
  });
  res.json({ success: true });
});

export default settingsRouter;
