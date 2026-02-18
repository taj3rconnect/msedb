import { useState, useEffect, useCallback } from 'react';
import { Globe, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { fetchTunnelStatus, refreshTunnel } from '@/api/admin';
import type { TunnelRefreshResult } from '@/api/admin';

export function WebhookUrlCard() {
  const [url, setUrl] = useState('');
  const [isHealthy, setIsHealthy] = useState(false);
  const [subscriptionCount, setSubscriptionCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [syncResult, setSyncResult] = useState<TunnelRefreshResult['sync'] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const loadStatus = useCallback(async () => {
    try {
      const data = await fetchTunnelStatus();
      setUrl(data.url);
      setIsHealthy(data.isHealthy);
      setSubscriptionCount(data.subscriptionCount);
      setError('');
    } catch {
      setError('Failed to load tunnel status');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on mount + poll every 60s
  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 60000);
    return () => clearInterval(interval);
  }, [loadStatus]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError('');
    setSyncResult(null);
    try {
      const result = await refreshTunnel();
      setUrl(result.url);
      setIsHealthy(result.isHealthy);
      setSubscriptionCount(result.subscriptionCount);
      setSyncResult(result.sync);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh tunnel');
      // Re-check status after failure
      await loadStatus();
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Cloudflare Tunnel
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={subscriptionCount > 0 ? 'default' : 'secondary'}>
              {subscriptionCount} subscription{subscriptionCount !== 1 ? 's' : ''}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          {/* Status dot */}
          <span
            className={`inline-block h-3 w-3 shrink-0 rounded-full ${
              isHealthy ? 'bg-green-500' : 'bg-red-500'
            }`}
            title={isHealthy ? 'Tunnel is healthy' : 'Tunnel is down or URL has changed'}
          />

          {/* URL display */}
          <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-sm font-mono">
            {url || 'No tunnel URL configured'}
          </code>

          {/* Refresh button */}
          <Button
            variant={isHealthy ? 'ghost' : 'destructive'}
            size="icon"
            onClick={handleRefresh}
            disabled={refreshing}
            title={isHealthy ? 'Refresh tunnel' : 'Tunnel is down — click to restart and get new URL'}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Sync result after refresh */}
        {syncResult && (
          <p className="text-sm text-muted-foreground">
            {syncResult.failed === 0 ? (
              <span className="text-green-600">
                Refreshed: {syncResult.created} subscriptions created
              </span>
            ) : (
              <span className="text-red-600">
                {syncResult.failed} failed, {syncResult.created} created
              </span>
            )}
          </p>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}
