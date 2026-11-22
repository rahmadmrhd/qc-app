import type { IdBatchInput, ListStatusFilter, StatusBatchInput } from '@shared/batch';
import type {
  AuditCursorPageDto,
  BusinessUnitDto,
  LocationDto,
  RoleDto,
  SaveBusinessUnitInput,
  SaveLocationInput,
  SaveRoleInput,
  SaveUserInput,
  SetBusinessUnitStatusInput,
  SetLocationStatusInput,
  SetUserStatusInput,
  UserDto,
} from '@shared/contract';
import {
  infiniteQueryOptions,
  type QueryClient,
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
  /** Satu atau lebih aksi (salah satu dari); kosong/tak ada = semua aksi. */
  actions?: readonly string[];
  query?: string;
}

/** Log audit berkursor (20 per halaman, terbaru dahulu); filter aksi dan kata kunci dikerjakan server. */
export function auditInfiniteQueryOptions(filter: AuditFilter) {
  return infiniteQueryOptions({
    queryKey: [...accessKeys.audit, (filter.actions ?? []).join(','), filter.query ?? ''] as const,
    queryFn: ({ pageParam }) =>
      api('access.audit.list', {
        ...(filter.actions && filter.actions.length > 0 ? { actions: [...filter.actions] } : {}),
        ...(filter.query ? { query: filter.query } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: AuditCursorPageDto) => last.nextCursor ?? undefined,
  });
}

/**
 * Kunci daftar: tanpa `status` (atau bukan `deleted`) = record hidup (aktif + nonaktif; kunci yang dipakai pemilih dan
 * form); `deleted` (hanya `access: manage`) memakai kunci sendiri agar tak bercampur dengan daftar hidup.
 */
function listKey(base: readonly string[], status?: ListStatusFilter) {
  return status === 'deleted' ? ([...base, 'deleted'] as const) : base;
}

/** Kunci satu record (halaman View); berawalan kunci daftar sehingga ikut dimuat ulang oleh mutasi akses. */
function oneKey(base: readonly string[], id: string) {
  return [...base, 'one', id] as const;
}

/** Data awal View dari daftar yang sudah termuat (View dari daftar terbuka seketika); record terhapus dimuat server. */
function seedOf<T extends { id: string }>(
  queryClient: QueryClient,
  base: readonly string[],
  id: string,
) {
  const seed = queryClient.getQueryData<T[]>(base)?.find((entry) => entry.id === id);
  return seed
    ? {
        initialData: seed,
        initialDataUpdatedAt: queryClient.getQueryState(base)?.dataUpdatedAt ?? 0,
      }
    : {};
}

export const userKeys = { one: (id: string) => oneKey(accessKeys.users, id) };
export const roleKeys = { one: (id: string) => oneKey(accessKeys.roles, id) };
export const locationKeys = { one: (id: string) => oneKey(accessKeys.locations, id) };
export const businessUnitKeys = { one: (id: string) => oneKey(accessKeys.businessUnits, id) };

export function usersQueryOptions(status?: ListStatusFilter) {
  return queryOptions({
    queryKey: listKey(accessKeys.users, status),
    queryFn: () => api('access.users.list', status === 'deleted' ? { status } : null),
  });
}

/** Satu pengguna (View; `access.users.get`). */
export function userQueryOptions(queryClient: QueryClient, id: string) {
  return queryOptions({
    queryKey: userKeys.one(id),
    queryFn: () => api('access.users.get', { id }),
    retry: false,
    ...seedOf<UserDto>(queryClient, accessKeys.users, id),
  });
}

export function rolesQueryOptions(status?: ListStatusFilter) {
  return queryOptions({
    queryKey: listKey(accessKeys.roles, status),
    queryFn: () => api('access.roles.list', status === 'deleted' ? { status } : null),
  });
}

export function roleQueryOptions(queryClient: QueryClient, id: string) {
  return queryOptions({
    queryKey: roleKeys.one(id),
    queryFn: () => api('access.roles.get', { id }),
    retry: false,
    ...seedOf<RoleDto>(queryClient, accessKeys.roles, id),
  });
}

export function locationsQueryOptions(status?: ListStatusFilter) {
  return queryOptions({
    queryKey: listKey(accessKeys.locations, status),
    queryFn: () => api('access.locations.list', status === 'deleted' ? { status } : null),
  });
}

export function locationQueryOptions(queryClient: QueryClient, id: string) {
  return queryOptions({
    queryKey: locationKeys.one(id),
    queryFn: () => api('access.locations.get', { id }),
    retry: false,
    ...seedOf<LocationDto>(queryClient, accessKeys.locations, id),
  });
}

export function businessUnitsQueryOptions(status?: ListStatusFilter) {
  return queryOptions({
    queryKey: listKey(accessKeys.businessUnits, status),
    queryFn: () => api('access.businessUnits.list', status === 'deleted' ? { status } : null),
  });
}

export function businessUnitQueryOptions(queryClient: QueryClient, id: string) {
  return queryOptions({
    queryKey: businessUnitKeys.one(id),
    queryFn: () => api('access.businessUnits.get', { id }),
    retry: false,
    ...seedOf<BusinessUnitDto>(queryClient, accessKeys.businessUnits, id),
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
export const useSetUserStatusBatch = () =>
  useAccessMutation((input: StatusBatchInput) => api('access.users.setStatusBatch', input));
export const useRemoveUsers = () =>
  useAccessMutation((input: IdBatchInput) => api('access.users.removeBatch', input));
export const useRestoreUsers = () =>
  useAccessMutation((input: IdBatchInput) => api('access.users.restoreBatch', input));

export const useSaveRole = () =>
  useAccessMutation((input: SaveRoleInput) => api('access.roles.save', input));
export const useRemoveRoles = () =>
  useAccessMutation((input: IdBatchInput) => api('access.roles.removeBatch', input));
export const useRestoreRoles = () =>
  useAccessMutation((input: IdBatchInput) => api('access.roles.restoreBatch', input));

export const useSaveLocation = () =>
  useAccessMutation((input: SaveLocationInput) => api('access.locations.save', input));
export const useSetLocationStatus = () =>
  useAccessMutation((input: SetLocationStatusInput) => api('access.locations.setStatus', input));
export const useSetLocationStatusBatch = () =>
  useAccessMutation((input: StatusBatchInput) => api('access.locations.setStatusBatch', input));
export const useRemoveLocations = () =>
  useAccessMutation((input: IdBatchInput) => api('access.locations.removeBatch', input));
export const useRestoreLocations = () =>
  useAccessMutation((input: IdBatchInput) => api('access.locations.restoreBatch', input));

export const useSaveBusinessUnit = () =>
  useAccessMutation((input: SaveBusinessUnitInput) => api('access.businessUnits.save', input));
export const useSetBusinessUnitStatus = () =>
  useAccessMutation((input: SetBusinessUnitStatusInput) =>
    api('access.businessUnits.setStatus', input),
  );
export const useSetBusinessUnitStatusBatch = () =>
  useAccessMutation((input: StatusBatchInput) => api('access.businessUnits.setStatusBatch', input));
export const useRemoveBusinessUnits = () =>
  useAccessMutation((input: IdBatchInput) => api('access.businessUnits.removeBatch', input));
export const useRestoreBusinessUnits = () =>
  useAccessMutation((input: IdBatchInput) => api('access.businessUnits.restoreBatch', input));
