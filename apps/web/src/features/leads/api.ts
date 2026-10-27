import { apiPaths, type LeadListResponse } from '@leadflow/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

export const leadsQueryKey = (businessId: string) => ['businesses', businessId, 'leads'] as const;

export function useLeads(businessId: string) {
  return useQuery({
    queryKey: leadsQueryKey(businessId),
    queryFn: () => apiFetch<LeadListResponse>(apiPaths.leads.list(businessId)),
    select: (data) => data.leads,
    // New website leads arrive without any action in the app; refresh in the background.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

const dateFmt = new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * "לפני 5 דקות" for the last week, a full date after that. Hand-written because some ICU builds
 * render Hebrew duals as "שעתיים (2)".
 */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'עכשיו';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60)
    return minutes === 1 ? 'לפני דקה' : minutes === 2 ? 'לפני 2 דקות' : `לפני ${minutes} דקות`;
  const hours = Math.round(seconds / 3600);
  if (hours < 24)
    return hours === 1 ? 'לפני שעה' : hours === 2 ? 'לפני שעתיים' : `לפני ${hours} שעות`;
  const days = Math.round(seconds / 86_400);
  if (days < 7) return days === 1 ? 'אתמול' : days === 2 ? 'שלשום' : `לפני ${days} ימים`;
  return dateFmt.format(new Date(iso));
}
