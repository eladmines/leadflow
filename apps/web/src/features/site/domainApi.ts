import { apiPaths, type DomainExpiryResponse } from '@simplecatch/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

/** F33: when the existing website's domain expires. */
const domainKey = (businessId: string) => ['businesses', businessId, 'domain'] as const;

export function useDomainExpiry(businessId: string) {
  return useQuery({
    queryKey: domainKey(businessId),
    queryFn: () => apiFetch<DomainExpiryResponse>(apiPaths.domain.domain(businessId)),
  });
}

/** Look it up now (the owner). */
export function useCheckDomain(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<DomainExpiryResponse>(apiPaths.domain.domain(businessId), { method: 'POST' }),
    onSuccess: (data) => queryClient.setQueryData(domainKey(businessId), data),
  });
}
