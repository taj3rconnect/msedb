import type { Types } from 'mongoose';
import { Mailbox } from '../models/Mailbox.js';
import { getRedisClient } from '../config/redis.js';

const ORG_WHITELIST_SENDERS_KEY = 'org:whitelist:senders';
const ORG_WHITELIST_DOMAINS_KEY = 'org:whitelist:domains';

/**
 * Check if a sender is whitelisted for a given mailbox.
 *
 * Checks per-mailbox whitelist first (Mongo), then org-wide whitelist (Redis).
 * All comparisons are case-insensitive.
 *
 * @returns true if the sender should be excluded from automation
 */
export async function isWhitelisted(
  mailboxId: Types.ObjectId,
  senderEmail: string,
): Promise<boolean> {
  const normalizedEmail = senderEmail.toLowerCase();
  const senderDomain = normalizedEmail.split('@')[1];

  // Check per-mailbox whitelist
  const mailbox = await Mailbox.findById(mailboxId).select(
    'settings.whitelistedSenders settings.whitelistedDomains',
  );

  if (mailbox) {
    const senders = mailbox.settings.whitelistedSenders.map((s) =>
      s.toLowerCase(),
    );
    if (senders.includes(normalizedEmail)) {
      return true;
    }

    const domains = mailbox.settings.whitelistedDomains.map((d) =>
      d.toLowerCase(),
    );
    if (senderDomain && domains.includes(senderDomain)) {
      return true;
    }
  }

  // Check org-wide whitelist (Redis sets)
  const redis = getRedisClient();

  const [isSenderWhitelisted, isDomainWhitelisted] = await Promise.all([
    redis.sismember(ORG_WHITELIST_SENDERS_KEY, normalizedEmail),
    senderDomain
      ? redis.sismember(ORG_WHITELIST_DOMAINS_KEY, senderDomain)
      : Promise.resolve(0),
  ]);

  return isSenderWhitelisted === 1 || isDomainWhitelisted === 1;
}

/**
 * Load every whitelist entry that applies to a mailbox ONCE and return a
 * synchronous predicate.
 *
 * `isWhitelisted` costs one Mongo read plus two Redis round-trips per call,
 * which is fine for a single inbound email but an N+1 when the pattern engine
 * evaluates hundreds of senders in one analysis run. Callers in a loop should
 * use this instead.
 */
export async function loadWhitelistMatcher(
  mailboxId: Types.ObjectId,
): Promise<(senderEmail: string) => boolean> {
  const redis = getRedisClient();

  const [mailbox, orgSenders, orgDomains] = await Promise.all([
    Mailbox.findById(mailboxId).select(
      'settings.whitelistedSenders settings.whitelistedDomains',
    ),
    redis.smembers(ORG_WHITELIST_SENDERS_KEY),
    redis.smembers(ORG_WHITELIST_DOMAINS_KEY),
  ]);

  const senders = new Set<string>([
    ...(mailbox?.settings.whitelistedSenders ?? []).map((s) => s.toLowerCase()),
    ...orgSenders.map((s) => s.toLowerCase()),
  ]);
  const domains = new Set<string>([
    ...(mailbox?.settings.whitelistedDomains ?? []).map((d) => d.toLowerCase()),
    ...orgDomains.map((d) => d.toLowerCase()),
  ]);

  return (senderEmail: string): boolean => {
    if (!senderEmail) return false;
    const normalized = senderEmail.toLowerCase();
    if (senders.has(normalized)) return true;
    const domain = normalized.split('@')[1];
    return domain ? domains.has(domain) : false;
  };
}

/**
 * Add a sender or domain to the org-wide whitelist (stored in Redis).
 */
export async function addToOrgWhitelist(
  type: 'sender' | 'domain',
  value: string,
): Promise<void> {
  const redis = getRedisClient();
  const key =
    type === 'sender' ? ORG_WHITELIST_SENDERS_KEY : ORG_WHITELIST_DOMAINS_KEY;
  await redis.sadd(key, value.toLowerCase());
}

/**
 * Remove a sender or domain from the org-wide whitelist.
 */
export async function removeFromOrgWhitelist(
  type: 'sender' | 'domain',
  value: string,
): Promise<void> {
  const redis = getRedisClient();
  const key =
    type === 'sender' ? ORG_WHITELIST_SENDERS_KEY : ORG_WHITELIST_DOMAINS_KEY;
  await redis.srem(key, value.toLowerCase());
}

/**
 * Get all entries in the org-wide whitelist.
 */
export async function getOrgWhitelist(): Promise<{
  senders: string[];
  domains: string[];
}> {
  const redis = getRedisClient();
  const [senders, domains] = await Promise.all([
    redis.smembers(ORG_WHITELIST_SENDERS_KEY),
    redis.smembers(ORG_WHITELIST_DOMAINS_KEY),
  ]);
  return { senders, domains };
}
