import { getAccessToken } from '../auth/authHelper.js';
import type { MailboxInfo, CreateRuleResponse, RunRuleResult } from '../types/index.js';

/* Webpack DefinePlugin global */
declare const BACKEND_URL: string;

/**
 * Make an authenticated API request to the MSEDB backend.
 * Automatically acquires and attaches a Bearer token.
 */
export async function apiRequest<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const token = await getAccessToken();

  const response = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `API request failed: ${response.status} ${response.statusText} - ${body}`
    );
  }

  return response.json() as Promise<T>;
}

/**
 * Get the current user's connected mailboxes.
 */
export async function getMailboxes(): Promise<MailboxInfo[]> {
  const data = await apiRequest<{ mailboxes: MailboxInfo[] }>('/auth/me');
  return data.mailboxes;
}

/**
 * Get the whitelist for a specific mailbox.
 */
export async function getWhitelist(
  mailboxId: string
): Promise<{ senders: string[]; domains: string[] }> {
  return apiRequest<{ senders: string[]; domains: string[] }>(
    `/api/mailboxes/${mailboxId}/whitelist`
  );
}

/**
 * Update the whitelist for a specific mailbox.
 */
export async function updateWhitelist(
  mailboxId: string,
  data: { senders?: string[]; domains?: string[] }
): Promise<void> {
  await apiRequest(`/api/mailboxes/${mailboxId}/whitelist`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/**
 * Create a new automation rule. Returns the created rule with its _id.
 */
export async function createRule(data: {
  mailboxId: string;
  name: string;
  conditions: Record<string, unknown>;
  actions: Array<{ actionType: string }>;
  skipStaging?: boolean;
}): Promise<CreateRuleResponse> {
  return apiRequest<CreateRuleResponse>('/api/rules', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Run a rule against the entire mailbox now.
 * Returns stats: matched, applied, failed.
 */
export async function runRule(ruleId: string): Promise<RunRuleResult> {
  return apiRequest<RunRuleResult>(`/api/rules/${ruleId}/run`, {
    method: 'POST',
  });
}
