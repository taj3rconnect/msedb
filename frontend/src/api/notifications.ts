import { apiFetch } from './client';

// --- Types ---

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  priority: string;
  isRead: boolean;
  readAt?: string;
  createdAt: string;
  relatedEntity?: {
    entityType: string;
    entityId: string;
  };
}

export interface NotificationsResponse {
  notifications: NotificationItem[];
  total: number;
  unreadCount: number;
}

export interface UnreadCountResponse {
  count: number;
}

// --- API functions ---

/**
 * Fetch paginated notifications.
 */
export async function fetchNotifications(
  limit?: number,
  offset?: number,
): Promise<NotificationsResponse> {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set('limit', String(limit));
  if (offset !== undefined) params.set('offset', String(offset));
  const qs = params.toString();
  return apiFetch<NotificationsResponse>(`/notifications${qs ? `?${qs}` : ''}`);
}

/**
 * Fetch unread notification count.
 */
export async function fetchUnreadCount(): Promise<UnreadCountResponse> {
  return apiFetch<UnreadCountResponse>('/notifications/unread-count');
}

/**
 * Mark a single notification as read.
 */
export async function markAsRead(id: string): Promise<NotificationItem> {
  return apiFetch<NotificationItem>(`/notifications/${id}/read`, {
    method: 'PATCH',
  });
}

/**
 * Mark all notifications as read.
 */
export async function markAllAsRead(): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>('/notifications/read-all', {
    method: 'PATCH',
  });
}
