import { apiFetch } from './client';

// --- Types ---

export interface AuditLogEntry {
  id: string;
  userId: string;
  mailboxId: string;
  action: string;
  targetType: string;
  targetId: string;
  details: Record<string, unknown>;
  undoable: boolean;
  undoneAt: string | null;
  undoneBy: string | null;
  createdAt: string;
}

export interface AuditResponse {
  auditLogs: AuditLogEntry[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// --- API functions ---

/**
 * Fetch paginated audit logs with optional filters.
 */
export async function fetchAuditLogs(params?: {
  mailboxId?: string;
  ruleId?: string;
  action?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}): Promise<AuditResponse> {
  const searchParams = new URLSearchParams();
  if (params?.mailboxId) searchParams.set('mailboxId', params.mailboxId);
  if (params?.ruleId) searchParams.set('ruleId', params.ruleId);
  if (params?.action) searchParams.set('action', params.action);
  if (params?.startDate) searchParams.set('startDate', params.startDate);
  if (params?.endDate) searchParams.set('endDate', params.endDate);
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));
  const qs = searchParams.toString();
  return apiFetch<AuditResponse>(`/audit${qs ? `?${qs}` : ''}`);
}

/**
 * Undo an audit action (reverses the original action if possible).
 */
export async function undoAuditAction(
  id: string,
): Promise<{ auditLog: AuditLogEntry }> {
  return apiFetch<{ auditLog: AuditLogEntry }>(`/audit/${id}/undo`, {
    method: 'POST',
  });
}
