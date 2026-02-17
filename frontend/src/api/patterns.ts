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
  page?: number;
  limit?: number;
}): Promise<PatternsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.mailboxId) searchParams.set('mailboxId', params.mailboxId);
  if (params?.status) searchParams.set('status', params.status);
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));
  const qs = searchParams.toString();
  return apiFetch<PatternsResponse>(`/patterns${qs ? `?${qs}` : ''}`);
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
 * Customize a pattern's action and approve it.
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

/**
 * Trigger on-demand pattern analysis.
 */
export async function triggerAnalysis(mailboxId?: string): Promise<{ message: string; jobId: string }> {
  return apiFetch<{ message: string; jobId: string }>('/patterns/analyze', {
    method: 'POST',
    body: mailboxId ? JSON.stringify({ mailboxId }) : undefined,
  });
}
