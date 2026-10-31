import {
  apiPaths,
  type SendWhatsAppRequest,
  type SendWhatsAppResponse,
  type WhatsAppThreadResponse,
} from '@leadflow/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

const threadKey = (businessId: string, leadId: string) =>
  ['businesses', businessId, 'whatsapp', leadId] as const;

/** The WhatsApp conversation on a lead. Customer replies arrive by webhook, so poll while open. */
export function useWhatsAppThread(businessId: string, leadId: string) {
  return useQuery({
    queryKey: threadKey(businessId, leadId),
    queryFn: () => apiFetch<WhatsAppThreadResponse>(apiPaths.whatsapp.thread(businessId, leadId)),
    refetchInterval: (query) => (query.state.data?.connected ? 15_000 : false),
    refetchOnWindowFocus: true,
  });
}

export function useSendWhatsApp(businessId: string, leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SendWhatsAppRequest) =>
      apiFetch<SendWhatsAppResponse>(apiPaths.whatsapp.thread(businessId, leadId), {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: threadKey(businessId, leadId) }),
  });
}
