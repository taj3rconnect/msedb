import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchRules,
  createRuleFromPattern,
  updateRule,
  toggleRule,
  runRule,
  reorderRules,
  deleteRule,
} from '@/api/rules';
import type { RulesResponse } from '@/api/rules';

/**
 * TanStack Query hook for fetching rules with optional filters.
 */
export function useRules(params?: {
  mailboxId?: string | null;
  search?: string;
  page?: number;
  limit?: number;
}) {
  return useQuery<RulesResponse>({
    queryKey: ['rules', params?.mailboxId ?? null, params?.search ?? '', params?.page ?? 1, params?.limit ?? 50],
    queryFn: () =>
      fetchRules({
        mailboxId: params?.mailboxId ?? undefined,
        search: params?.search || undefined,
        page: params?.page,
        limit: params?.limit,
      }),
  });
}

/**
 * Mutation hook to create a rule from an approved pattern.
 * Invalidates rules and patterns cache on success.
 */
export function useCreateRuleFromPattern() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patternId: string) => createRuleFromPattern(patternId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      queryClient.invalidateQueries({ queryKey: ['patterns'] });
    },
  });
}

/**
 * Mutation hook to toggle a rule's enabled/disabled state.
 * Invalidates rules cache on success.
 */
export function useToggleRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => toggleRule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
    },
  });
}

/**
 * Mutation hook to reorder rules by priority.
 * Invalidates rules cache on success.
 */
export function useReorderRules() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ mailboxId, ruleIds }: { mailboxId: string; ruleIds: string[] }) =>
      reorderRules(mailboxId, ruleIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
    },
  });
}

/**
 * Mutation hook to rename a rule.
 * Invalidates rules cache on success.
 */
export function useRenameRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      updateRule(id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
    },
  });
}

/**
 * Mutation hook to run a rule against the entire mailbox now.
 * Invalidates rules cache on success (stats update).
 */
export function useRunRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runRule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
    },
  });
}

/**
 * Mutation hook to delete a rule.
 * Invalidates rules cache on success.
 */
export function useDeleteRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteRule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
    },
  });
}
