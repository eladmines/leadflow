import {
  apiPaths,
  type BusinessListResponse,
  type BusinessResponse,
  type CreateBusinessRequest,
  type MemberListResponse,
  type UpdateBusinessRequest,
} from '@leadflow/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

const paths = apiPaths.businesses;

export const businessesQueryKey = ['businesses'] as const;
export const businessQueryKey = (id: string) => ['businesses', id] as const;

const send = <T>(method: 'POST' | 'PATCH', path: string, body?: unknown) =>
  apiFetch<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export function useBusinesses() {
  return useQuery({
    queryKey: businessesQueryKey,
    queryFn: () => apiFetch<BusinessListResponse>(paths.list),
    select: (data) => data.businesses,
  });
}

export function useBusiness(businessId: string) {
  return useQuery({
    queryKey: businessQueryKey(businessId),
    queryFn: () => apiFetch<BusinessResponse>(paths.detail(businessId)),
    select: (data) => data.business,
    retry: false,
  });
}

export function useCreateBusiness() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBusinessRequest) => send<BusinessResponse>('POST', paths.create, body),
    onSuccess: (data) => {
      queryClient.setQueryData(businessQueryKey(data.business.id), data);
      void queryClient.invalidateQueries({ queryKey: businessesQueryKey, exact: true });
    },
  });
}

export function useUpdateBusiness(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateBusinessRequest) =>
      send<BusinessResponse>('PATCH', paths.detail(businessId), body),
    onSuccess: (data) => {
      queryClient.setQueryData(businessQueryKey(businessId), data);
      void queryClient.invalidateQueries({ queryKey: businessesQueryKey, exact: true });
    },
  });
}

export function useCompleteOnboarding(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => send<BusinessResponse>('POST', paths.completeOnboarding(businessId)),
    onSuccess: (data) => {
      queryClient.setQueryData(businessQueryKey(businessId), data);
      void queryClient.invalidateQueries({ queryKey: businessesQueryKey, exact: true });
    },
  });
}

export function useMembers(businessId: string, enabled = true) {
  return useQuery({
    queryKey: [...businessQueryKey(businessId), 'members'],
    queryFn: () => apiFetch<MemberListResponse>(paths.members(businessId)),
    select: (data) => data.members,
    enabled,
  });
}
