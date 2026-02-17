import {
  ConfidentialClientApplication,
  LogLevel,
  type ICachePlugin,
  type TokenCacheContext,
} from '@azure/msal-node';
import { config } from '../config/index.js';
import logger from '../config/logger.js';
import { Mailbox } from '../models/Mailbox.js';

/**
 * Microsoft Graph API scopes required by MSEDB.
 * offline_access is included to request a refresh token.
 */
export const GRAPH_SCOPES: string[] = [
  'User.Read',
  'Mail.Read',
  'Mail.ReadWrite',
  'Mail.Send',
  'MailboxSettings.ReadWrite',
  'offline_access',
];

/**
 * Custom ICachePlugin that persists the MSAL token cache to MongoDB
 * via the Mailbox model's msalCache field.
 *
 * Each mailbox gets its own cache partition, keyed by Mailbox._id.
 * This ensures multi-mailbox users have independent token caches.
 */
export class MongoDBCachePlugin implements ICachePlugin {
  private mailboxId: string;

  constructor(mailboxId: string) {
    this.mailboxId = mailboxId;
  }

  async beforeCacheAccess(cacheContext: TokenCacheContext): Promise<void> {
    const mailbox = await Mailbox.findById(this.mailboxId).select('msalCache');
    if (mailbox?.msalCache) {
      cacheContext.tokenCache.deserialize(mailbox.msalCache);
    }
  }

  async afterCacheAccess(cacheContext: TokenCacheContext): Promise<void> {
    if (cacheContext.cacheHasChanged) {
      await Mailbox.findByIdAndUpdate(this.mailboxId, {
        msalCache: cacheContext.tokenCache.serialize(),
      });
    }
  }
}

/**
 * MSAL logger callback that routes MSAL logs to Winston.
 * Only logs at Warning level and above to avoid noise.
 */
function msalLoggerCallback(level: LogLevel, message: string): void {
  if (level <= LogLevel.Warning) {
    logger.warn('MSAL', { level, message });
  }
}

/**
 * Create a ConfidentialClientApplication with a per-mailbox MongoDB cache plugin.
 * Use this for all Graph API token operations after a mailbox has been created.
 */
export function createMsalClient(mailboxId: string): ConfidentialClientApplication {
  return new ConfidentialClientApplication({
    auth: {
      clientId: config.azureAdClientId,
      authority: `https://login.microsoftonline.com/${config.azureAdTenantId}`,
      clientSecret: config.azureAdClientSecret,
    },
    cache: {
      cachePlugin: new MongoDBCachePlugin(mailboxId),
    },
    system: {
      loggerOptions: {
        loggerCallback: msalLoggerCallback,
        piiLoggingEnabled: false,
        logLevel: LogLevel.Warning,
      },
    },
  });
}

/**
 * Create a ConfidentialClientApplication for initial login.
 * No cache plugin is attached because no mailbox exists yet.
 * After login, the token cache is manually serialized to the newly created Mailbox.
 */
export function createLoginMsalClient(): ConfidentialClientApplication {
  return new ConfidentialClientApplication({
    auth: {
      clientId: config.azureAdClientId,
      authority: `https://login.microsoftonline.com/${config.azureAdTenantId}`,
      clientSecret: config.azureAdClientSecret,
    },
    system: {
      loggerOptions: {
        loggerCallback: msalLoggerCallback,
        piiLoggingEnabled: false,
        logLevel: LogLevel.Warning,
      },
    },
  });
}
