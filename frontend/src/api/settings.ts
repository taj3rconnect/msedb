import { apiFetch } from './client';

// --- Types ---

export interface UserPreferences {
  automationPaused: boolean;
  workingHoursStart: number;
  workingHoursEnd: number;
  aggressiveness: 'conservative' | 'moderate' | 'aggressive';
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
}

export interface SettingsResponse {
  user: {
    email: string;
    displayName?: string;
    preferences: UserPreferences;
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
