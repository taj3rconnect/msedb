import { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { fetchCurrentUser, logout as apiLogout } from '@/api/auth';

/**
 * Auth initialization hook.
 *
 * Calls /auth/me on mount to check if the user has a valid session.
 * On success, populates the auth store with user and mailbox data.
 * On failure (401), clears the auth state so the user is redirected to login.
 */
export function useAuth() {
  const { user, mailboxes, isLoading, isAuthenticated, setAuth, clearAuth } =
    useAuthStore();

  useEffect(() => {
    let cancelled = false;

    async function initAuth() {
      try {
        const data = await fetchCurrentUser();
        if (!cancelled) {
          setAuth(data.user, data.mailboxes);
        }
      } catch {
        if (!cancelled) {
          clearAuth();
        }
      }
    }

    initAuth();

    return () => {
      cancelled = true;
    };
  }, [setAuth, clearAuth]);

  const logout = async () => {
    try {
      await apiLogout();
    } finally {
      clearAuth();
      window.location.href = '/login';
    }
  };

  return { user, mailboxes, isLoading, isAuthenticated, logout };
}
