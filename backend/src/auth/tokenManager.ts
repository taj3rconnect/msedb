import { encrypt, decrypt } from '../utils/encryption.js';
import { config } from '../config/index.js';
import { createMsalClient, GRAPH_SCOPES } from './msalClient.js';
import { Mailbox } from '../models/Mailbox.js';
import type { EncryptedData } from '../utils/encryption.js';

/**
 * Encrypt a plaintext string using AES-256-GCM via the app encryption key.
 */
export function encryptTokenData(plaintext: string): EncryptedData {
  return encrypt(plaintext, config.encryptionKey);
}

/**
 * Decrypt data encrypted with encryptTokenData.
 */
export function decryptTokenData(data: EncryptedData): string {
  return decrypt(data.encrypted, data.iv, data.tag, config.encryptionKey);
}

/**
 * Get a valid access token for a mailbox using MSAL's silent token acquisition.
 *
 * Loads the MSAL cache from MongoDB, looks up the cached account by homeAccountId,
 * and calls acquireTokenSilent to get a fresh access token (using the cached refresh token
 * if the access token has expired).
 *
 * @throws Error if mailbox not found, account not in cache, or interaction required
 */
export async function getAccessTokenForMailbox(mailboxId: string): Promise<string> {
  const mailbox = await Mailbox.findById(mailboxId);
  if (!mailbox) {
    throw new Error('Mailbox not found');
  }

  const msalClient = createMsalClient(mailboxId);
  const tokenCache = msalClient.getTokenCache();
  const account = await tokenCache.getAccountByHomeId(mailbox.homeAccountId ?? '');

  if (!account) {
    throw new Error('Account not found in cache -- re-authentication required');
  }

  // Filter out offline_access as it is not a resource scope
  const scopes = GRAPH_SCOPES.filter((s) => s !== 'offline_access');

  const silentResult = await msalClient.acquireTokenSilent({
    account,
    scopes,
  });

  return silentResult.accessToken;
}

/**
 * Check if an error from MSAL indicates that user interaction is required.
 * This happens when the refresh token has expired or been revoked.
 */
export function isInteractionRequired(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('interaction_required') ||
      message.includes('login_required') ||
      message.includes('consent_required')
    );
  }
  return false;
}
