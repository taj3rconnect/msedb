import { apiFetch } from './client';

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'user';
  preferences: {
    automationPaused: boolean;
  };
}

export interface MailboxInfo {
  id: string;
  email: string;
  displayName: string;
  isConnected: boolean;
  lastSyncAt?: string;
}

interface AuthMeResponse {
  user: User;
  mailboxes: MailboxInfo[];
}

/**
 * Fetch the current authenticated user and their connected mailboxes.
 */
export async function fetchCurrentUser(): Promise<AuthMeResponse> {
  return apiFetch<AuthMeResponse>('/auth/me');
}

/**
 * Log out the current user by clearing the session cookie.
 */
export async function logout(): Promise<void> {
  await apiFetch<{ message: string }>('/auth/logout', {
    method: 'POST',
  });
}
