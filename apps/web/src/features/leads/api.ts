import {
  apiPaths,
  type AddNoteRequest,
  type CreateLeadRequest,
  type DuplicatesResponse,
  type Lead,
  type LeadDetailResponse,
  type LeadListQuery,
  type LeadListResponse,
  type LeadResponse,
  type PipelineResponse,
  type UpdateLeadRequest,
} from '@leadflow/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

const lp = apiPaths.leads;

export const leadsQueryKey = (businessId: string) => ['businesses', businessId, 'leads'] as const;
const leadListKey = (businessId: string, query: LeadListQuery) =>
  [...leadsQueryKey(businessId), 'list', query] as const;
const leadDetailKey = (businessId: string, leadId: string) =>
  [...leadsQueryKey(businessId), 'detail', leadId] as const;

function toQueryString(query: LeadListQuery) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, String(v));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function useLeads(businessId: string, query: LeadListQuery = {}) {
  return useQuery({
    queryKey: leadListKey(businessId, query),
    queryFn: () => apiFetch<LeadListResponse>(`${lp.list(businessId)}${toQueryString(query)}`),
    select: (data) => data.leads,
    placeholderData: keepPreviousData,
    // New website leads arrive without any action in the app; refresh in the background.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function usePipeline(businessId: string) {
  return useQuery({
    queryKey: ['businesses', businessId, 'pipeline'],
    queryFn: () => apiFetch<PipelineResponse>(lp.pipeline(businessId)),
    select: (data) => data.stages,
    staleTime: 5 * 60_000,
  });
}

export function useLeadDetail(businessId: string, leadId: string) {
  return useQuery({
    queryKey: leadDetailKey(businessId, leadId),
    queryFn: () => apiFetch<LeadDetailResponse>(lp.detail(businessId, leadId)),
    retry: false,
  });
}

export function useCreateLead(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateLeadRequest) =>
      apiFetch<LeadResponse>(lp.list(businessId), { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: leadsQueryKey(businessId) }),
  });
}

/**
 * Updates a lead. Stage moves are applied optimistically to every cached list (the board feels
 * instant) and rolled back if the server refuses.
 */
export function useUpdateLead(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      leadId,
      body,
    }: {
      leadId: string;
      body: UpdateLeadRequest;
      stage?: Lead['stage'];
    }) =>
      apiFetch<LeadResponse>(lp.detail(businessId, leadId), {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onMutate: async ({ leadId, stage }) => {
      if (!stage) return undefined;
      const key = [...leadsQueryKey(businessId), 'list'];
      await queryClient.cancelQueries({ queryKey: key });
      const snapshot = queryClient.getQueriesData<LeadListResponse>({ queryKey: key });
      queryClient.setQueriesData<LeadListResponse>({ queryKey: key }, (old) =>
        old ? { leads: old.leads.map((l) => (l.id === leadId ? { ...l, stage } : l)) } : old,
      );
      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      for (const [key, data] of context?.snapshot ?? []) queryClient.setQueryData(key, data);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: leadsQueryKey(businessId) }),
  });
}

export function useAddNote(businessId: string, leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AddNoteRequest) =>
      apiFetch(lp.notes(businessId, leadId), { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: leadDetailKey(businessId, leadId) }),
  });
}

export function useDuplicates(businessId: string, phone: string, email: string, enabled: boolean) {
  const params = new URLSearchParams();
  if (phone) params.set('phone', phone);
  if (email) params.set('email', email);
  return useQuery({
    queryKey: ['businesses', businessId, 'duplicates', phone, email],
    queryFn: () => apiFetch<DuplicatesResponse>(`${lp.duplicates(businessId)}?${params}`),
    select: (data) => data.contacts,
    enabled: enabled && Boolean(phone || email),
    staleTime: 30_000,
  });
}

const dateFmt = new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium', timeStyle: 'short' });
export const formatDateTime = (iso: string) => dateFmt.format(new Date(iso));
export const shekel = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  maximumFractionDigits: 0,
});

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
