import { useQuery } from '@tanstack/react-query';
import { fetchDashboardStats, fetchDashboardActivity } from '@/api/dashboard';
import type { DashboardStats, DashboardActivity } from '@/api/dashboard';

/**
 * TanStack Query hook for dashboard stats.
 */
export function useDashboardStats(mailboxId?: string | null) {
  return useQuery<DashboardStats>({
    queryKey: ['dashboard', 'stats', mailboxId ?? null],
    queryFn: () => fetchDashboardStats(mailboxId ?? undefined),
  });
}

/**
 * TanStack Query hook for dashboard activity feed.
 */
export function useDashboardActivity(mailboxId?: string | null) {
  return useQuery<DashboardActivity>({
    queryKey: ['dashboard', 'activity', mailboxId ?? null],
    queryFn: () => fetchDashboardActivity(mailboxId ?? undefined),
  });
}
