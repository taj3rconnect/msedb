import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EmptyState } from '@/components/shared/EmptyState';
import { NotificationItem } from '@/components/notifications/NotificationItem';
import { useNotifications, useMarkRead, useMarkAllRead } from '@/hooks/useNotifications';
import { useNotificationStore } from '@/stores/notificationStore';

/**
 * Notification dropdown content shown inside the bell popover.
 * Displays up to 10 recent notifications with mark-read actions.
 */
export function NotificationDropdown() {
  const { data, isLoading } = useNotifications(10, 0);
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();
  const unreadCount = useNotificationStore((s) => s.unreadCount);

  const notifications = data?.notifications ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 pb-2">
        <h4 className="text-sm font-semibold">Notifications</h4>
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
          >
            Mark all read
          </Button>
        )}
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      ) : notifications.length === 0 ? (
        <div className="py-4">
          <EmptyState
            icon={Bell}
            title="No notifications yet"
            description="You'll see alerts about patterns, rules, and staging here."
          />
        </div>
      ) : (
        <ScrollArea className="max-h-80">
          <div className="flex flex-col">
            {notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onMarkRead={(id) => markRead.mutate(id)}
              />
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Footer */}
      {total > 10 && (
        <div className="border-t px-3 pt-2 text-center">
          <p className="text-xs text-muted-foreground">
            {total - 10} more notifications
          </p>
        </div>
      )}
    </div>
  );
}
