import { AlertCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { StatsCards } from '@/components/dashboard/StatsCards';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { PendingSuggestionsSection } from '@/components/dashboard/PendingSuggestionsSection';
import { EmptyState } from '@/components/shared/EmptyState';
import { useDashboardStats, useDashboardActivity } from '@/hooks/useDashboard';
import { useUiStore } from '@/stores/uiStore';

/**
 * Dashboard page composing stats cards, pending suggestions, and activity feed.
 *
 * Uses the selected mailbox from uiStore for per-mailbox filtering.
 */
export function DashboardPage() {
  const selectedMailboxId = useUiStore((s) => s.selectedMailboxId);
  const stats = useDashboardStats(selectedMailboxId);
  const activity = useDashboardActivity(selectedMailboxId);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>

      {/* Stats Cards */}
      {stats.isLoading ? (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px] rounded-xl" />
          ))}
        </div>
      ) : stats.isError ? (
        <EmptyState
          icon={AlertCircle}
          title="Failed to load stats"
          description="There was an error loading dashboard statistics. Please try again."
        />
      ) : stats.data ? (
        <StatsCards
          emailsProcessed={stats.data.emailsProcessed}
          rulesFired={stats.data.rulesFired}
          patternsPending={stats.data.patternsPending}
          stagingCount={stats.data.stagingCount}
        />
      ) : null}

      {/* Pending Suggestions */}
      <PendingSuggestionsSection />

      {/* Activity Feed */}
      {activity.isLoading ? (
        <Skeleton className="h-[400px] rounded-xl" />
      ) : activity.isError ? (
        <EmptyState
          icon={AlertCircle}
          title="Failed to load activity"
          description="There was an error loading recent activity. Please try again."
        />
      ) : activity.data ? (
        <ActivityFeed events={activity.data.events} />
      ) : null}
    </div>
  );
}
