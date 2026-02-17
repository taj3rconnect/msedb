import { Mail } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EmptyState } from '@/components/shared/EmptyState';
import { EVENT_TYPES } from '@/lib/constants';
import { formatRelativeTime, formatEmail } from '@/lib/formatters';
import type { EmailEventItem } from '@/api/dashboard';

interface ActivityFeedProps {
  events: EmailEventItem[];
}

/**
 * Scrollable list of recent email events with type badges and timestamps.
 */
export function ActivityFeed({ events }: ActivityFeedProps) {
  if (events.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={Mail}
            title="No Activity Yet"
            description="Email events will appear here as they are processed."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px]">
          <div className="space-y-3">
            {events.map((event) => {
              const eventConfig = EVENT_TYPES[event.eventType] ?? {
                label: event.eventType,
                color: 'bg-gray-100 text-gray-800',
              };

              return (
                <div
                  key={event._id}
                  className="flex items-start justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge
                        variant="secondary"
                        className={`text-xs ${eventConfig.color}`}
                      >
                        {eventConfig.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(event.timestamp)}
                      </span>
                    </div>
                    <p className="text-sm font-medium truncate">
                      {formatEmail(event.sender?.email)}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {event.subject ?? '(No subject)'}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
