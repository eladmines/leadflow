import { apiPaths, type Asset, type AssetListResponse, type MediaMap } from '@leadflow/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiFetch } from '../../lib/api';

const mp = apiPaths.media;
export const assetsQueryKey = (businessId: string) => ['businesses', businessId, 'assets'] as const;

export function useAssets(businessId: string) {
  return useQuery({
    queryKey: assetsQueryKey(businessId),
    queryFn: () => apiFetch<AssetListResponse>(mp.assets(businessId)),
  });
}

/** id → url/size, for rendering the preview with the same images the server will publish. */
export function useMediaMap(businessId: string): MediaMap {
  const assets = useAssets(businessId).data?.assets;
  return useMemo(
    () =>
      Object.fromEntries(
        (assets ?? []).map((a) => [a.id, { url: a.url, width: a.width, height: a.height }]),
      ),
    [assets],
  );
}

export function useUploadAsset(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return apiFetch<{ asset: Asset }>(mp.assets(businessId), { method: 'POST', body });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: assetsQueryKey(businessId) }),
  });
}

export function useDeleteAsset(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assetId: string) => apiFetch(mp.asset(businessId, assetId), { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: assetsQueryKey(businessId) }),
  });
}

export const formatBytes = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
