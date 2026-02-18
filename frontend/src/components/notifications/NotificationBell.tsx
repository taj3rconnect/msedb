import { Bell } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { NotificationDropdown } from '@/components/notifications/NotificationDropdown';
import { useNotificationStore } from '@/stores/notificationStore';
import { useUnreadCount } from '@/hooks/useNotifications';

/**
 * Bell icon with unread badge in the Topbar.
 * Uses Popover to show NotificationDropdown on click.
 * Fetches initial unread count on mount via useUnreadCount hook.
 */
export function NotificationBell() {
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const isDropdownOpen = useNotificationStore((s) => s.isDropdownOpen);
  const setDropdownOpen = useNotificationStore((s) => s.setDropdownOpen);

  // Fetch initial unread count (syncs to Zustand store)
  useUnreadCount();

  const displayCount = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <Popover open={isDropdownOpen} onOpenChange={setDropdownOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-0.5 -right-0.5 min-w-[18px] px-1 py-0 text-[10px] leading-[18px]"
            >
              {displayCount}
            </Badge>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 pt-3">
        <NotificationDropdown />
      </PopoverContent>
    </Popover>
  );
}
