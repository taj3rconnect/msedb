import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchNotifications,
  fetchUnreadCount,
  markAsRead,
  markAllAsRead,
} from '@/api/notifications';
import type { NotificationsResponse, UnreadCountResponse } from '@/api/notifications';
import { useNotificationStore } from '@/stores/notificationStore';

/**
 * TanStack Query hook for fetching paginated notifications.
 * Syncs unread count to the Zustand store on success.
 */
export function useNotifications(limit?: number, offset?: number) {
  return useQuery<NotificationsResponse>({
    queryKey: ['notifications', limit, offset],
    queryFn: () => fetchNotifications(limit, offset),
    select: (data) => {
      // Sync unread count to Zustand store
      useNotificationStore.getState().setUnreadCount(data.unreadCount);
      return data;
    },
  });
}

/**
 * TanStack Query hook for fetching unread notification count.
 * Syncs to Zustand store on success. No polling -- Socket.IO handles real-time.
 */
export function useUnreadCount() {
  return useQuery<UnreadCountResponse>({
    queryKey: ['notifications-unread'],
    queryFn: fetchUnreadCount,
    staleTime: 60_000,
    select: (data) => {
      useNotificationStore.getState().setUnreadCount(data.count);
      return data;
    },
  });
}

/**
 * Mutation hook to mark a single notification as read.
 * Invalidates notification queries and decrements Zustand unread count.
 */
export function useMarkRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => markAsRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
      useNotificationStore.getState().decrementUnread();
    },
  });
}

/**
 * Mutation hook to mark all notifications as read.
 * Invalidates notification queries and resets Zustand unread count to 0.
 */
export function useMarkAllRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: markAllAsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
      useNotificationStore.getState().setUnreadCount(0);
    },
  });
}
