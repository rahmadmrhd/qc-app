import { queryOptions } from '@tanstack/react-query';
import { rpc } from '@/lib/rpc';

export const meQueryKey = ['auth', 'me'] as const;

export function meQueryOptions() {
  return queryOptions({
    queryKey: meQueryKey,
    queryFn: () => rpc('auth.me', null),
    staleTime: 5 * 60 * 1000,
  });
}
