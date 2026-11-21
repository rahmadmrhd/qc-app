import type { RoleDto } from '@shared/contract';
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
import { Button } from '@/components/ui/button';
import { describeError } from '@/lib/api/describe-error';
import { RoleFormDialog } from '@/modules/access/components/role-form-dialog';
import { RolesTable } from '@/modules/access/components/roles-table';
import { useRecordBulk } from '@/modules/access/lib/use-record-bulk';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import {
  rolesQueryOptions,
  useRemoveRoles,
  useRestoreRoles,
  useSaveRole,
} from '@/modules/access/queries';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';

const searchSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
  status: z.enum(['all', 'deleted']).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/access/roles/')({
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'access', 'view'),
  loader: ({ context, location }) => {
    const search = searchSchema.parse(location.search);
    // Tampilan Terhapus hanya untuk `access: manage`: tak dimuat di loader (server akan menolaknya).
    return search.status === 'deleted'
      ? undefined
      : context.queryClient.ensureQueryData(rolesQueryOptions());
  },
  component: RolesPage,
});

type DeleteTarget = { kind: 'bulk' } | { kind: 'row'; role: RoleDto };

/** Role tidak punya status aktif/nonaktif: filter hanya Semua dan (bagi pemegang manage) Terhapus. */
function roleStatusOptions(canRestore: boolean) {
  const options = [{ value: 'all', label: 'Semua role' }];
  if (canRestore) options.push({ value: 'deleted', label: 'Terhapus' });
  return options;
}

function RolesPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const me = useMe();
  const canManage = can(me, 'access', 'manage');
  // `?status=deleted` tulisan tangan oleh pengguna tanpa hak diperlakukan sebagai "Semua".
  const status = search.status === 'deleted' && !canManage ? 'all' : (search.status ?? 'all');
  const deletedView = status === 'deleted';
  const list = useQuery(rolesQueryOptions(deletedView ? 'deleted' : undefined));
  const saveRole = useSaveRole();
  const removeRoles = useRemoveRoles();
  const restoreRoles = useRestoreRoles();
  const selection = useRowSelection(JSON.stringify({ status, q: search.q ?? '' }));
  /** `'new'` = dialog tambah; objek = dialog ubah role itu. */
  const [dialog, setDialog] = useState<RoleDto | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [text, setText] = useUrlSyncedText(
    search.q ?? '',
    (value) =>
      void navigate({ search: (prev) => ({ ...prev, q: value || undefined }), replace: true }),
  );

  const term = text.trim().toLowerCase();
  const visible = (list.data ?? []).filter(
    (role) =>
      term === '' ||
      role.name.toLowerCase().includes(term) ||
      role.description.toLowerCase().includes(term),
  );
  const reload = () => void list.refetch();
  const bulk = useRecordBulk({
    selection,
    subject: 'role',
    rows: visible,
    removeBatch: (input) => removeRoles.mutateAsync(input),
    restoreBatch: (input) => restoreRoles.mutateAsync(input),
    reload,
  });

  const selected = visible.filter((role) => selection.selected.has(role.id));
  const inUse = selected.filter((role) => role.userCount > 0);

  function restoreRow(role: RoleDto) {
    restoreRoles.mutate(
      { ids: [role.id] },
      {
        onSuccess: () => toast.success('Role dipulihkan'),
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
    removeRoles.mutate(
      { ids: [target.role.id] },
      {
        onSuccess: () => toast.success('Role dihapus'),
        onError: (error) => toast.error(describeError(error)),
        onSettled: () => setDeleteTarget(null),
      },
    );
  }

  const statusOptions = roleStatusOptions(canManage);
  const statusLabel = statusOptions.find((option) => option.value === status)?.label;
  const pendingId =
    restoreRoles.isPending && restoreRoles.variables?.ids.length === 1
      ? (restoreRoles.variables.ids[0] ?? null)
      : null;
  const filtered = term !== '' || status !== 'all';
  const countLabel =
    list.isSuccess && (visible.length > 0 || filtered) ? `${visible.length} role` : undefined;

  return (
    <>
      <ListPage
        title="Role"
        count={countLabel}
        createAction={
          canManage ? { label: 'Tambah role', onClick: () => setDialog('new') } : undefined
        }
        filters={
          <FilterBar
            search={{
              value: text,
              onChange: setText,
              placeholder: 'Cari nama atau deskripsi role',
              label: 'Cari role',
            }}
          >
            {canManage ? (
              <FilterChip
                label="Tampilan"
                display={status === 'all' ? null : statusLabel}
                onClear={() =>
                  void navigate({
                    search: (prev) => ({ ...prev, status: undefined }),
                    replace: true,
                  })
                }
              >
                <Select
                  id="roles-filter-status"
                  label="Filter tampilan"
                  hideLabel
                  options={statusOptions}
                  value={status}
                  onValueChange={(next) =>
                    void navigate({
                      search: (prev) => ({ ...prev, status: next as 'all' | 'deleted' }),
                      replace: true,
                    })
                  }
                />
              </FilterChip>
            ) : null}
          </FilterBar>
        }
        bulkBar={
          canManage ? (
            <BulkBar count={selection.count} onClear={selection.clear} busy={bulk.busy}>
              {deletedView ? (
                <ActionButton action="restore" onClick={() => void bulk.restore.run()} />
              ) : (
                <DisabledReason
                  reason={
                    inUse.length > 0 ? 'Ada role terpilih yang masih dipakai pengguna' : undefined
                  }
                >
                  <ActionButton
                    action="delete"
                    disabled={inUse.length > 0}
                    onClick={() => setDeleteTarget({ kind: 'bulk' })}
                  />
                </DisabledReason>
              )}
            </BulkBar>
          ) : null
        }
      >
        <RolesTable
          roles={visible}
          deletedView={deletedView}
          canManage={canManage}
          selection={canManage ? selection : undefined}
          pendingId={pendingId}
          onEdit={(role) => setDialog(role)}
          onDelete={(role) => setDeleteTarget({ kind: 'row', role })}
          onRestore={restoreRow}
          filtered={filtered}
          onClearFilters={() => {
            setText('');
            void navigate({ search: {}, replace: true });
          }}
          emptyAction={
            canManage ? (
              <Button type="button" onClick={() => setDialog('new')}>
                Tambah role
              </Button>
            ) : undefined
          }
          isLoading={list.isPending}
          isError={list.isLoadingError}
          onRetry={reload}
        />
      </ListPage>
      <RoleFormDialog
        open={dialog !== null}
        onOpenChange={(open) => (open ? undefined : setDialog(null))}
        role={dialog === null || dialog === 'new' ? undefined : dialog}
        onSave={async (input) => {
          await saveRole.mutateAsync(input);
          toast.success('Role disimpan');
        }}
      />
      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        count={deleteTarget?.kind === 'bulk' ? selection.count : 1}
        subject="role"
        {...(deleteTarget?.kind === 'row' && deleteTarget.role.userCount > 0
          ? { usage: `Dipakai ${deleteTarget.role.userCount} pengguna` }
          : {})}
        onConfirm={confirmDelete}
        busy={bulk.remove.busy || removeRoles.isPending}
      />
    </>
  );
}
