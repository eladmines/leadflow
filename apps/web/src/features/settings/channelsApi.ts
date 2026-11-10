import {
  apiPaths,
  type Channel,
  type ChannelsResponse,
  type ConnectFacebookRequest,
  type ConnectWhatsAppRequest,
  type FacebookPagesResponse,
} from '@leadflow/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

/** F25 (D-159): Settings → Channels. */
const channelsKey = (businessId: string) => ['businesses', businessId, 'channels'] as const;

export function useChannels(businessId: string) {
  return useQuery({
    queryKey: channelsKey(businessId),
    queryFn: () => apiFetch<ChannelsResponse>(apiPaths.channels.list(businessId)),
  });
}

/** Any change: the screen, and everything that shows "connected", refresh. */
function useChannelMutation<T>(businessId: string, fn: (body: T) => Promise<ChannelsResponse>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      queryClient.setQueryData(channelsKey(businessId), data);
      void queryClient.invalidateQueries({ queryKey: ['businesses', businessId, 'conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['businesses', businessId, 'whatsapp'] });
    },
  });
}

export const useConnectWhatsApp = (businessId: string) =>
  useChannelMutation(businessId, (body: ConnectWhatsAppRequest) =>
    apiFetch<ChannelsResponse>(apiPaths.channels.whatsapp(businessId), {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );

export const useConnectFacebook = (businessId: string) =>
  useChannelMutation(businessId, (body: ConnectFacebookRequest) =>
    apiFetch<ChannelsResponse>(apiPaths.channels.facebook(businessId), {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );

export const useCreateEmailAddress = (businessId: string) =>
  useChannelMutation(businessId, () =>
    apiFetch<ChannelsResponse>(apiPaths.channels.email(businessId), { method: 'POST' }),
  );

export const useDisconnect = (businessId: string) =>
  useChannelMutation(businessId, (channel: Channel) =>
    apiFetch<ChannelsResponse>(apiPaths.channels.channel(businessId, channel), {
      method: 'DELETE',
    }),
  );

export function useFacebookStart(businessId: string) {
  return useMutation({
    mutationFn: () => apiFetch<{ url: string }>(apiPaths.channels.facebookStart(businessId)),
    // Off to Facebook's sign-in; it sends the person back to this tab.
    onSuccess: ({ url }) => window.location.assign(url),
  });
}

export function useFacebookPages(businessId: string, pendingId: string | null) {
  return useQuery({
    queryKey: [...channelsKey(businessId), 'pending', pendingId],
    queryFn: () =>
      apiFetch<FacebookPagesResponse>(apiPaths.channels.facebookPages(businessId, pendingId!)),
    enabled: Boolean(pendingId),
    retry: false,
  });
}
