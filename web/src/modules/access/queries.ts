import type {
  DeleteRoleInput,
  ListAuditInput,
  SaveLocationInput,
  SaveRoleInput,
  SaveUserInput,
  SetLocationStatusInput,
  SetUserStatusInput,
} from '@shared/rpc';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/lib/rpc';
import { meQueryKey } from '@/modules/auth/queries';

export const accessKeys = {
  all: ['access'] as const,
  users: ['access', 'users'] as const,
  roles: ['access', 'roles'] as const,
  audit: ['access', 'audit'] as const,
  locations: ['access', 'locations'] as const,
};

export function auditQueryOptions(input: ListAuditInput) {
  return queryOptions({
    queryKey: [...accessKeys.audit, input] as const,
    queryFn: () => rpc('access.audit.list', input),
  });
}

export function usersQueryOptions() {
  return queryOptions({
    queryKey: accessKeys.users,
    queryFn: () => rpc('access.users.list', null),
  });
}

export function rolesQueryOptions() {
  return queryOptions({
    queryKey: accessKeys.roles,
    queryFn: () => rpc('access.roles.list', null),
  });
}

export function locationsQueryOptions() {
  return queryOptions({
    queryKey: accessKeys.locations,
    queryFn: () => rpc('access.locations.list', null),
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
        queryClient.invalidateQueries({ queryKey: meQueryKey }),
      ]);
    },
  });
}

export const useSaveUser = () =>
  useAccessMutation((input: SaveUserInput) => rpc('access.users.save', input));
export const useSetUserStatus = () =>
  useAccessMutation((input: SetUserStatusInput) => rpc('access.users.setStatus', input));
export const useSaveRole = () =>
  useAccessMutation((input: SaveRoleInput) => rpc('access.roles.save', input));
export const useDeleteRole = () =>
  useAccessMutation((input: DeleteRoleInput) => rpc('access.roles.delete', input));
export const useSaveLocation = () =>
  useAccessMutation((input: SaveLocationInput) => rpc('access.locations.save', input));
export const useSetLocationStatus = () =>
  useAccessMutation((input: SetLocationStatusInput) => rpc('access.locations.setStatus', input));
