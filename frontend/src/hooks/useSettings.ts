import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  fetchSettings,
  updatePreferences,
  exportData,
  deleteData,
  updateMailboxWhitelist,
} from '@/api/settings';
import type { SettingsResponse, UserPreferences } from '@/api/settings';

/**
 * TanStack Query hook for fetching user settings.
 */
export function useSettings() {
  return useQuery<SettingsResponse>({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  });
}

/**
 * Mutation hook to update user preferences (field-level PATCH).
 * Shows toast on success and invalidates settings query.
 */
export function useUpdatePreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (prefs: Partial<UserPreferences>) => updatePreferences(prefs),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Preferences saved');
    },
    onError: () => {
      toast.error('Failed to save preferences');
    },
  });
}

/**
 * Mutation hook to export user data as a downloadable JSON file.
 * Creates a temporary anchor element to trigger download.
 */
export function useExportData() {
  return useMutation({
    mutationFn: exportData,
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `msedb-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Data exported');
    },
    onError: () => {
      toast.error('Failed to export data');
    },
  });
}

/**
 * Mutation hook to delete user account.
 * Redirects to login page on success (session is cleared server-side).
 */
export function useDeleteData() {
  return useMutation({
    mutationFn: deleteData,
    onSuccess: () => {
      window.location.href = '/login';
    },
    onError: () => {
      toast.error('Failed to delete account');
    },
  });
}

/**
 * Mutation hook to update per-mailbox whitelist.
 * Shows toast on success and invalidates settings query.
 */
export function useUpdateWhitelist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ mailboxId, data }: {
      mailboxId: string;
      data: { whitelistedSenders: string[]; whitelistedDomains: string[] };
    }) => updateMailboxWhitelist(mailboxId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Whitelist updated');
    },
    onError: () => {
      toast.error('Failed to update whitelist');
    },
  });
}
