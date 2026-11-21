import type { UserDto } from '@shared/contract';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { ActionButton } from '@/components/action-button';
import { BulkBar, useRowSelection } from '@/components/data-table';
import { DisabledReason } from '@/components/disabled-reason';
import { FilterBar, FilterChip } from '@/components/page/filter-bar';
import { ListPage } from '@/components/page/list-page';
import { Select } from '@/components/select';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { statusFilterOptions } from '@/components/soft-delete/status-filter';
import { Button } from '@/components/ui/button';
import { describeError } from '@/lib/api/describe-error';
import { UserFormDialog } from '@/modules/access/components/user-form-dialog';
import { UsersTable } from '@/modules/access/components/users-table';
import { filterUsers } from '@/modules/access/lib/filter-users';
import { useRecordBulk } from '@/modules/access/lib/use-record-bulk';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import { useUserReferences } from '@/modules/access/lib/use-user-references';
import {
  businessUnitsQueryOptions,
  locationsQueryOptions,
  rolesQueryOptions,
  useRemoveUsers,
  useRestoreUsers,
  usersQueryOptions,
  useSaveUser,
  useSetUserStatus,
  useSetUserStatusBatch,
} from '@/modules/access/queries';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';

const usersSearchSchema = z.object({
  q: z.string().optional().catch(undefined),
  status: z.enum(['all', 'active', 'inactive', 'deleted']).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/access/users/')({
  validateSearch: (search: Record<string, unknown>) => usersSearchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'access', 'view'),
  loader: async ({ context, location }) => {
    const search = usersSearchSchema.parse(location.search);
    await Promise.all([
      // Tampilan Terhapus hanya untuk `access: manage`: tak dimuat di loader (server akan menolaknya).
      search.status === 'deleted'
        ? undefined
        : context.queryClient.ensureQueryData(usersQueryOptions()),
      context.queryClient.ensureQueryData(rolesQueryOptions()),
      context.queryClient.ensureQueryData(locationsQueryOptions()),
      context.queryClient.ensureQueryData(businessUnitsQueryOptions()),
    ]);
  },
  component: UsersPage,
});

type DeleteTarget = { kind: 'bulk' } | { kind: 'row'; user: UserDto };

const SELF_BULK_REASON = 'Pilihan memuat akun Anda sendiri';

function UsersPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const me = useMe();
  const canManage = can(me, 'access', 'manage');
  // `?status=deleted` tulisan tangan oleh pengguna tanpa hak diperlakukan sebagai "Semua status".
  const status = search.status === 'deleted' && !canManage ? 'all' : (search.status ?? 'all');
  const deletedView = status === 'deleted';
  const list = useQuery(usersQueryOptions(deletedView ? 'deleted' : undefined));
  const references = useUserReferences();
  const saveUser = useSaveUser();
  const setStatus = useSetUserStatus();
  const statusBatch = useSetUserStatusBatch();
  const removeUsers = useRemoveUsers();
  const restoreUsers = useRestoreUsers();
  const selection = useRowSelection(JSON.stringify({ status, q: search.q ?? '' }));
  /** `'new'` = dialog tambah; objek = dialog ubah pengguna itu. */
  const [dialog, setDialog] = useState<UserDto | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [text, setText] = useUrlSyncedText(
    search.q ?? '',
    (value) =>
      void navigate({ search: (prev) => ({ ...prev, q: value || undefined }), replace: true }),
  );

  const visible = filterUsers(list.data ?? [], {
    q: text,
    status: status === 'deleted' ? 'all' : status,
  });
  const reload = () => void list.refetch();
  const bulk = useRecordBulk({
    selection,
    subject: 'pengguna',
    rows: visible,
    setStatusBatch: (input) => statusBatch.mutateAsync(input),
    removeBatch: (input) => removeUsers.mutateAsync(input),
    restoreBatch: (input) => restoreUsers.mutateAsync(input),
    reload,
  });

  const selected = visible.filter((user) => selection.selected.has(user.id));
  const selectionHasSelf = selected.some((user) => user.email === me.email);
  const allInactive = selected.every((user) => user.status === 'inactive');

  function toggleStatus(user: UserDto) {
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

  function restoreRow(user: UserDto) {
    restoreUsers.mutate(
      { ids: [user.id] },
      {
        onSuccess: () => toast.success('Pengguna dipulihkan (Nonaktif)'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    if (target.kind === 'bulk') {
      void bulk.remove.run().finally(() => setDeleteTarget(null));
      return;
    }
    removeUsers.mutate(
      { ids: [target.user.id] },
      {
        onSuccess: () => toast.success('Pengguna dihapus'),
        onError: (error) => toast.error(describeError(error)),
        onSettled: () => setDeleteTarget(null),
      },
    );
  }

  const statusOptions = statusFilterOptions(canManage);
  const statusLabel = statusOptions.find((option) => option.value === status)?.label;
  const pendingId = setStatus.isPending
    ? (setStatus.variables?.id ?? null)
    : restoreUsers.isPending && restoreUsers.variables?.ids.length === 1
      ? (restoreUsers.variables.ids[0] ?? null)
      : null;
  const filtered = text.trim() !== '' || status !== 'all';
  const countLabel =
    list.isSuccess && (visible.length > 0 || filtered) ? `${visible.length} pengguna` : undefined;

  return (
    <>
      <ListPage
        title="Pengguna"
        count={countLabel}
        createAction={
          canManage ? { label: 'Tambah pengguna', onClick: () => setDialog('new') } : undefined
        }
        filters={
          <FilterBar
            search={{
              value: text,
              onChange: setText,
              placeholder: 'Cari email atau nama',
              label: 'Cari pengguna',
            }}
          >
            <FilterChip
              label="Status"
              display={status === 'all' ? null : statusLabel}
              onClear={() =>
                void navigate({ search: (prev) => ({ ...prev, status: undefined }), replace: true })
              }
            >
              <Select
                id="users-filter-status"
                label="Filter status"
                hideLabel
                options={statusOptions}
                value={status}
                onValueChange={(next) =>
                  void navigate({
                    search: (prev) => ({
                      ...prev,
                      status: next as 'all' | 'active' | 'inactive' | 'deleted',
                    }),
                    replace: true,
                  })
                }
              />
            </FilterChip>
          </FilterBar>
        }
        bulkBar={
          canManage ? (
            <BulkBar count={selection.count} onClear={selection.clear} busy={bulk.busy}>
              {deletedView ? (
                <ActionButton action="restore" onClick={() => void bulk.restore.run()} />
              ) : (
                <>
                  <ActionButton action="activate" onClick={() => void bulk.activate.run()} />
                  <DisabledReason reason={selectionHasSelf ? SELF_BULK_REASON : undefined}>
                    <ActionButton
                      action="deactivate"
                      disabled={selectionHasSelf}
                      onClick={() => void bulk.deactivate.run()}
                    />
                  </DisabledReason>
                  <DisabledReason
                    reason={
                      selectionHasSelf
                        ? SELF_BULK_REASON
                        : allInactive
                          ? undefined
                          : 'Nonaktifkan pengguna dulu sebelum dihapus'
                    }
                  >
                    <ActionButton
                      action="delete"
                      disabled={selectionHasSelf || !allInactive}
                      onClick={() => setDeleteTarget({ kind: 'bulk' })}
                    />
                  </DisabledReason>
                </>
              )}
            </BulkBar>
          ) : null
        }
      >
        <UsersTable
          users={visible}
          labels={references.labels}
          deletedView={deletedView}
          canManage={canManage}
          canOpenLocation={references.canOpenLocation}
          canOpenBusinessUnit={references.canOpenBusinessUnit}
          canOpenRole={references.canOpenRole}
          currentEmail={me.email}
          selection={canManage ? selection : undefined}
          pendingId={pendingId}
          onEdit={(user) => setDialog(user)}
          onToggleStatus={toggleStatus}
          onDelete={(user) => setDeleteTarget({ kind: 'row', user })}
          onRestore={restoreRow}
          filtered={filtered}
          onClearFilters={() => {
            setText('');
            void navigate({ search: {}, replace: true });
          }}
          emptyAction={
            canManage ? (
              <Button type="button" onClick={() => setDialog('new')}>
                Tambah pengguna
              </Button>
            ) : undefined
          }
          isLoading={list.isPending}
          isError={list.isLoadingError}
          onRetry={reload}
        />
      </ListPage>
      <UserFormDialog
        {...references.formProps}
        open={dialog !== null}
        onOpenChange={(open) => (open ? undefined : setDialog(null))}
        user={dialog === null || dialog === 'new' ? undefined : dialog}
        onSave={async (input) => {
          await saveUser.mutateAsync(input);
          toast.success('Pengguna disimpan');
        }}
      />
      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        count={deleteTarget?.kind === 'bulk' ? selection.count : 1}
        subject="pengguna"
        onConfirm={confirmDelete}
        busy={bulk.remove.busy || removeUsers.isPending}
      />
    </>
  );
}
