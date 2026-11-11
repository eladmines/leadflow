import {
  apiPaths,
  type CustomerListResponse,
  type ImportCustomersRequest,
  type ImportCustomersResponse,
} from '@leadflow/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

/** Paying customers (D-163); refreshed with the leads, since a lead won or a quote accepted adds one. */
export function useCustomers(businessId: string, q: string) {
  return useQuery({
    queryKey: ['businesses', businessId, 'leads', 'customers', q],
    queryFn: () =>
      apiFetch<CustomerListResponse>(
        `${apiPaths.customers.list(businessId)}${q ? `?q=${encodeURIComponent(q)}` : ''}`,
      ),
    select: (data) => data.customers,
    placeholderData: keepPreviousData,
  });
}

/** D-179: import customers from a spreadsheet; the list, leads and reports pick the new people up. */
export function useImportCustomers(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ImportCustomersRequest) =>
      apiFetch<ImportCustomersResponse>(apiPaths.customers.import(businessId), {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['businesses', businessId, 'leads'] });
      void queryClient.invalidateQueries({ queryKey: ['businesses', businessId, 'reports'] });
    },
  });
}
