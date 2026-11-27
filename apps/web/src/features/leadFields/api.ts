import {
  apiPaths,
  type CreateLeadFieldRequest,
  type LeadFieldDefinition,
  type LeadFieldListResponse,
  type LeadFieldResponse,
  type ReorderLeadFieldsRequest,
  type UpdateLeadFieldRequest,
} from '@simplecatch/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

/**
 * F34: the business's own lead fields. Everyone who sees leads reads them (`leads.view`); only
 * owners and managers change them (`leadFields.manage`, enforced by the server).
 */
const lf = apiPaths.leadFields;

export const leadFieldsQueryKey = (businessId: string) =>
  ['businesses', businessId, 'leadFields'] as const;

export function useLeadFields(businessId: string, enabled = true) {
  return useQuery({
    queryKey: leadFieldsQueryKey(businessId),
    queryFn: () => apiFetch<LeadFieldListResponse>(lf.list(businessId)),
    select: (data) => data.fields,
    staleTime: 5 * 60_000,
    enabled,
  });
}

/** Active fields in their order (the API sends active by position, then archived). */
export const activeFields = (fields: readonly LeadFieldDefinition[] | undefined) =>
  (fields ?? []).filter((f) => !f.archivedAt).sort((a, b) => a.position - b.position);

export const archivedFields = (fields: readonly LeadFieldDefinition[] | undefined) =>
  (fields ?? []).filter((f) => f.archivedAt).sort((a, b) => a.position - b.position);

/** Puts one changed definition into the cached list (or adds it), keeping the API's order. */
function upsert(list: LeadFieldListResponse | undefined, field: LeadFieldDefinition) {
  const fields = list?.fields ?? [];
  const next = fields.some((f) => f.id === field.id)
    ? fields.map((f) => (f.id === field.id ? field : f))
    : [...fields, field];
  return { fields: [...activeFields(next), ...archivedFields(next)] };
}

export function useCreateLeadField(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateLeadFieldRequest) =>
      apiFetch<LeadFieldResponse>(lf.list(businessId), {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: ({ field }) => {
      queryClient.setQueryData<LeadFieldListResponse>(leadFieldsQueryKey(businessId), (old) =>
        upsert(old, field),
      );
      void queryClient.invalidateQueries({ queryKey: leadFieldsQueryKey(businessId) });
    },
  });
}

export function useUpdateLeadField(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ fieldId, body }: { fieldId: string; body: UpdateLeadFieldRequest }) =>
      apiFetch<LeadFieldResponse>(lf.detail(businessId, fieldId), {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: ({ field }) => {
      queryClient.setQueryData<LeadFieldListResponse>(leadFieldsQueryKey(businessId), (old) =>
        upsert(old, field),
      );
      // Restoring moves the field last; positions of the others come from the server.
      void queryClient.invalidateQueries({ queryKey: leadFieldsQueryKey(businessId) });
    },
  });
}

/** Saves a new order of the active fields; shown at once and rolled back if refused. */
export function useReorderLeadFields(businessId: string) {
  const queryClient = useQueryClient();
  const key = leadFieldsQueryKey(businessId);
  return useMutation({
    mutationFn: (body: ReorderLeadFieldsRequest) =>
      apiFetch<LeadFieldListResponse>(lf.order(businessId), {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onMutate: async ({ ids }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const snapshot = queryClient.getQueryData<LeadFieldListResponse>(key);
      if (snapshot) {
        const byId = new Map(snapshot.fields.map((f) => [f.id, f]));
        const reordered = ids.flatMap((id, position) => {
          const f = byId.get(id);
          return f ? [{ ...f, position }] : [];
        });
        queryClient.setQueryData<LeadFieldListResponse>(key, {
          fields: [...reordered, ...archivedFields(snapshot.fields)],
        });
      }
      return { snapshot };
    },
    onSuccess: (data) => queryClient.setQueryData(key, data),
    onError: (_err, _vars, context) => {
      if (context?.snapshot) queryClient.setQueryData(key, context.snapshot);
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
