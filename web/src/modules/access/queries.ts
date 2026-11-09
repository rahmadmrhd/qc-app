import type {
  AuditCursorPageDto,
  DeleteRoleInput,
  SaveBusinessUnitInput,
  SaveLocationInput,
  SaveRoleInput,
  SaveUserInput,
  SetBusinessUnitStatusInput,
  SetLocationStatusInput,
  SetUserStatusInput,
} from '@shared/contract';
import {
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { meQueryKey } from '@/modules/auth/queries';

export const accessKeys = {
  all: ['access'] as const,
  users: ['access', 'users'] as const,
  roles: ['access', 'roles'] as const,
  audit: ['access', 'audit'] as const,
  locations: ['access', 'locations'] as const,
  businessUnits: ['access', 'businessUnits'] as const,
};

/** Daftar BU ringkas untuk pemilih (butuh `item: view`, bukan `access: view`); BUKAN bagian `accessKeys.all`. */
export const businessUnitOptionsKey = ['businessUnits', 'options'] as const;

export interface AuditFilter {
  action?: string;
  query?: string;
}

/** Log audit berkursor (20 per halaman, terbaru dahulu); filter aksi dan kata kunci dikerjakan server. */
export function auditInfiniteQueryOptions(filter: AuditFilter) {
  return infiniteQueryOptions({
    queryKey: [...accessKeys.audit, filter.action ?? '', filter.query ?? ''] as const,
    queryFn: ({ pageParam }) =>
      api('access.audit.list', {
        ...(filter.action ? { action: filter.action } : {}),
        ...(filter.query ? { query: filter.query } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: AuditCursorPageDto) => last.nextCursor ?? undefined,
  });
}

export function usersQueryOptions() {
  return queryOptions({
    queryKey: accessKeys.users,
    queryFn: () => api('access.users.list', null),
  });
}

export function rolesQueryOptions() {
  return queryOptions({
    queryKey: accessKeys.roles,
    queryFn: () => api('access.roles.list', null),
  });
}

export function locationsQueryOptions() {
  return queryOptions({
    queryKey: accessKeys.locations,
    queryFn: () => api('access.locations.list', null),
  });
}

export function businessUnitsQueryOptions() {
  return queryOptions({
    queryKey: accessKeys.businessUnits,
    queryFn: () => api('access.businessUnits.list', null),
  });
}

export function businessUnitOptionsQueryOptions() {
  return queryOptions({
    queryKey: businessUnitOptionsKey,
    queryFn: () => api('businessUnits.options', null),
  });
}

/** Perubahan akses bisa mengubah hak user yang sedang login, jadi `auth.me` ikut di-refresh. */
function useAccessMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: accessKeys.all }),
        // Pilihan BU di modul lain (Merk, form item) ikut basi bila BU berubah.
        queryClient.invalidateQueries({ queryKey: businessUnitOptionsKey }),
        queryClient.invalidateQueries({ queryKey: meQueryKey }),
      ]);
    },
  });
}

export const useSaveUser = () =>
  useAccessMutation((input: SaveUserInput) => api('access.users.save', input));
export const useSetUserStatus = () =>
  useAccessMutation((input: SetUserStatusInput) => api('access.users.setStatus', input));
export const useSaveRole = () =>
  useAccessMutation((input: SaveRoleInput) => api('access.roles.save', input));
export const useDeleteRole = () =>
  useAccessMutation((input: DeleteRoleInput) => api('access.roles.delete', input));
export const useSaveLocation = () =>
  useAccessMutation((input: SaveLocationInput) => api('access.locations.save', input));
export const useSetLocationStatus = () =>
  useAccessMutation((input: SetLocationStatusInput) => api('access.locations.setStatus', input));
export const useSaveBusinessUnit = () =>
  useAccessMutation((input: SaveBusinessUnitInput) => api('access.businessUnits.save', input));
export const useSetBusinessUnitStatus = () =>
  useAccessMutation((input: SetBusinessUnitStatusInput) =>
    api('access.businessUnits.setStatus', input),
  );
