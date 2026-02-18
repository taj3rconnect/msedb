import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { StatsCards } from '@/components/dashboard/StatsCards';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { PendingSuggestionsSection } from '@/components/dashboard/PendingSuggestionsSection';
import { WebhookUrlCard } from '@/components/dashboard/WebhookUrlCard';
import { EmptyState } from '@/components/shared/EmptyState';
import { useDashboardStats, useDashboardActivity } from '@/hooks/useDashboard';
import { useUiStore } from '@/stores/uiStore';
import { useAuthStore } from '@/stores/authStore';
import { triggerSyncNow, fetchSyncStatus } from '@/api/admin';

/**
 * Dashboard page composing stats cards, pending suggestions, and activity feed.
 *
 * Uses the selected mailbox from uiStore for per-mailbox filtering.
 */
export function DashboardPage() {
  const selectedMailboxId = useUiStore((s) => s.selectedMailboxId);
  const user = useAuthStore((s) => s.user);
  const stats = useDashboardStats(selectedMailboxId);
  const activity = useDashboardActivity(selectedMailboxId);
  const isAdmin = user?.role === 'admin';
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [nextSyncAt, setNextSyncAt] = useState<string | null>(null);
  const [countdown, setCountdown] = useState('');

  const loadSyncStatus = useCallback(async () => {
    try {
      const data = await fetchSyncStatus();
      setLastSyncAt(data.lastSyncAt);
      setNextSyncAt(data.nextSyncAt);
    } catch { /* ignore */ }
  }, []);

  // Load sync status on mount + after each sync, poll every 30s
  useEffect(() => {
    if (!isAdmin) return;
    loadSyncStatus();
    const interval = setInterval(loadSyncStatus, 30000);
    return () => clearInterval(interval);
  }, [isAdmin, loadSyncStatus]);

  // Countdown timer — updates every second
  useEffect(() => {
    if (!nextSyncAt) { setCountdown(''); return; }
    const tick = () => {
      const diff = Math.max(0, Math.floor((new Date(nextSyncAt).getTime() - Date.now()) / 1000));
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      setCountdown(`${m}:${s.toString().padStart(2, '0')}`);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [nextSyncAt]);

  const handleSyncNow = async () => {
    setSyncing(true);
    setSyncMsg('');
    try {
      await triggerSyncNow();
      setSyncMsg('Sync queued');
      setTimeout(() => { setSyncMsg(''); loadSyncStatus(); }, 3000);
    } catch {
      setSyncMsg('Failed to queue sync');
    } finally {
      setSyncing(false);
    }
  };

  const formatTimeAgo = (iso: string) => {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        {isAdmin && (
          <div className="flex items-center gap-3">
            {lastSyncAt && (
              <span className="text-xs text-muted-foreground">
                Synced {formatTimeAgo(lastSyncAt)}
              </span>
            )}
            {countdown && (
              <span className="text-xs text-muted-foreground tabular-nums">
                Next in {countdown}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleSyncNow}
              disabled={syncing}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
              Sync Now
            </Button>
            {syncMsg && (
              <span className="text-sm text-muted-foreground">{syncMsg}</span>
            )}
          </div>
        )}
      </div>

      {/* Webhook URL management (admin only) */}
      {isAdmin && <WebhookUrlCard />}

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
