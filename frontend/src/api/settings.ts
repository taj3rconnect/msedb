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
