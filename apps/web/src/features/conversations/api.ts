import {
  apiPaths,
  type Channel,
  type ConversationFilter,
  type ConversationListResponse,
  type ConversationResponse,
  type SendWhatsAppRequest,
  type SendWhatsAppResponse,
} from '@leadflow/shared';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

/** F24 unified inbox (D-158). Messages arrive by webhook, so the inbox polls while it's open. */
const inboxKey = (businessId: string) => ['businesses', businessId, 'conversations'] as const;
const listKey = (businessId: string, filter: ConversationFilter, channel?: Channel) =>
  [...inboxKey(businessId), 'list', filter, channel ?? 'all'] as const;
const detailKey = (businessId: string, id: string) =>
  [...inboxKey(businessId), 'detail', id] as const;
const unreadKey = (businessId: string) => [...inboxKey(businessId), 'unread'] as const;

/** After a change, the list, the open conversation and the badge all refresh. */
export const refreshInbox = (queryClient: QueryClient, businessId: string) =>
  queryClient.invalidateQueries({ queryKey: inboxKey(businessId) });

export function useConversations(
  businessId: string,
  filter: ConversationFilter,
  channel?: Channel,
) {
  return useInfiniteQuery({
    queryKey: listKey(businessId, filter, channel),
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams({ filter });
      if (channel) q.set('channel', channel);
      if (pageParam) q.set('cursor', pageParam);
      return apiFetch<ConversationListResponse>(`${apiPaths.conversations.list(businessId)}?${q}`);
    },
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function useConversation(businessId: string, id: string | null) {
  return useQuery({
    queryKey: detailKey(businessId, id ?? ''),
    queryFn: () => apiFetch<ConversationResponse>(apiPaths.conversations.detail(businessId, id!)),
    enabled: Boolean(id),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
}

/** Unread conversations for the menu badge (owners and managers only). */
export function useUnreadConversations(businessId: string, enabled: boolean) {
  return useQuery({
    queryKey: unreadKey(businessId),
    queryFn: () => apiFetch<{ unreadCount: number }>(apiPaths.conversations.unread(businessId)),
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useMarkRead(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(apiPaths.conversations.read(businessId, id), { method: 'POST' }),
    onSuccess: () => refreshInbox(queryClient, businessId),
  });
}

export function useReply(businessId: string, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SendWhatsAppRequest) =>
      apiFetch<SendWhatsAppResponse>(apiPaths.conversations.messages(businessId, id), {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => refreshInbox(queryClient, businessId),
  });
}
