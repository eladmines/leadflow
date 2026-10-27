import {
  apiPaths,
  type Business,
  type CreateSiteRequest,
  type PublishRequest,
  type SaveDraftRequest,
  type SetSubdomainRequest,
  type SiteBusinessInfo,
  type SiteResponse,
  type SiteVersionListResponse,
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

// ---------------------------------------------------------------------------
// F06 — publishing
// ---------------------------------------------------------------------------

export const versionsQueryKey = (businessId: string) =>
  [...siteQueryKey(businessId), 'versions'] as const;

/** Mutations that return the site update the cached site (status, live version, address). */
function useSiteMutation<TBody>(
  businessId: string,
  request: (body: TBody) => Promise<SiteResponse>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (data) => {
      queryClient.setQueryData(siteQueryKey(businessId), data);
      void queryClient.invalidateQueries({ queryKey: versionsQueryKey(businessId) });
    },
  });
}

const send = (method: 'PUT' | 'POST', path: string, body?: unknown) =>
  apiFetch<SiteResponse>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const useSetSubdomain = (businessId: string) =>
  useSiteMutation(businessId, (body: SetSubdomainRequest) =>
    send('PUT', paths.subdomain(businessId), body),
  );

export const usePublish = (businessId: string) =>
  useSiteMutation(businessId, (body: PublishRequest) =>
    send('POST', paths.publish(businessId), body),
  );

export const useUnpublish = (businessId: string) =>
  useSiteMutation(businessId, () => send('POST', paths.unpublish(businessId)));

export const useRollback = (businessId: string) =>
  useSiteMutation(businessId, (versionId: string) =>
    send('POST', paths.rollback(businessId, versionId)),
  );

export function useVersions(businessId: string, enabled: boolean) {
  return useQuery({
    queryKey: versionsQueryKey(businessId),
    queryFn: () => apiFetch<SiteVersionListResponse>(paths.versions(businessId)),
    select: (data) => data.versions,
    enabled,
  });
}
