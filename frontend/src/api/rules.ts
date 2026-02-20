import { apiFetch } from './client';

// --- Types (mirror backend Rule model) ---

export interface RuleConditions {
  senderEmail?: string | string[];
  senderDomain?: string;
  subjectContains?: string;
  bodyContains?: string;
  fromFolder?: string;
}

export interface RuleAction {
  actionType: 'move' | 'delete' | 'markRead' | 'flag' | 'categorize' | 'archive';
  toFolder?: string;
  category?: string;
  order?: number;
}

export interface RuleStats {
  totalExecutions: number;
  lastExecutedAt?: string;
  emailsProcessed: number;
}

export interface Rule {
  _id: string;
  userId: string;
  mailboxId: string;
  name: string;
  sourcePatternId?: string;
  isEnabled: boolean;
  priority: number;
  conditions: RuleConditions;
  actions: RuleAction[];
  stats: RuleStats;
  graphRuleId?: string;
  scope: 'user' | 'org';
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RulesResponse {
  rules: Rule[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// --- API functions ---

/**
 * Fetch paginated rules with optional mailbox filter.
 */
export async function fetchRules(params?: {
  mailboxId?: string;
  search?: string;
  page?: number;
  limit?: number;
}): Promise<RulesResponse> {
  const searchParams = new URLSearchParams();
  if (params?.mailboxId) searchParams.set('mailboxId', params.mailboxId);
  if (params?.search) searchParams.set('search', params.search);
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));
  const qs = searchParams.toString();
  return apiFetch<RulesResponse>(`/rules${qs ? `?${qs}` : ''}`);
}

/**
 * Create a rule from an approved pattern.
 */
export async function createRuleFromPattern(patternId: string): Promise<{ rule: Rule }> {
  return apiFetch<{ rule: Rule }>('/rules/from-pattern', {
    method: 'POST',
    body: JSON.stringify({ patternId }),
  });
}

/**
 * Create a manual rule (not from pattern).
 */
export async function createRule(data: {
  mailboxId: string;
  name: string;
  conditions: RuleConditions;
  actions: RuleAction[];
}): Promise<{ rule: Rule }> {
  return apiFetch<{ rule: Rule }>('/rules', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Update a rule (name, conditions, actions).
 */
export async function updateRule(
  id: string,
  data: Partial<Pick<Rule, 'name' | 'conditions' | 'actions'>>,
): Promise<{ rule: Rule }> {
  return apiFetch<{ rule: Rule }>(`/rules/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/**
 * Toggle a rule's enabled/disabled state.
 */
export async function toggleRule(id: string): Promise<{ rule: Rule }> {
  return apiFetch<{ rule: Rule }>(`/rules/${id}/toggle`, {
    method: 'PATCH',
  });
}

/**
 * Reorder rules by priority via drag-and-drop.
 */
export async function reorderRules(
  mailboxId: string,
  ruleIds: string[],
): Promise<void> {
  return apiFetch<void>('/rules/reorder', {
    method: 'PUT',
    body: JSON.stringify({ mailboxId, ruleIds }),
  });
}

/**
 * Run a rule against the entire mailbox now.
 * Returns stats: matched, applied, failed.
 */
export async function runRule(id: string): Promise<{ matched: number; applied: number; failed: number }> {
  return apiFetch<{ matched: number; applied: number; failed: number }>(`/rules/${id}/run`, {
    method: 'POST',
  });
}

/**
 * Delete a rule.
 */
export async function deleteRule(id: string): Promise<void> {
  return apiFetch<void>(`/rules/${id}`, {
    method: 'DELETE',
  });
}
