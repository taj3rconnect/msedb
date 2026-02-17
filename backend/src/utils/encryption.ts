import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for GCM
const TAG_LENGTH = 16; // 128-bit auth tag

export interface EncryptedData {
  encrypted: string;
  iv: string;
  tag: string;
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * @param text - The plaintext to encrypt
 * @param keyHex - The 256-bit encryption key as a hex string (64 hex chars)
 * @returns EncryptedData with encrypted text, IV, and auth tag (all hex-encoded)
 */
export function encrypt(text: string, keyHex: string): EncryptedData {
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}

/**
 * Decrypt an AES-256-GCM encrypted string.
 * @param encrypted - The encrypted text as a hex string
 * @param ivHex - The initialization vector as a hex string
 * @param tagHex - The authentication tag as a hex string
 * @param keyHex - The 256-bit encryption key as a hex string (64 hex chars)
 * @returns The decrypted plaintext string
 */
export function decrypt(
  encrypted: string,
  ivHex: string,
  tagHex: string,
  keyHex: string
): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
