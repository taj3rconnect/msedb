import { apiFetch } from './client';

export interface UserPreferences {
  automationPaused: boolean;
  workingHoursStart?: number;
  workingHoursEnd?: number;
  aggressiveness?: string;
}

interface PreferencesResponse {
  preferences: UserPreferences;
}

/**
 * Update user preferences (field-level $set -- only provided fields are updated).
 * URL: /user/preferences (apiFetch prepends /api, making it /api/user/preferences).
 */
export async function updatePreferences(
  prefs: Partial<UserPreferences>,
): Promise<PreferencesResponse> {
  return apiFetch<PreferencesResponse>('/user/preferences', {
    method: 'PATCH',
    body: JSON.stringify(prefs),
  });
}
