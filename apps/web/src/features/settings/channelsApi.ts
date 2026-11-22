import {
  apiPaths,
  type ChannelsResponse,
  type ConnectionChannel,
  type ConnectFacebookRequest,
  type ConnectInstagramRequest,
  type ConnectWhatsAppRequest,
  type FacebookPagesResponse,
} from '@simplecatch/shared';
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

/** Instagram: nothing = the connected Facebook Page's account; or the Page picked after sign-in. */
export const useConnectInstagram = (businessId: string) =>
  useChannelMutation(businessId, (body: ConnectInstagramRequest = {}) =>
    apiFetch<ChannelsResponse>(apiPaths.channels.instagram(businessId), {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );

export const useCreateEmailAddress = (businessId: string) =>
  useChannelMutation(businessId, () =>
    apiFetch<ChannelsResponse>(apiPaths.channels.email(businessId), { method: 'POST' }),
  );

export const useDisconnect = (businessId: string) =>
  useChannelMutation(businessId, (channel: ConnectionChannel) =>
    apiFetch<ChannelsResponse>(apiPaths.channels.channel(businessId, channel), {
      method: 'DELETE',
    }),
  );

export function useFacebookStart(
  businessId: string,
  forChannel: 'facebook' | 'instagram' = 'facebook',
) {
  return useMutation({
    mutationFn: () =>
      apiFetch<{ url: string }>(
        `${apiPaths.channels.facebookStart(businessId)}${forChannel === 'instagram' ? '?for=instagram' : ''}`,
      ),
    // Off to Facebook's sign-in; it sends the person back to this tab.
    onSuccess: ({ url }) => window.location.assign(url),
  });
}

/** Gmail (F29): off to Google's consent screen; it sends the person back to this tab. */
export function useGmailStart(businessId: string) {
  return useMutation({
    mutationFn: () => apiFetch<{ url: string }>(apiPaths.channels.gmailStart(businessId)),
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
