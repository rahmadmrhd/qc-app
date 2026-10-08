import type {
  DeleteRoleInput,
  SaveRoleInput,
  SaveUserInput,
  SetUserStatusInput,
} from '@shared/rpc';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/lib/rpc';
import { meQueryKey } from '@/modules/auth/queries';

export const accessKeys = {
  all: ['access'] as const,
  users: ['access', 'users'] as const,
  roles: ['access', 'roles'] as const,
};

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
