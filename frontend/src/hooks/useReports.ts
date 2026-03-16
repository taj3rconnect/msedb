import { useQuery } from '@tanstack/react-query';
import { fetchActivityReport, type ReportPeriod, type ActivityReportResponse } from '@/api/reports';

export function useActivityReport(period: ReportPeriod) {
  return useQuery<ActivityReportResponse>({
    queryKey: ['reports', 'activity', period],
    queryFn: () => fetchActivityReport(period),
  });
}
