import { Mail, CheckCircle, XCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { EmptyState } from '@/components/shared/EmptyState';
import type { SettingsResponse } from '@/api/settings';

interface MailboxSectionProps {
  settings: SettingsResponse;
}

/**
 * Mailboxes tab showing connection status and token health for each mailbox.
 * Informational only -- no reconnect/disconnect actions (would require OAuth flow).
 */
export function MailboxSection({ settings }: MailboxSectionProps) {
  const { mailboxes } = settings;

  if (mailboxes.length === 0) {
    return (
      <EmptyState
        icon={Mail}
        title="No mailboxes connected"
        description="Connect a Microsoft 365 mailbox to start monitoring email patterns."
      />
    );
  }

  return (
    <div className="space-y-4">
      {mailboxes.map((mailbox) => {
        // Calculate token health for progress display
        let tokenProgress = 0;
        let tokenLabel = 'Unknown';

        if (mailbox.tokenExpiresAt) {
          const expiresAt = new Date(mailbox.tokenExpiresAt).getTime();
          const now = Date.now();
          const msRemaining = expiresAt - now;
          // Assume tokens are valid for roughly 1 hour (3600s)
          const totalMs = 3600 * 1000;
          tokenProgress = Math.max(0, Math.min(100, (msRemaining / totalMs) * 100));
          tokenLabel = msRemaining > 0
            ? `Expires ${formatDistanceToNow(new Date(mailbox.tokenExpiresAt), { addSuffix: true })}`
            : 'Expired';
        }

        return (
          <Card key={mailbox.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <CardTitle className="text-base">{mailbox.email}</CardTitle>
                  {mailbox.displayName && (
                    <p className="text-sm text-muted-foreground">{mailbox.displayName}</p>
                  )}
                </div>
                <Badge
                  variant={mailbox.isConnected ? 'default' : 'destructive'}
                  className="shrink-0"
                >
                  {mailbox.isConnected ? (
                    <>
                      <CheckCircle className="mr-1 h-3 w-3" />
                      Connected
                    </>
                  ) : (
                    <>
                      <XCircle className="mr-1 h-3 w-3" />
                      Disconnected
                    </>
                  )}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Token Health */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Token Health</span>
                  <span className={mailbox.tokenHealthy ? 'text-green-600' : 'text-red-600'}>
                    {mailbox.tokenHealthy ? 'Healthy' : 'Unhealthy'}
                  </span>
                </div>
                <Progress
                  value={tokenProgress}
                  className={mailbox.tokenHealthy ? '[&>[data-slot=progress-indicator]]:bg-green-500' : '[&>[data-slot=progress-indicator]]:bg-red-500'}
                />
                <p className="text-xs text-muted-foreground">{tokenLabel}</p>
              </div>

              {/* Last Sync */}
              {mailbox.lastSyncAt && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Last Sync</span>
                  <span>
                    {formatDistanceToNow(new Date(mailbox.lastSyncAt), { addSuffix: true })}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
