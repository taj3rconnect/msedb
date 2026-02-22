export interface SenderInfo {
  email: string;
  name: string;
  domain: string;
}

export type WhitelistAction = 'whitelist' | 'blacklist';

export type ActionScope = 'sender' | 'domain';

export interface MailboxInfo {
  id: string;
  email: string;
  displayName: string;
  isConnected: boolean;
}

export interface ActionResult {
  success: boolean;
  message: string;
}

export interface CreateRuleResponse {
  rule: { _id: string };
}

export interface RunRuleResult {
  matched: number;
  applied: number;
  failed: number;
}
