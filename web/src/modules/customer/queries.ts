import type { IdBatchInput, ListStatusFilter, StatusBatchInput } from '@shared/batch';
import type { CustomerDto, RenameCustomerInput, SetCustomerStatusInput } from '@shared/contract';
import { type QueryClient, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { accessKeys } from '@/modules/access/queries';

export const customerKeys = {
  all: ['customers'] as const,
  list: ['customers', 'list'] as const,
  one: (id: string) => ['customers', 'one', id] as const,
};

/**
 * Daftar customer. Tanpa `status` = customer hidup (aktif + nonaktif); `deleted` (hanya `item: manage`) memakai kunci
 * sendiri agar tak bercampur dengan daftar hidup.
 */
export function customersQueryOptions(status?: ListStatusFilter) {
  return queryOptions({
    queryKey:
      status === 'deleted' ? ([...customerKeys.list, 'deleted'] as const) : customerKeys.list,
    queryFn: () => api('customers.list', status === 'deleted' ? { status } : null),
  });
}

/**
 * Satu customer (halaman View; `customers.get`). Data awal diambil dari daftar yang sudah termuat bila ada, jadi View
 * dari daftar terbuka seketika; customer terhapus (tak ada di daftar hidup) dimuat dari server.
 */
export function customerQueryOptions(queryClient: QueryClient, id: string) {
  const seed = queryClient.getQueryData<CustomerDto[]>(customerKeys.list)?.find((c) => c.id === id);
  return queryOptions({
    queryKey: customerKeys.one(id),
    queryFn: () => api('customers.get', { id }),
    retry: false,
    ...(seed
      ? {
          initialData: seed,
          initialDataUpdatedAt: queryClient.getQueryState(customerKeys.list)?.dataUpdatedAt ?? 0,
        }
      : {}),
  });
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
  useCustomerMutation((input: RenameCustomerInput) => api('customers.rename', input));
export const useSetCustomerStatus = () =>
  useCustomerMutation((input: SetCustomerStatusInput) => api('customers.setStatus', input));
export const useSetCustomerStatusBatch = () =>
  useCustomerMutation((input: StatusBatchInput) => api('customers.setStatusBatch', input));
export const useRemoveCustomers = () =>
  useCustomerMutation((input: IdBatchInput) => api('customers.removeBatch', input));
export const useRestoreCustomers = () =>
  useCustomerMutation((input: IdBatchInput) => api('customers.restoreBatch', input));
