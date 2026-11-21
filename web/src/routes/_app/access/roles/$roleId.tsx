import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { useAfterDelete } from '@/components/page/use-after-delete';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { RoleFormDialog } from '@/modules/access/components/role-form-dialog';
import { ROLE_TABS, RoleView } from '@/modules/access/components/role-view';
import {
  roleQueryOptions,
  useRemoveRoles,
  useRestoreRoles,
  usersQueryOptions,
  useSaveRole,
} from '@/modules/access/queries';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';

const searchSchema = z.object({
  tab: z.enum(ROLE_TABS).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/access/roles/$roleId')({
  staticData: {
    crumb: ({ params, queryClient }) => ({
      label:
        queryClient.getQueryData(roleQueryOptions(queryClient, params.roleId ?? '').queryKey)
          ?.name ?? 'Detail',
    }),
  },
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'access', 'view'),
  loader: ({ context, params }) =>
    Promise.all([
      // Role yang tak ada/terhapus (bagi yang tak berhak) ditangani halaman sebagai "tidak ditemukan".
      context.queryClient
        .ensureQueryData(roleQueryOptions(context.queryClient, params.roleId))
        .catch(() => undefined),
      // Tab Pengguna membaca daftar pengguna dari cache.
      context.queryClient.ensureQueryData(usersQueryOptions()),
    ]),
  component: RoleDetailPage,
});

/** Galat "role tidak ada" (id salah, atau terhapus bagi yang tak boleh melihatnya); selain itu dilempar ulang. */
function isMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN');
}

function RoleDetailPage() {
  const { roleId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const stack = useStackNavigation();
  const queryClient = useQueryClient();
  const me = useMe();
  const query = useQuery(roleQueryOptions(queryClient, roleId));
  const users = useQuery(usersQueryOptions());
  const saveRole = useSaveRole();
  const removeRoles = useRemoveRoles();
  const restoreRoles = useRestoreRoles();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canManage = can(me, 'access', 'manage');
  const role = query.data;

  function restore() {
    // `mutateAsync` + toast di closure: aksi "Pulihkan" pada toast "Dihapus" dipanggil setelah navigasi, saat
    // komponen ini sudah dilepas (callback per-`mutate` tidak berjalan lagi).
    restoreRoles
      .mutateAsync({ ids: [roleId] })
      .then(() => toast.success('Role dipulihkan'))
      .catch((error: unknown) => toast.error(describeError(error)));
  }

  const afterDelete = useAfterDelete({
    indexTo: '/access/roles',
    canRestore: canManage,
    onRestore: restore,
  });

  if (query.isError && !isMissing(query.error)) throw query.error;
  if (query.isPending) return <p className="text-sm text-muted-foreground">Memuat…</p>;

  function remove() {
    removeRoles.mutate(
      { ids: [roleId] },
      {
        onSuccess: () => {
          setConfirmDelete(false);
          afterDelete();
        },
        onError: (error) => {
          setConfirmDelete(false);
          toast.error(describeError(error));
        },
      },
    );
  }

  return (
    <>
      <RoleView
        role={role}
        users={users.data ?? []}
        canManage={canManage}
        tab={search.tab}
        onTabChange={(tab) =>
          void navigate({ search: (prev) => ({ ...prev, tab }), replace: true })
        }
        deletePending={removeRoles.isPending}
        restorePending={restoreRoles.isPending}
        onBack={() => stack.pop({ to: '/access/roles' })}
        onEdit={() => setEditing(true)}
        onDelete={() => setConfirmDelete(true)}
        onRestore={restore}
      />
      {role ? (
        <>
          <RoleFormDialog
            open={editing}
            onOpenChange={setEditing}
            role={role}
            onSave={async (input) => {
              await saveRole.mutateAsync(input);
              toast.success('Role disimpan');
            }}
          />
          <ConfirmDeleteDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            count={1}
            subject="role"
            onConfirm={remove}
            busy={removeRoles.isPending}
          />
        </>
      ) : null}
    </>
  );
}
