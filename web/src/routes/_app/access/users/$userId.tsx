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
import { UserFormDialog } from '@/modules/access/components/user-form-dialog';
import { USER_TABS, UserView } from '@/modules/access/components/user-view';
import { useUserReferences } from '@/modules/access/lib/use-user-references';
import {
  businessUnitsQueryOptions,
  locationsQueryOptions,
  rolesQueryOptions,
  useRemoveUsers,
  useRestoreUsers,
  userQueryOptions,
  useSaveUser,
  useSetUserStatus,
} from '@/modules/access/queries';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';

const searchSchema = z.object({
  tab: z.enum(USER_TABS).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/access/users/$userId')({
  staticData: {
    crumb: ({ params, queryClient }) => ({
      label:
        queryClient.getQueryData(userQueryOptions(queryClient, params.userId ?? '').queryKey)
          ?.email ?? 'Detail',
    }),
  },
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'access', 'view'),
  loader: ({ context, params }) =>
    Promise.all([
      // Pengguna yang tak ada/terhapus (bagi yang tak berhak) ditangani halaman sebagai "tidak ditemukan".
      context.queryClient
        .ensureQueryData(userQueryOptions(context.queryClient, params.userId))
        .catch(() => undefined),
      context.queryClient.ensureQueryData(rolesQueryOptions()),
      context.queryClient.ensureQueryData(locationsQueryOptions()),
      context.queryClient.ensureQueryData(businessUnitsQueryOptions()),
    ]),
  component: UserDetailPage,
});

/** Galat "pengguna tidak ada" (id salah, atau terhapus bagi yang tak boleh melihatnya); selain itu dilempar ulang. */
function isMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN');
}

function UserDetailPage() {
  const { userId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const stack = useStackNavigation();
  const queryClient = useQueryClient();
  const me = useMe();
  const query = useQuery(userQueryOptions(queryClient, userId));
  const references = useUserReferences();
  const saveUser = useSaveUser();
  const setStatus = useSetUserStatus();
  const removeUsers = useRemoveUsers();
  const restoreUsers = useRestoreUsers();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canManage = can(me, 'access', 'manage');
  const user = query.data;

  function restore() {
    // `mutateAsync` + toast di closure: aksi "Pulihkan" pada toast "Dihapus" dipanggil setelah navigasi, saat
    // komponen ini sudah dilepas (callback per-`mutate` tidak berjalan lagi).
    restoreUsers
      .mutateAsync({ ids: [userId] })
      .then(() => toast.success('Pengguna dipulihkan (Nonaktif)'))
      .catch((error: unknown) => toast.error(describeError(error)));
  }

  const afterDelete = useAfterDelete({
    indexTo: '/access/users',
    canRestore: canManage,
    onRestore: restore,
  });

  if (query.isError && !isMissing(query.error)) throw query.error;
  if (query.isPending) return <p className="text-sm text-muted-foreground">Memuat…</p>;

  function toggleStatus() {
    if (!user) return;
    const next = user.status === 'active' ? 'inactive' : 'active';
    setStatus.mutate(
      { id: user.id, status: next },
      {
        onSuccess: () =>
          toast.success(next === 'active' ? 'Pengguna diaktifkan' : 'Pengguna dinonaktifkan'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  function remove() {
    removeUsers.mutate(
      { ids: [userId] },
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
      <UserView
        user={user}
        labels={references.labels}
        canManage={canManage}
        canOpenLocation={references.canOpenLocation}
        canOpenBusinessUnit={references.canOpenBusinessUnit}
        canOpenRole={references.canOpenRole}
        currentEmail={me.email}
        tab={search.tab}
        onTabChange={(tab) =>
          void navigate({ search: (prev) => ({ ...prev, tab }), replace: true })
        }
        statusPending={setStatus.isPending}
        restorePending={restoreUsers.isPending}
        onBack={() => stack.pop({ to: '/access/users' })}
        onEdit={() => setEditing(true)}
        onToggleStatus={toggleStatus}
        onDelete={() => setConfirmDelete(true)}
        onRestore={restore}
      />
      {user ? (
        <>
          <UserFormDialog
            {...references.formProps}
            currentEmail={me.email}
            open={editing}
            onOpenChange={setEditing}
            user={user}
            onSave={async (input) => {
              await saveUser.mutateAsync(input);
              toast.success('Pengguna disimpan');
            }}
          />
          <ConfirmDeleteDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            count={1}
            subject="pengguna"
            onConfirm={remove}
            busy={removeUsers.isPending}
          />
        </>
      ) : null}
    </>
  );
}
