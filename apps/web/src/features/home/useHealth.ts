import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

export function useHealth() {
  return useQuery({
    queryKey: ['health', 'db'],
    queryFn: () => apiFetch<{ status: 'ok' }>('/health/db'),
    retry: false,
  });
}
