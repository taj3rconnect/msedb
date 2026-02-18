// Barrel export for all Mongoose models and interfaces
// Importing this file triggers model registration with Mongoose

export { User } from './User.js';
export type { IUser, IEncryptedToken, IUserPreferences, IEncryptedTokens } from './User.js';

export { Mailbox } from './Mailbox.js';
export type { IMailbox, IMailboxSettings } from './Mailbox.js';

export { EmailEvent } from './EmailEvent.js';
export type { IEmailEvent, IEmailEventSender, IEmailEventMetadata } from './EmailEvent.js';

export { Pattern } from './Pattern.js';
export type {
  IPattern,
  IPatternCondition,
  IPatternSuggestedAction,
  IPatternEvidence,
} from './Pattern.js';

export { Rule } from './Rule.js';
export type { IRule, IRuleConditions, IRuleAction, IRuleStats } from './Rule.js';

export { StagedEmail } from './StagedEmail.js';
export type { IStagedEmail, IStagedEmailAction } from './StagedEmail.js';

export { AuditLog } from './AuditLog.js';
export type { IAuditLog, AuditAction, AuditTargetType } from './AuditLog.js';

export { Notification } from './Notification.js';
export type { INotification, INotificationRelatedEntity } from './Notification.js';

export { WebhookSubscription } from './WebhookSubscription.js';
export type { IWebhookSubscription } from './WebhookSubscription.js';

export { TunnelConfig, getTunnelConfig } from './TunnelConfig.js';
export type { ITunnelConfig } from './TunnelConfig.js';
