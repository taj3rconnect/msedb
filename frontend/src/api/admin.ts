import { apiFetch } from './client';

// --- Types ---

export interface AdminUser {
  id: string;
  email: string;
  displayName?: string;
  role: 'admin' | 'user';
  isActive: boolean;
  lastLoginAt?: string;
  createdAt: string;
}

export interface AdminAnalytics {
  totalUsers: number;
  activeUsers: number;
  totalEvents: number;
  totalRules: number;
  totalPatterns: number;
}

export interface SubscriptionHealth {
  subscriptionId: string;
  status: string;
  expiresAt: string;
  lastNotificationAt?: string;
  errorCount: number;
  mailboxId: { _id: string; email: string; displayName?: string };
  userId: { _id: string; email: string; displayName?: string };
}

export interface TokenHealth {
  mailboxId: string;
  email: string;
  user: { _id: string; email: string; displayName?: string };
  isConnected: boolean;
  tokenExpiresAt?: string;
  tokenHealthy: boolean;
  lastSyncAt?: string;
}

export interface SystemHealth {
  subscriptions: SubscriptionHealth[];
  tokenHealth: TokenHealth[];
}

export interface OrgRule {
  _id: string;
  name: string;
  conditions: {
    senderEmail?: string;
    senderDomain?: string;
    subjectContains?: string;
  };
  actions: {
    actionType: string;
    toFolder?: string;
    order?: number;
  }[];
  isEnabled: boolean;
  priority: number;
  scope: 'org';
  createdAt: string;
}

export interface TunnelStatus {
  url: string;
  isHealthy: boolean;
  lastHealthCheck?: string;
  subscriptionCount: number;
}

export interface TunnelRefreshResult extends TunnelStatus {
  sync: { total: number; created: number; renewed: number; failed: number };
}

// --- API functions ---

/**
 * Fetch all users (admin only).
 */
export async function fetchAdminUsers(): Promise<AdminUser[]> {
  return apiFetch<AdminUser[]>('/admin/users');
}

/**
 * Invite a new user by email with optional role.
 */
export async function inviteUser(
  email: string,
  role?: string,
): Promise<AdminUser> {
  return apiFetch<AdminUser>('/admin/invite', {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  });
}

/**
 * Change a user's role.
 */
export async function changeUserRole(
  userId: string,
  role: string,
): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/admin/users/${userId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}

/**
 * Deactivate a user.
 */
export async function deactivateUser(userId: string): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/admin/users/${userId}/deactivate`, {
    method: 'PATCH',
  });
}

/**
 * Fetch aggregate analytics.
 */
export async function fetchAnalytics(): Promise<AdminAnalytics> {
  return apiFetch<AdminAnalytics>('/admin/analytics');
}

/**
 * Fetch system health (webhook subscriptions and token status).
 */
export async function fetchSystemHealth(): Promise<SystemHealth> {
  return apiFetch<SystemHealth>('/admin/health');
}

/**
 * Fetch all org-wide rules.
 */
export async function fetchOrgRules(): Promise<OrgRule[]> {
  return apiFetch<OrgRule[]>('/admin/org-rules');
}

/**
 * Create a new org-wide rule.
 */
export async function createOrgRule(data: {
  name: string;
  conditions: object;
  actions: object[];
  priority?: number;
}): Promise<OrgRule> {
  return apiFetch<OrgRule>('/admin/org-rules', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Delete an org-wide rule by ID.
 */
export async function deleteOrgRule(id: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/admin/org-rules/${id}`, {
    method: 'DELETE',
  });
}

/**
 * Fetch the current tunnel status (URL, health, subscriptions).
 */
export async function fetchTunnelStatus(): Promise<TunnelStatus> {
  return apiFetch<TunnelStatus>('/admin/tunnel-status');
}

/**
 * Refresh the tunnel: restart cloudflared, detect new URL, re-sync subscriptions.
 */
export async function refreshTunnel(): Promise<TunnelRefreshResult> {
  return apiFetch<TunnelRefreshResult>('/admin/tunnel-refresh', {
    method: 'POST',
  });
}
