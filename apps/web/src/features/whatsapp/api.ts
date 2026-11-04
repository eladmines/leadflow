import {
  apiPaths,
  type ClassifyNumberRequest,
  type ClassifyNumberResponse,
  type PersonalNumbersResponse,
  type SendWhatsAppRequest,
  type SendWhatsAppResponse,
  type WhatsAppBotResponse,
  type WhatsAppBotSettings,
  type WhatsAppInboxResponse,
  type WhatsAppThreadResponse,
} from '@leadflow/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

const whatsappKey = (businessId: string) => ['businesses', businessId, 'whatsapp'] as const;
const threadKey = (businessId: string, leadId: string) =>
  [...whatsappKey(businessId), leadId] as const;
const inboxKey = (businessId: string) => [...whatsappKey(businessId), 'inbox'] as const;
const personalKey = (businessId: string) => [...whatsappKey(businessId), 'personal'] as const;
const botKey = (businessId: string) => [...whatsappKey(businessId), 'bot'] as const;

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

/** Pause or resume the booking bot for this lead's customer (D-108). */
export function usePauseBot(businessId: string, leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (paused: boolean) =>
      apiFetch<void>(apiPaths.whatsapp.botPause(businessId, leadId), {
        method: 'PUT',
        body: JSON.stringify({ paused }),
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: threadKey(businessId, leadId) }),
  });
}

/** Numbers nobody has classified yet, with their waiting messages (D-092). */
export function useWhatsAppInbox(businessId: string, enabled = true) {
  return useQuery({
    queryKey: inboxKey(businessId),
    queryFn: () => apiFetch<WhatsAppInboxResponse>(apiPaths.whatsapp.inbox(businessId)),
    enabled,
    refetchInterval: (query) => (query.state.data?.connected ? 15_000 : false),
    refetchOnWindowFocus: true,
  });
}

export function usePersonalNumbers(businessId: string) {
  return useQuery({
    queryKey: personalKey(businessId),
    queryFn: () => apiFetch<PersonalNumbersResponse>(apiPaths.whatsapp.personal(businessId)),
    select: (d) => d.numbers,
  });
}

export function useClassifyNumber(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ numberId, as }: { numberId: string } & ClassifyNumberRequest) =>
      apiFetch<ClassifyNumberResponse>(apiPaths.whatsapp.classify(businessId, numberId), {
        method: 'POST',
        body: JSON.stringify({ as }),
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: whatsappKey(businessId) });
      void queryClient.invalidateQueries({ queryKey: ['businesses', businessId, 'leads'] });
    },
  });
}

/** Undoes a personal marking. */
export function useForgetPersonal(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (numberId: string) =>
      apiFetch<void>(apiPaths.whatsapp.number(businessId, numberId), { method: 'DELETE' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: whatsappKey(businessId) }),
  });
}

/** Booking bot settings (D-102). */
export function useBotSettings(businessId: string) {
  return useQuery({
    queryKey: botKey(businessId),
    queryFn: () => apiFetch<WhatsAppBotResponse>(apiPaths.whatsapp.bot(businessId)),
  });
}

export function useUpdateBotSettings(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: WhatsAppBotSettings) =>
      apiFetch<WhatsAppBotResponse>(apiPaths.whatsapp.bot(businessId), {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => queryClient.setQueryData(botKey(businessId), data),
  });
}
