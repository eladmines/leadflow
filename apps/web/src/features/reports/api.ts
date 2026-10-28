import { apiPaths, type ReportSummary } from '@leadflow/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

export function useReportSummary(businessId: string, days: number) {
  return useQuery({
    queryKey: ['businesses', businessId, 'reports', days] as const,
    queryFn: () => apiFetch<ReportSummary>(`${apiPaths.reports.summary(businessId)}?days=${days}`),
    // Switching ranges keeps the old numbers on screen instead of flashing a spinner.
    placeholderData: keepPreviousData,
  });
}

/** `2026-10-28` → `28.10` */
export const shortDate = (ymd: string) => {
  const [, m, d] = ymd.split('-');
  return `${Number(d)}.${Number(m)}`;
};

/** Minutes → a short Hebrew duration ("45 דק׳", "3.5 שע׳", "2 ימים"). */
export function durationLabel(minutes: number) {
  if (minutes < 60) return `${Math.round(minutes)} דק׳`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours * 10) / 10} שע׳`;
  const days = Math.round((hours / 24) * 10) / 10;
  return days === 1 ? 'יום אחד' : `${days} ימים`;
}
