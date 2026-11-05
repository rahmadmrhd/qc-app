import { queryOptions } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const meQueryKey = ['auth', 'me'] as const;

export function meQueryOptions() {
  return queryOptions({
    queryKey: meQueryKey,
    queryFn: () => api('auth.me', null),
    staleTime: 5 * 60 * 1000,
  });
}
