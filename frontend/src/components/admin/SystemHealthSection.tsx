import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useSystemHealth } from '@/hooks/useAdmin';
import { formatRelativeTime } from '@/lib/formatters';

/**
 * Get status badge color based on subscription status.
 */
function getStatusBadge(status: string) {
  switch (status.toLowerCase()) {
    case 'active':
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300 hover:bg-green-100">
          Active
        </Badge>
      );
    case 'expired':
      return (
        <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300 hover:bg-yellow-100">
          Expired
        </Badge>
      );
    default:
      return (
        <Badge variant="destructive">{status}</Badge>
      );
  }
}

/**
 * Get a boolean badge (green/red).
 */
function getBoolBadge(value: boolean, trueLabel: string, falseLabel: string) {
  return value ? (
    <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300 hover:bg-green-100">
      {trueLabel}
    </Badge>
  ) : (
    <Badge variant="destructive">{falseLabel}</Badge>
  );
}

/**
 * Calculate token time remaining as a percentage (0-100).
 * Assumes tokens last ~1 hour from refresh. Returns 100 if no expiry.
 */
function tokenTimePercent(tokenExpiresAt?: string): number {
  if (!tokenExpiresAt) return 0;
  const now = Date.now();
  const expires = new Date(tokenExpiresAt).getTime();
  const remaining = expires - now;
  // Assume 1 hour (3600s) token lifetime
  const total = 3600 * 1000;
  const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
  return Math.round(pct);
}

/**
 * System health section showing webhook subscription and token health tables.
 * Auto-refreshes every 60 seconds via the useSystemHealth hook.
 */
export function SystemHealthSection() {
  const { data, isLoading } = useSystemHealth();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-[200px] rounded-xl" />
        <Skeleton className="h-[200px] rounded-xl" />
      </div>
    );
  }

  const subscriptions = data?.subscriptions ?? [];
  const tokenHealth = data?.tokenHealth ?? [];

  return (
    <div className="space-y-8">
      {/* Webhook Subscriptions */}
      <div className="space-y-3">
        <div>
          <h3 className="text-lg font-semibold">Webhook Subscriptions</h3>
          <p className="text-sm text-muted-foreground">
            Monitor Microsoft Graph webhook subscription status for each mailbox.
          </p>
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mailbox Email</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires At</TableHead>
                <TableHead>Last Notification</TableHead>
                <TableHead>Error Count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subscriptions.length > 0 ? (
                subscriptions.map((sub) => (
                  <TableRow key={sub.subscriptionId}>
                    <TableCell className="font-medium">
                      {sub.mailboxId?.email ?? 'Unknown'}
                    </TableCell>
                    <TableCell>
                      {sub.userId?.email ?? sub.userId?.displayName ?? 'Unknown'}
                    </TableCell>
                    <TableCell>{getStatusBadge(sub.status)}</TableCell>
                    <TableCell>
                      {sub.expiresAt
                        ? formatRelativeTime(sub.expiresAt)
                        : '-'}
                    </TableCell>
                    <TableCell>
                      {sub.lastNotificationAt
                        ? formatRelativeTime(sub.lastNotificationAt)
                        : 'Never'}
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          sub.errorCount > 0
                            ? 'text-destructive font-semibold'
                            : ''
                        }
                      >
                        {sub.errorCount}
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground py-8"
                  >
                    No webhook subscriptions found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Token Health */}
      <div className="space-y-3">
        <div>
          <h3 className="text-lg font-semibold">Token Health</h3>
          <p className="text-sm text-muted-foreground">
            Monitor OAuth token status and connectivity for each connected mailbox.
          </p>
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mailbox Email</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Connected</TableHead>
                <TableHead>Token Healthy</TableHead>
                <TableHead>Token Expires</TableHead>
                <TableHead>Last Sync</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokenHealth.length > 0 ? (
                tokenHealth.map((token) => (
                  <TableRow key={token.mailboxId}>
                    <TableCell className="font-medium">{token.email}</TableCell>
                    <TableCell>
                      {token.user?.email ?? token.user?.displayName ?? 'Unknown'}
                    </TableCell>
                    <TableCell>
                      {getBoolBadge(token.isConnected, 'Connected', 'Disconnected')}
                    </TableCell>
                    <TableCell>
                      {getBoolBadge(token.tokenHealthy, 'Healthy', 'Unhealthy')}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <Progress
                          value={tokenTimePercent(token.tokenExpiresAt)}
                          className="h-2 w-20"
                        />
                        <span className="text-xs text-muted-foreground">
                          {token.tokenExpiresAt
                            ? formatRelativeTime(token.tokenExpiresAt)
                            : '-'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {token.lastSyncAt
                        ? formatRelativeTime(token.lastSyncAt)
                        : 'Never'}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground py-8"
                  >
                    No token data available.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
