import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  fetchAdminUsers,
  inviteUser,
  changeUserRole,
  deactivateUser,
  fetchAnalytics,
  fetchSystemHealth,
  fetchOrgRules,
  createOrgRule,
  deleteOrgRule,
} from '@/api/admin';
import type {
  AdminUser,
  AdminAnalytics,
  SystemHealth,
  OrgRule,
} from '@/api/admin';
import { ApiError } from '@/api/client';

/**
 * TanStack Query hook for fetching all admin users.
 */
export function useAdminUsers() {
  return useQuery<AdminUser[]>({
    queryKey: ['admin-users'],
    queryFn: fetchAdminUsers,
  });
}

/**
 * Mutation hook to invite a new user by email.
 * Shows toast on success. Handles 409 conflict for duplicate invites.
 */
export function useInviteUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ email, role }: { email: string; role?: string }) =>
      inviteUser(email, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('User invited');
    },
    onError: (error: Error) => {
      if (error instanceof ApiError && error.status === 409) {
        toast.error('User already exists');
      } else {
        toast.error('Failed to invite user');
      }
    },
  });
}

/**
 * Mutation hook to change a user's role.
 */
export function useChangeRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      changeUserRole(userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('Role updated');
    },
    onError: () => {
      toast.error('Failed to change role');
    },
  });
}

/**
 * Mutation hook to deactivate a user.
 */
export function useDeactivateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => deactivateUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('User deactivated');
    },
    onError: () => {
      toast.error('Failed to deactivate user');
    },
  });
}

/**
 * TanStack Query hook for fetching aggregate analytics.
 */
export function useAdminAnalytics() {
  return useQuery<AdminAnalytics>({
    queryKey: ['admin-analytics'],
    queryFn: fetchAnalytics,
  });
}

/**
 * TanStack Query hook for system health data.
 * Auto-refreshes every 60 seconds.
 */
export function useSystemHealth() {
  return useQuery<SystemHealth>({
    queryKey: ['admin-health'],
    queryFn: fetchSystemHealth,
    refetchInterval: 60_000,
  });
}

/**
 * TanStack Query hook for fetching org-wide rules.
 */
export function useOrgRules() {
  return useQuery<OrgRule[]>({
    queryKey: ['admin-org-rules'],
    queryFn: fetchOrgRules,
  });
}

/**
 * Mutation hook to create an org-wide rule.
 */
export function useCreateOrgRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      name: string;
      conditions: object;
      actions: object[];
      priority?: number;
    }) => createOrgRule(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-org-rules'] });
      toast.success('Org rule created');
    },
    onError: () => {
      toast.error('Failed to create org rule');
    },
  });
}

/**
 * Mutation hook to delete an org-wide rule.
 */
export function useDeleteOrgRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteOrgRule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-org-rules'] });
      toast.success('Org rule deleted');
    },
    onError: () => {
      toast.error('Failed to delete org rule');
    },
  });
}
