import { create } from 'zustand';
import type { User, MailboxInfo } from '@/api/auth';

interface AuthState {
  user: User | null;
  mailboxes: MailboxInfo[];
  isLoading: boolean;
  isAuthenticated: boolean;
  setAuth: (user: User, mailboxes: MailboxInfo[]) => void;
  clearAuth: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  mailboxes: [],
  isLoading: true,
  isAuthenticated: false,

  setAuth: (user, mailboxes) =>
    set({
      user,
      mailboxes,
      isAuthenticated: true,
      isLoading: false,
    }),

  clearAuth: () =>
    set({
      user: null,
      mailboxes: [],
      isAuthenticated: false,
      isLoading: false,
    }),

  setLoading: (loading) =>
    set({ isLoading: loading }),
}));
