import { apiFetch } from './client';

// --- Types (mirror backend Pattern model) ---

export interface PatternCondition {
  senderEmail?: string;
  senderDomain?: string;
  fromFolder?: string;
  subjectPattern?: string;
}

export interface PatternSuggestedAction {
  actionType: 'delete' | 'move' | 'archive' | 'markRead' | 'flag' | 'categorize';
  toFolder?: string;
  category?: string;
}

export interface PatternEvidence {
  messageId: string;
  timestamp: string;
  action: string;
}

export interface Pattern {
  _id: string;
  userId: string;
  mailboxId: string;
  patternType: 'sender' | 'folder-routing';
  status: 'detected' | 'suggested' | 'approved' | 'rejected' | 'expired';
  confidence: number;
  sampleSize: number;
  exceptionCount: number;
  condition: PatternCondition;
  suggestedAction: PatternSuggestedAction;
  evidence: PatternEvidence[];
  rejectedAt?: string;
  rejectionCooldownUntil?: string;
  approvedAt?: string;
  lastAnalyzedAt?: string;
  createdAt: string;
  updatedAt: string;
  hasRule?: boolean;
  ruleId?: string | null;
}

export interface PatternsResponse {
  patterns: Pattern[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// --- API functions ---

/**
 * Fetch paginated patterns with optional filters.
 */
export async function fetchPatterns(params?: {
  mailboxId?: string;
  status?: string;
  hasRule?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}): Promise<PatternsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.mailboxId) searchParams.set('mailboxId', params.mailboxId);
  if (params?.status) searchParams.set('status', params.status);
  if (params?.hasRule !== undefined) searchParams.set('hasRule', String(params.hasRule));
  if (params?.search) searchParams.set('search', params.search);
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));
  const qs = searchParams.toString();
  return apiFetch<PatternsResponse>(`/patterns${qs ? `?${qs}` : ''}`);
}

/** Max pages walked by fetchAllPatterns — guards against an unbounded loop. */
const ALL_PATTERNS_PAGE_LIMIT = 100;
const ALL_PATTERNS_MAX_PAGES = 20;

/**
 * Fetch every pattern matching the given filters by walking the paginated
 * endpoint. Used by the bulk-rule drawer, which must operate on the whole
 * filtered result set rather than the page currently on screen.
 *
 * Caps at ALL_PATTERNS_MAX_PAGES pages; `truncated` reports when the cap was hit.
 */
export async function fetchAllPatterns(params?: {
  mailboxId?: string;
  status?: string;
  hasRule?: boolean;
  search?: string;
}): Promise<{ patterns: Pattern[]; total: number; truncated: boolean }> {
  const collected: Pattern[] = [];
  let page = 1;
  let total = 0;

  for (; page <= ALL_PATTERNS_MAX_PAGES; page++) {
    const res = await fetchPatterns({ ...params, page, limit: ALL_PATTERNS_PAGE_LIMIT });
    total = res.pagination.total;
    collected.push(...res.patterns);
    if (page >= res.pagination.totalPages || res.patterns.length === 0) {
      return { patterns: collected, total, truncated: false };
    }
  }

  return { patterns: collected, total, truncated: true };
}

// --- Typeahead ---

export interface SenderSuggestion {
  value: string;
  type: 'email' | 'domain';
  count: number;
}

/**
 * Typeahead suggestions for sender email / domain, matched in the database.
 */
export async function suggestSenders(q: string, mailboxId?: string): Promise<SenderSuggestion[]> {
  const searchParams = new URLSearchParams({ q });
  if (mailboxId) searchParams.set('mailboxId', mailboxId);
  const data = await apiFetch<{ suggestions: SenderSuggestion[] }>(
    `/patterns/suggest?${searchParams.toString()}`,
  );
  return data.suggestions;
}

// --- Bulk rule creation ---

export type BulkRuleAction = 'delete' | 'markRead';

export interface BulkApproveResult {
  /** Patterns that gained a rule they did not have. */
  created: number;
  /** Already-approved patterns whose rule was rebuilt on the new action. */
  updated: number;
  skipped: number;
  failed: number;
  total: number;
  results: Array<{
    patternId: string;
    status: 'created' | 'updated' | 'skipped' | 'failed';
    ruleId?: string;
    reason?: string;
  }>;
}

/**
 * Apply one action to many patterns at once, whatever state each is in —
 * creating rules for un-approved ones and rebuilding the rule for approved ones.
 * Only ever called from an explicit user click in the bulk-rule drawer.
 */
export async function bulkApprovePatterns(
  patternIds: string[],
  actionType: BulkRuleAction,
): Promise<BulkApproveResult> {
  return apiFetch<BulkApproveResult>('/patterns/bulk-approve', {
    method: 'POST',
    body: JSON.stringify({ patternIds, actionType }),
  });
}

// --- Permanent suppression ---

export type SuppressScope = 'sender' | 'domain';

export interface SuppressResult {
  suppressed: number;
  values: string[];
  patternsRejected: number;
  mailboxesUpdated: number;
  skipped: Array<{ patternId: string; reason: string }>;
}

/**
 * Permanently silence the senders behind these patterns — they are added to the
 * mailbox whitelist, so pattern analysis never suggests a rule for them again.
 * Existing rules are not deleted; they simply stop firing.
 */
export async function bulkSuppressPatterns(
  patternIds: string[],
  scope: SuppressScope = 'sender',
): Promise<SuppressResult> {
  return apiFetch<SuppressResult>('/patterns/bulk-suppress', {
    method: 'POST',
    body: JSON.stringify({ patternIds, scope }),
  });
}

/**
 * Approve a pattern suggestion.
 */
export async function approvePattern(patternId: string): Promise<Pattern> {
  return apiFetch<Pattern>(`/patterns/${patternId}/approve`, {
    method: 'POST',
  });
}

/**
 * Reject a pattern suggestion (triggers 30-day cooldown).
 */
export async function rejectPattern(patternId: string): Promise<Pattern> {
  return apiFetch<Pattern>(`/patterns/${patternId}/reject`, {
    method: 'POST',
  });
}

/**
 * Undo an approval: the pattern returns to Suggested and the rule it created is
 * deleted, so nothing keeps acting on that sender.
 */
export async function unapprovePattern(
  patternId: string,
): Promise<{ pattern: Pattern; rulesDeleted: number }> {
  return apiFetch<{ pattern: Pattern; rulesDeleted: number }>(
    `/patterns/${patternId}/unapprove`,
    { method: 'POST' },
  );
}

/**
 * Set a pattern's action and approve it. Also accepts an already-approved
 * pattern, in which case its rule is rebuilt on the new action.
 */
export async function customizePattern(
  patternId: string,
  action: PatternSuggestedAction,
): Promise<Pattern> {
  return apiFetch<Pattern>(`/patterns/${patternId}/customize`, {
    method: 'POST',
    body: JSON.stringify({ suggestedAction: action }),
  });
}

// --- Preview message types ---

export interface PreviewMessage {
  id: string;
  subject: string;
  from: { emailAddress: { name: string; address: string } };
  receivedDateTime: string;
  bodyPreview: string;
  _fromDeletedItems?: boolean;
}

export interface PreviewMessageFull extends PreviewMessage {
  body: { contentType: string; content: string };
  toRecipients?: { emailAddress: { name: string; address: string } }[];
}

/**
 * Fetch recent messages matching a pattern's sender.
 */
export async function fetchPatternMessages(patternId: string): Promise<PreviewMessage[]> {
  const data = await apiFetch<{ messages: PreviewMessage[] }>(`/patterns/${patternId}/messages`);
  return data.messages;
}

/**
 * Fetch a single message with full body for preview.
 */
export async function fetchPatternMessage(patternId: string, messageId: string): Promise<PreviewMessageFull> {
  const data = await apiFetch<{ message: PreviewMessageFull }>(`/patterns/${patternId}/messages/${messageId}`);
  return data.message;
}

/**
 * Trigger on-demand pattern analysis.
 */
export async function triggerAnalysis(mailboxId?: string): Promise<{ message: string; jobId: string }> {
  return apiFetch<{ message: string; jobId: string }>('/patterns/analyze', {
    method: 'POST',
    body: mailboxId ? JSON.stringify({ mailboxId }) : undefined,
  });
}
