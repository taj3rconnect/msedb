import { apiFetch } from './client';

export interface TrackingMatch {
  trackingId: string;
  openCount: number;
  firstOpenedAt?: string;
  lastOpenedAt?: string;
}

export interface TrackingDetail {
  trackingId: string;
  subject?: string;
  recipients: string[];
  sentAt: string;
  openCount: number;
  firstOpenedAt?: string;
  lastOpenedAt?: string;
  opens: Array<{
    timestamp: string;
    ip?: string;
    userAgent?: string;
    device?: string;
    browser?: string;
    os?: string;
    country?: string;
    city?: string;
  }>;
}

/**
 * Batch lookup tracking data for sent items.
 * Returns a map keyed by "mailboxId:subject:sentAt".
 */
export async function batchLookupTracking(
  items: Array<{ mailboxId: string; subject?: string; sentAt: string }>,
): Promise<Record<string, TrackingMatch>> {
  if (items.length === 0) return {};
  const { results } = await apiFetch<{ results: Record<string, TrackingMatch> }>(
    '/tracking/batch',
    {
      method: 'POST',
      body: JSON.stringify({ items }),
    },
  );
  return results;
}

/**
 * Fetch detailed open data for a single tracked email.
 */
export async function fetchTrackedDetail(
  trackingId: string,
): Promise<TrackingDetail> {
  return apiFetch<TrackingDetail>(`/tracking/${trackingId}`);
}
