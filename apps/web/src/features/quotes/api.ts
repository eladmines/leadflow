import {
  apiPaths,
  type CreateQuoteRequest,
  type PublicQuoteResponse,
  type Quote,
  type QuoteDisplayStatus,
  type QuoteListQuery,
  type QuoteListResponse,
  type QuoteResponse,
  type UpsertQuoteRequest,
} from '@leadflow/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

const qp = apiPaths.quotes;
export const quotesKey = (businessId: string) => ['businesses', businessId, 'quotes'] as const;

export function useQuotes(businessId: string, query: QuoteListQuery = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) p.set(k, String(v));
  const qs = p.toString();
  return useQuery({
    queryKey: [...quotesKey(businessId), 'list', query],
    queryFn: () => apiFetch<QuoteListResponse>(`${qp.list(businessId)}${qs ? `?${qs}` : ''}`),
    select: (d) => d.quotes,
  });
}

export function useQuote(businessId: string, id: string | null) {
  return useQuery({
    queryKey: [...quotesKey(businessId), 'detail', id],
    queryFn: () => apiFetch<QuoteResponse>(qp.quote(businessId, id!)),
    select: (d) => d.quote,
    enabled: Boolean(id),
  });
}

/** Quote changes show in the lead history too. */
function useQuoteMutation<T>(businessId: string, fn: (vars: T) => Promise<QuoteResponse | void>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      if (data) {
        queryClient.setQueryData([...quotesKey(businessId), 'detail', data.quote.id], data);
      }
      void queryClient.invalidateQueries({ queryKey: [...quotesKey(businessId), 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['businesses', businessId, 'leads'] });
    },
  });
}
const json = (method: string, body?: unknown) => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const useCreateQuote = (businessId: string) =>
  useQuoteMutation(businessId, (body: CreateQuoteRequest) =>
    apiFetch<QuoteResponse>(qp.list(businessId), json('POST', body)),
  );
export const useSaveQuote = (businessId: string) =>
  useQuoteMutation(businessId, ({ id, ...body }: UpsertQuoteRequest & { id: string }) =>
    apiFetch<QuoteResponse>(qp.quote(businessId, id), json('PUT', body)),
  );
export const useSendQuote = (businessId: string) =>
  useQuoteMutation(businessId, ({ id, email }: { id: string; email: boolean }) =>
    apiFetch<QuoteResponse>(qp.send(businessId, id), json('POST', { email })),
  );
export const useDuplicateQuote = (businessId: string) =>
  useQuoteMutation(businessId, (id: string) =>
    apiFetch<QuoteResponse>(qp.duplicate(businessId, id), json('POST')),
  );
export const useDecideQuote = (businessId: string) =>
  useQuoteMutation(businessId, ({ id, status }: { id: string; status: 'ACCEPTED' | 'REJECTED' }) =>
    apiFetch<QuoteResponse>(qp.decide(businessId, id), json('POST', { status })),
  );
export const useDeleteQuote = (businessId: string) =>
  useQuoteMutation(businessId, (id: string) =>
    apiFetch<void>(qp.quote(businessId, id), { method: 'DELETE' }),
  );

export function usePublicQuote(token: string) {
  return useQuery({
    queryKey: ['public-quote', token],
    queryFn: () => apiFetch<PublicQuoteResponse>(qp.publicQuote(token)),
    select: (d) => d.quote,
    retry: false,
  });
}
export function usePublicDecision(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (decision: 'accept' | 'reject') =>
      apiFetch<PublicQuoteResponse>(qp.publicDecision(token), json('POST', { decision })),
    onSuccess: (data) => queryClient.setQueryData(['public-quote', token], data),
  });
}

export const displayStatus = (q: Pick<Quote, 'status' | 'expired'>): QuoteDisplayStatus =>
  q.expired ? 'EXPIRED' : q.status;
export const quoteStatusTone: Record<QuoteDisplayStatus, string> = {
  DRAFT: 'bg-surface-sunken text-ink-muted',
  SENT: 'bg-brand-50 text-brand-800',
  ACCEPTED: 'bg-success-50 text-success-600',
  REJECTED: 'bg-danger-50 text-danger-700',
  EXPIRED: 'bg-warning-50 text-warning-600',
};

/** "120.5" → 12050 agorot; invalid → null. */
export const toAgorot = (shekels: string) => {
  const n = Number(shekels.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
export const fromAgorot = (a: number) => (a % 100 === 0 ? String(a / 100) : (a / 100).toFixed(2));
export const dateFmt = new Intl.DateTimeFormat('he-IL', { dateStyle: 'short' });
