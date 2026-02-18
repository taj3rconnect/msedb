import { create } from 'zustand';

interface NotificationState {
  unreadCount: number;
  isDropdownOpen: boolean;
  setUnreadCount: (count: number) => void;
  incrementUnread: () => void;
  decrementUnread: () => void;
  setDropdownOpen: (open: boolean) => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  unreadCount: 0,
  isDropdownOpen: false,

  setUnreadCount: (count) =>
    set({ unreadCount: count }),

  incrementUnread: () =>
    set((state) => ({ unreadCount: state.unreadCount + 1 })),

  decrementUnread: () =>
    set((state) => ({ unreadCount: Math.max(0, state.unreadCount - 1) })),

  setDropdownOpen: (open) =>
    set({ isDropdownOpen: open }),
}));
