import { Brain, Shield, Clock, Bell } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import type { NotificationItem as NotificationItemType } from '@/api/notifications';

// Map notification type to icon
function getNotificationIcon(type: string) {
  switch (type) {
    case 'pattern_detected':
      return Brain;
    case 'rule_executed':
      return Shield;
    case 'staging_alert':
      return Clock;
    default:
      return Bell;
  }
}

interface NotificationItemProps {
  notification: NotificationItemType;
  onMarkRead: (id: string) => void;
}

/**
 * Single notification row in the dropdown.
 * Unread items have a blue left border and accent background.
 * Clicking an unread notification marks it as read.
 */
export function NotificationItem({ notification, onMarkRead }: NotificationItemProps) {
  const Icon = getNotificationIcon(notification.type);
  const isUnread = !notification.isRead;

  return (
    <button
      type="button"
      className={`flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/50 ${
        isUnread ? 'border-l-2 border-primary bg-accent/50' : 'border-l-2 border-transparent'
      }`}
      onClick={() => {
        if (isUnread) {
          onMarkRead(notification.id);
        }
      }}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex-1 space-y-0.5 overflow-hidden">
        <div className="flex items-center gap-2">
          <span className={`text-sm truncate ${isUnread ? 'font-medium' : 'font-normal'}`}>
            {notification.title}
          </span>
          {notification.priority === 'high' && (
            <Badge variant="destructive" className="text-[10px] px-1 py-0">
              Urgent
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2">
          {notification.message}
        </p>
        <p className="text-[11px] text-muted-foreground/60">
          {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
        </p>
      </div>
    </button>
  );
}
