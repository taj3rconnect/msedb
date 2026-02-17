import { apiFetch } from './client';

export interface DashboardStats {
  emailsProcessed: number;
  rulesFired: number;
  patternsPending: number;
  stagingCount: number;
  perMailbox: Array<{
    mailboxId: string;
    count: number;
    email?: string;
    displayName?: string;
  }>;
}

export interface EmailEventItem {
  _id: string;
  eventType: string;
  sender: {
    name?: string;
    email?: string;
    domain?: string;
  };
  subject?: string;
  timestamp: string;
  mailboxId: string;
  fromFolder?: string;
  toFolder?: string;
}

export interface DashboardActivity {
  events: EmailEventItem[];
}

/**
 * Fetch dashboard stats (emails processed, rules fired, etc.).
 */
export async function fetchDashboardStats(mailboxId?: string): Promise<DashboardStats> {
  const params = mailboxId ? `?mailboxId=${encodeURIComponent(mailboxId)}` : '';
  return apiFetch<DashboardStats>(`/dashboard/stats${params}`);
}

/**
 * Fetch recent email activity events.
 */
export async function fetchDashboardActivity(
  mailboxId?: string,
  limit?: number,
): Promise<DashboardActivity> {
  const searchParams = new URLSearchParams();
  if (mailboxId) searchParams.set('mailboxId', mailboxId);
  if (limit) searchParams.set('limit', String(limit));
  const qs = searchParams.toString();
  return apiFetch<DashboardActivity>(`/dashboard/activity${qs ? `?${qs}` : ''}`);
}
