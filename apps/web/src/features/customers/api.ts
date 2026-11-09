import { apiPaths, type CustomerListResponse } from '@leadflow/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
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
