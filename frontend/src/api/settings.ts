import { apiFetch } from './client';

// --- Types ---

export interface UserPreferences {
  automationPaused: boolean;
  workingHoursStart: number;
  workingHoursEnd: number;
  contactsMailboxId?: string;
  contactsFolderId?: string;
}

export interface PatternSettings {
  thresholdDelete: number;
  thresholdMove: number;
  thresholdMarkRead: number;
  observationWindowDays: number;
  rejectionCooldownDays: number;
  minSenderEvents: number;
}

export const DEFAULT_PATTERN_SETTINGS: PatternSettings = {
  thresholdDelete: 98,
  thresholdMove: 85,
  thresholdMarkRead: 80,
  observationWindowDays: 90,
  rejectionCooldownDays: 30,
  minSenderEvents: 5,
};

export interface Signature {
  id: string;
  name: string;
  content: string;
  isDefault: boolean;
}

export interface MailboxInfo {
  id: string;
  email: string;
  displayName?: string;
  isConnected: boolean;
  tokenExpiresAt?: string;
  tokenHealthy: boolean;
  lastSyncAt?: string;
  whitelistedSenders: string[];
  whitelistedDomains: string[];
  signatures: Signature[];
}

export interface SettingsResponse {
  user: {
    email: string;
    displayName?: string;
    preferences: UserPreferences;
    patternSettings: PatternSettings;
    createdAt: string;
  };
  mailboxes: MailboxInfo[];
}

// --- API functions ---

/**
 * Fetch user settings (profile, preferences, mailboxes).
 */
export async function fetchSettings(): Promise<SettingsResponse> {
  return apiFetch<SettingsResponse>('/settings');
}

/**
 * Update user preferences (field-level $set).
 */
export async function updatePreferences(
  prefs: Partial<UserPreferences>,
): Promise<{ preferences: UserPreferences }> {
  return apiFetch<{ preferences: UserPreferences }>('/user/preferences', {
    method: 'PATCH',
    body: JSON.stringify(prefs),
  });
}

/**
 * Update user pattern engine settings (field-level $set).
 */
export async function updatePatternSettings(
  settings: Partial<PatternSettings>,
): Promise<{ patternSettings: PatternSettings }> {
  return apiFetch<{ patternSettings: PatternSettings }>('/user/pattern-settings', {
    method: 'PATCH',
    body: JSON.stringify(settings),
  });
}

/**
 * Export user data as a downloadable JSON file.
 * Uses native fetch (not apiFetch) to get the raw Blob response.
 */
export async function exportData(): Promise<Blob> {
  const response = await fetch('/api/settings/export-data', {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Export failed: ${response.statusText}`);
  }

  return response.blob();
}

/**
 * Delete user account and all associated data.
 */
export async function deleteData(): Promise<{ message: string }> {
  return apiFetch<{ message: string }>('/settings/delete-data', {
    method: 'DELETE',
  });
}

/**
 * Update signatures for a mailbox.
 */
export async function updateMailboxSignatures(
  mailboxId: string,
  signatures: Signature[],
): Promise<{ signatures: Signature[] }> {
  return apiFetch<{ signatures: Signature[] }>(`/mailboxes/${mailboxId}/signatures`, {
    method: 'PUT',
    body: JSON.stringify({ signatures }),
  });
}

export interface OofStatus {
  status: 'Disabled' | 'AlwaysEnabled' | 'Scheduled';
  internalReplyMessage: string;
  externalReplyMessage: string;
  externalAudience: 'none' | 'contactsOnly' | 'all';
  scheduledStartDateTime?: { dateTime: string; timeZone: string };
  scheduledEndDateTime?: { dateTime: string; timeZone: string };
}

/**
 * Fetch out-of-office settings for a mailbox from Graph.
 */
export async function fetchOof(mailboxId: string): Promise<{ oof: OofStatus | null }> {
  return apiFetch<{ oof: OofStatus | null }>(`/mailboxes/${mailboxId}/oof`);
}

/**
 * Update out-of-office settings for a mailbox via Graph.
 */
export async function updateOof(
  mailboxId: string,
  oof: Partial<OofStatus>,
): Promise<{ oof: OofStatus }> {
  return apiFetch<{ oof: OofStatus }>(`/mailboxes/${mailboxId}/oof`, {
    method: 'PUT',
    body: JSON.stringify(oof),
  });
}

export interface OutlookCategory {
  id: string;
  displayName: string;
  color: string;
}

/**
 * Fetch Outlook master categories for a mailbox.
 */
export async function fetchCategories(mailboxId: string): Promise<{ categories: OutlookCategory[] }> {
  return apiFetch<{ categories: OutlookCategory[] }>(`/mailboxes/${mailboxId}/categories`);
}

/**
 * Create an Outlook master category.
 */
export async function createCategory(
  mailboxId: string,
  displayName: string,
  color: string,
): Promise<{ category: OutlookCategory }> {
  return apiFetch<{ category: OutlookCategory }>(`/mailboxes/${mailboxId}/categories`, {
    method: 'POST',
    body: JSON.stringify({ displayName, color }),
  });
}

/**
 * Delete an Outlook master category.
 */
export async function deleteCategory(mailboxId: string, categoryId: string): Promise<void> {
  return apiFetch(`/mailboxes/${mailboxId}/categories/${categoryId}`, { method: 'DELETE' });
}

/**
 * Update categories assigned to a message.
 */
export async function updateMessageCategories(
  mailboxId: string,
  messageId: string,
  categories: string[],
): Promise<{ categories: string[] }> {
  return apiFetch<{ categories: string[] }>(`/mailboxes/${mailboxId}/messages/${messageId}/categories`, {
    method: 'PATCH',
    body: JSON.stringify({ categories }),
  });
}

/**
 * Update per-mailbox whitelist (senders and domains).
 */
export async function updateMailboxWhitelist(
  mailboxId: string,
  data: { whitelistedSenders: string[]; whitelistedDomains: string[] },
): Promise<{ senders: string[]; domains: string[] }> {
  return apiFetch<{ senders: string[]; domains: string[] }>(
    `/mailboxes/${mailboxId}/whitelist`,
    {
      method: 'PUT',
      body: JSON.stringify({
        senders: data.whitelistedSenders,
        domains: data.whitelistedDomains,
      }),
    },
  );
}
