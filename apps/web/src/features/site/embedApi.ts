import { apiPaths, type EmbedInfo } from '@simplecatch/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

/** F30: the script tag for a website built elsewhere. */
export function useEmbedInfo(businessId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['businesses', businessId, 'embed'],
    queryFn: () => apiFetch<EmbedInfo>(apiPaths.embed.info(businessId)),
    enabled,
    staleTime: Infinity,
  });
}
