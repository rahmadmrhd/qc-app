import type { RenameCustomerInput, SetCustomerStatusInput } from '@shared/rpc';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/lib/rpc';
import { accessKeys } from '@/modules/access/queries';

export const customerKeys = {
  all: ['customers'] as const,
  list: ['customers', 'list'] as const,
};

export function customersQueryOptions() {
  return queryOptions({ queryKey: customerKeys.list, queryFn: () => rpc('customers.list', null) });
}

/** Nama customer tampil di daftar/detail task, jadi task ikut dimuat ulang (dan Log Audit). */
function useCustomerMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: customerKeys.all }),
        queryClient.invalidateQueries({ queryKey: ['handovers'] }),
        queryClient.invalidateQueries({ queryKey: accessKeys.audit }),
      ]);
    },
  });
}

export const useRenameCustomer = () =>
  useCustomerMutation((input: RenameCustomerInput) => rpc('customers.rename', input));
export const useSetCustomerStatus = () =>
  useCustomerMutation((input: SetCustomerStatusInput) => rpc('customers.setStatus', input));
