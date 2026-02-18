import { useState } from 'react';
import { Mail, CheckCircle, XCircle, Plus, Unplug } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { EmptyState } from '@/components/shared/EmptyState';
import { connectMailbox, disconnectMailbox } from '@/api/mailboxes';
import type { SettingsResponse } from '@/api/settings';

interface MailboxSectionProps {
  settings: SettingsResponse;
}

export function MailboxSection({ settings }: MailboxSectionProps) {
  const { mailboxes } = settings;
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { authUrl } = await connectMailbox();
      window.location.href = authUrl;
    } catch (err) {
      console.error('Failed to start mailbox connection:', err);
      setConnecting(false);
    }
  };

  const handleDisconnect = async (mailboxId: string) => {
    setDisconnecting(mailboxId);
    try {
      await disconnectMailbox(mailboxId);
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
    } catch (err) {
      console.error('Failed to disconnect mailbox:', err);
    } finally {
      setDisconnecting(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Connect Microsoft 365 mailboxes to monitor email patterns.
        </p>
        <Button onClick={handleConnect} disabled={connecting}>
          <Plus className="mr-2 h-4 w-4" />
          {connecting ? 'Connecting...' : 'Connect Mailbox'}
        </Button>
      </div>

      {mailboxes.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="No mailboxes connected"
          description="Click 'Connect Mailbox' to add a Microsoft 365 mailbox."
        />
      ) : (
        mailboxes.map((mailbox) => {
          let tokenProgress = 0;
          let tokenLabel = 'Unknown';

          if (mailbox.tokenExpiresAt) {
            const expiresAt = new Date(mailbox.tokenExpiresAt).getTime();
            const now = Date.now();
            const msRemaining = expiresAt - now;
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
                  <div className="flex items-center gap-2">
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
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDisconnect(mailbox.id)}
                      disabled={disconnecting === mailbox.id}
                    >
                      <Unplug className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
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
        })
      )}
    </div>
  );
}
