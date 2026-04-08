import { apiFetch } from './client';

export type ReportPeriod =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'ytd';

export interface MailboxCounts {
  email: string;
  deleted: number;
  movedAndRead: number;
  movedOnly: number;
  markedRead: number;
}

export interface ActivityReportResponse {
  mailboxes: MailboxCounts[];
  totals: MailboxCounts | null;
  period: string;
  start: string;
  end: string;
}

export async function fetchActivityReport(period: ReportPeriod): Promise<ActivityReportResponse> {
  return apiFetch<ActivityReportResponse>(`/reports/activity?period=${period}`);
}
