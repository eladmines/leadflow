import {
  apiPaths,
  type Business,
  type CreateSiteRequest,
  type SaveDraftRequest,
  type SiteBusinessInfo,
  type SiteResponse,
} from '@leadflow/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

const paths = apiPaths.site;
export const siteQueryKey = (businessId: string) => ['businesses', businessId, 'site'] as const;

export function useSite(businessId: string) {
  return useQuery({
    queryKey: siteQueryKey(businessId),
    queryFn: () => apiFetch<SiteResponse>(paths.site(businessId)),
    select: (data) => data.site,
    // The editor owns the draft once loaded; don't refetch underneath it.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useCreateSite(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSiteRequest) =>
      apiFetch<SiteResponse>(paths.site(businessId), {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => queryClient.setQueryData(siteQueryKey(businessId), data),
  });
}

/** `keepalive` lets the request finish while the page unloads (closing the tab, reload). */
export function saveDraft(
  businessId: string,
  body: SaveDraftRequest,
  opts: { keepalive?: boolean } = {},
) {
  return apiFetch<SiteResponse>(paths.draft(businessId), {
    method: 'PUT',
    body: JSON.stringify(body),
    keepalive: opts.keepalive,
  });
}

/** The business details the renderer needs (always the live profile, never copied into the draft). */
export function siteBusinessInfo(b: Business): SiteBusinessInfo {
  return {
    name: b.name,
    industry: b.industry,
    phone: b.phone,
    address: b.address,
    serviceAreas: b.serviceAreas,
    openingHours: b.openingHours,
  };
}
