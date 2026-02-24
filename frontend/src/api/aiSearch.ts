import { apiFetch } from './client';

export interface AiSearchResult {
  id: string;
  score: number;
  messageId: string;
  mailboxId: string;
  senderEmail: string;
  senderName: string;
  subject: string;
  bodySnippet: string;
  receivedAt: string;
  folder: string;
  importance: string;
  hasAttachments: boolean;
  categories: string[];
  isRead: boolean;
}

export interface ParsedSearchQuery {
  senderFilter?: string;
  senderDomainFilter?: string;
  dateFrom?: string;
  dateTo?: string;
  folderFilter?: string;
  importanceFilter?: string;
  hasAttachments?: boolean;
  semanticQuery: string;
  originalQuery: string;
}

export interface AiSearchResponse {
  results: AiSearchResult[];
  parsedQuery: ParsedSearchQuery;
  timing: {
    parseMs: number;
    embedMs: number;
    searchMs: number;
    totalMs: number;
  };
}

export interface AiSearchStatus {
  qdrant: { healthy: boolean; pointCount: number };
  ollama: { embed: boolean; instruct: boolean };
}

export function aiSearch(query: string, mailboxId?: string, limit?: number): Promise<AiSearchResponse> {
  return apiFetch<AiSearchResponse>('/ai-search', {
    method: 'POST',
    body: JSON.stringify({ query, mailboxId, limit }),
  });
}

export function aiSearchStatus(): Promise<AiSearchStatus> {
  return apiFetch<AiSearchStatus>('/ai-search/status');
}

export function triggerBackfill(mailboxId: string): Promise<{ jobId: string }> {
  return apiFetch<{ jobId: string }>('/ai-search/backfill', {
    method: 'POST',
    body: JSON.stringify({ mailboxId }),
  });
}
