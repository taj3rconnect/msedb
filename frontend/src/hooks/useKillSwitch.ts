import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updatePreferences } from '@/api/user';
import { useAuthStore } from '@/stores/authStore';

/**
 * Kill switch mutation hook.
 *
 * Calls PATCH /api/user/preferences to toggle automationPaused.
 * On success, optimistically updates the auth store and invalidates dashboard queries.
 */
export function useKillSwitch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (automationPaused: boolean) =>
      updatePreferences({ automationPaused }),

    onSuccess: (data) => {
      // Optimistically update auth store with new preference
      const currentUser = useAuthStore.getState().user;
      if (currentUser) {
        useAuthStore.getState().setAuth(
          {
            ...currentUser,
            preferences: {
              ...currentUser.preferences,
              automationPaused: data.preferences.automationPaused,
            },
          },
          useAuthStore.getState().mailboxes,
        );
      }

      // Invalidate dashboard queries
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
