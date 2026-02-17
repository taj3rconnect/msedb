import type { Types } from 'mongoose';
import { graphFetch } from './graphClient.js';
import { StagedEmail, type IStagedEmail } from '../models/StagedEmail.js';
import { AuditLog } from '../models/AuditLog.js';
import { getIO } from '../config/socket.js';
import logger from '../config/logger.js';
import { NotFoundError } from '../middleware/errorHandler.js';

/**
 * Module-level cache of staging folder IDs keyed by mailbox email.
 * Avoids repeated Graph API lookups for the same mailbox.
 */
const stagingFolderCache = new Map<string, string>();

/** Grace period buffer: 7 days after expiresAt for TTL cleanup */
const CLEANUP_BUFFER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Ensure the 'MSEDB Staging' mail folder exists for the given mailbox.
 * Creates it via Graph API if not found. Caches folder ID in memory.
 *
 * @param mailboxEmail - The email address of the mailbox
 * @param accessToken - OAuth2 Bearer token
 * @returns The Graph API folder ID
 */
export async function ensureStagingFolder(
  mailboxEmail: string,
  accessToken: string,
): Promise<string> {
  // Check cache first
  const cached = stagingFolderCache.get(mailboxEmail);
  if (cached) {
    return cached;
  }

  // Check if folder already exists via Graph API
  const listResponse = await graphFetch(
    `/users/${encodeURIComponent(mailboxEmail)}/mailFolders?$filter=displayName eq 'MSEDB Staging'&$select=id,displayName`,
    accessToken,
  );
  const listData = (await listResponse.json()) as {
    value: Array<{ id: string; displayName: string }>;
  };

  if (listData.value.length > 0) {
    const folderId = listData.value[0].id;
    stagingFolderCache.set(mailboxEmail, folderId);
    return folderId;
  }

  // Create the staging folder
  const createResponse = await graphFetch(
    `/users/${encodeURIComponent(mailboxEmail)}/mailFolders`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ displayName: 'MSEDB Staging' }),
    },
  );
  const createData = (await createResponse.json()) as { id: string };

  stagingFolderCache.set(mailboxEmail, createData.id);
  logger.info('Created MSEDB Staging folder', {
    mailboxEmail,
    folderId: createData.id,
  });

  return createData.id;
}

/**
 * Create a staged email record with audit trail and real-time notification.
 *
 * Sets expiresAt to 24 hours from now, cleanupAt to 7 days after expiresAt.
 * Emits Socket.IO event `staging:new` to the user's room.
 */
export async function createStagedEmail(params: {
  userId: Types.ObjectId;
  mailboxId: Types.ObjectId;
  ruleId: Types.ObjectId;
  messageId: string;
  originalFolder: string;
  actions: Array<{ actionType: string; toFolder?: string }>;
}): Promise<IStagedEmail> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
  const cleanupAt = new Date(expiresAt.getTime() + CLEANUP_BUFFER_MS); // expiresAt + 7 days

  const stagedEmail = await StagedEmail.create({
    userId: params.userId,
    mailboxId: params.mailboxId,
    ruleId: params.ruleId,
    messageId: params.messageId,
    originalFolder: params.originalFolder,
    stagedAt: now,
    expiresAt,
    cleanupAt,
    status: 'staged',
    actions: params.actions,
  });

  // Audit trail
  await AuditLog.create({
    userId: params.userId,
    mailboxId: params.mailboxId,
    action: 'email_staged',
    targetType: 'email',
    targetId: params.messageId,
    details: {
      ruleId: params.ruleId.toString(),
      actions: params.actions,
      expiresAt,
    },
    undoable: true,
  });

  // Real-time notification
  try {
    const io = getIO();
    io.to(`user:${params.userId.toString()}`).emit('staging:new', {
      id: stagedEmail._id.toString(),
      messageId: params.messageId,
      ruleId: params.ruleId.toString(),
      stagedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      actions: params.actions,
    });
  } catch {
    // Socket.IO may not be initialized in worker processes -- non-fatal
    logger.debug('Socket.IO not available for staging notification');
  }

  return stagedEmail;
}

/**
 * Rescue a single staged email (cancel pending deletion).
 * Only works for emails with status 'staged'.
 *
 * @throws NotFoundError if staged email not found or already processed
 */
export async function rescueStagedEmail(
  stagedEmailId: string,
  userId: Types.ObjectId,
): Promise<IStagedEmail> {
  const stagedEmail = await StagedEmail.findOneAndUpdate(
    { _id: stagedEmailId, userId, status: 'staged' },
    { status: 'rescued', rescuedAt: new Date() },
    { new: true },
  );

  if (!stagedEmail) {
    throw new NotFoundError('Staged email not found or already processed');
  }

  // Audit trail
  await AuditLog.create({
    userId,
    mailboxId: stagedEmail.mailboxId,
    action: 'email_rescued',
    targetType: 'email',
    targetId: stagedEmail.messageId,
    details: {
      stagedEmailId: stagedEmail._id.toString(),
      ruleId: stagedEmail.ruleId.toString(),
    },
    undoable: false,
  });

  return stagedEmail;
}

/**
 * Batch rescue multiple staged emails.
 *
 * @returns Number of emails rescued
 */
export async function batchRescueStagedEmails(
  ids: string[],
  userId: Types.ObjectId,
): Promise<number> {
  const result = await StagedEmail.updateMany(
    { _id: { $in: ids }, userId, status: 'staged' },
    { status: 'rescued', rescuedAt: new Date() },
  );

  const modifiedCount = result.modifiedCount;

  if (modifiedCount > 0) {
    // Create audit entries for each rescued email
    const rescuedEmails = await StagedEmail.find({
      _id: { $in: ids },
      userId,
      status: 'rescued',
    }).select('messageId mailboxId ruleId');

    const auditEntries = rescuedEmails.map((email) => ({
      userId,
      mailboxId: email.mailboxId,
      action: 'email_rescued' as const,
      targetType: 'email' as const,
      targetId: email.messageId,
      details: {
        stagedEmailId: email._id.toString(),
        ruleId: email.ruleId.toString(),
        batchRescue: true,
      },
      undoable: false,
    }));

    await AuditLog.insertMany(auditEntries);
  }

  return modifiedCount;
}
