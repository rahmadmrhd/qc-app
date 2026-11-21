import type { LocationDto } from '@shared/contract';
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
import { LocationFormDialog } from '@/modules/access/components/location-form-dialog';
import { LocationsTable } from '@/modules/access/components/locations-table';
import { filterCodeNameRecords } from '@/modules/access/lib/filter-records';
import { useRecordBulk } from '@/modules/access/lib/use-record-bulk';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import {
  locationsQueryOptions,
  useRemoveLocations,
  useRestoreLocations,
  useSaveLocation,
  useSetLocationStatus,
  useSetLocationStatusBatch,
} from '@/modules/access/queries';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';

const searchSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
  status: z.enum(['all', 'active', 'inactive', 'deleted']).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/access/locations/')({
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'access', 'view'),
  loader: ({ context, location }) => {
    const search = searchSchema.parse(location.search);
    // Tampilan Terhapus hanya untuk `access: manage`: tak dimuat di loader (server akan menolaknya).
    return search.status === 'deleted'
      ? undefined
      : context.queryClient.ensureQueryData(locationsQueryOptions());
  },
  component: LocationsPage,
});

type DeleteTarget = { kind: 'bulk' } | { kind: 'row'; location: LocationDto };

function LocationsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const me = useMe();
  const canManage = can(me, 'access', 'manage');
  // `?status=deleted` tulisan tangan oleh pengguna tanpa hak diperlakukan sebagai "Semua status".
  const status = search.status === 'deleted' && !canManage ? 'all' : (search.status ?? 'all');
  const deletedView = status === 'deleted';
  const list = useQuery(locationsQueryOptions(deletedView ? 'deleted' : undefined));
  const saveLocation = useSaveLocation();
  const setStatus = useSetLocationStatus();
  const statusBatch = useSetLocationStatusBatch();
  const removeLocations = useRemoveLocations();
  const restoreLocations = useRestoreLocations();
  const selection = useRowSelection(JSON.stringify({ status, q: search.q ?? '' }));
  /** `'new'` = dialog tambah; objek = dialog ubah lokasi itu. */
  const [dialog, setDialog] = useState<LocationDto | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [text, setText] = useUrlSyncedText(
    search.q ?? '',
    (value) =>
      void navigate({ search: (prev) => ({ ...prev, q: value || undefined }), replace: true }),
  );

  const visible = filterCodeNameRecords(list.data ?? [], {
    q: text,
    status: status === 'deleted' ? 'all' : status,
  });
  const reload = () => void list.refetch();
  const bulk = useRecordBulk({
    selection,
    subject: 'lokasi',
    rows: visible,
    setStatusBatch: (input) => statusBatch.mutateAsync(input),
    removeBatch: (input) => removeLocations.mutateAsync(input),
    restoreBatch: (input) => restoreLocations.mutateAsync(input),
    reload,
  });

  const selected = visible.filter((location) => selection.selected.has(location.id));
  const allInactive = selected.every((location) => location.status === 'inactive');

  function toggleStatus(location: LocationDto) {
    const next = location.status === 'active' ? 'inactive' : 'active';
    setStatus.mutate(
      { id: location.id, status: next },
      {
        onSuccess: () =>
          toast.success(next === 'active' ? 'Lokasi diaktifkan' : 'Lokasi dinonaktifkan'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  function restoreRow(location: LocationDto) {
    restoreLocations.mutate(
      { ids: [location.id] },
      {
        onSuccess: () => toast.success('Lokasi dipulihkan (Nonaktif)'),
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
    removeLocations.mutate(
      { ids: [target.location.id] },
      {
        onSuccess: () => toast.success('Lokasi dihapus'),
        onError: (error) => toast.error(describeError(error)),
        onSettled: () => setDeleteTarget(null),
      },
    );
  }

  const statusOptions = statusFilterOptions(canManage);
  const statusLabel = statusOptions.find((option) => option.value === status)?.label;
  const pendingId = setStatus.isPending
    ? (setStatus.variables?.id ?? null)
    : restoreLocations.isPending && restoreLocations.variables?.ids.length === 1
      ? (restoreLocations.variables.ids[0] ?? null)
      : null;
  const filtered = text.trim() !== '' || status !== 'all';
  const countLabel =
    list.isSuccess && (visible.length > 0 || filtered) ? `${visible.length} lokasi` : undefined;

  return (
    <>
      <ListPage
        title="Lokasi"
        count={countLabel}
        createAction={
          canManage ? { label: 'Tambah lokasi', onClick: () => setDialog('new') } : undefined
        }
        filters={
          <FilterBar
            search={{
              value: text,
              onChange: setText,
              placeholder: 'Cari kode atau nama lokasi',
              label: 'Cari lokasi',
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
                id="locations-filter-status"
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
                  <ActionButton action="deactivate" onClick={() => void bulk.deactivate.run()} />
                  <DisabledDeleteAction
                    disabled={!allInactive}
                    onClick={() => setDeleteTarget({ kind: 'bulk' })}
                  />
                </>
              )}
            </BulkBar>
          ) : null
        }
      >
        <LocationsTable
          locations={visible}
          deletedView={deletedView}
          canManage={canManage}
          selection={canManage ? selection : undefined}
          pendingId={pendingId}
          onEdit={(location) => setDialog(location)}
          onToggleStatus={toggleStatus}
          onDelete={(location) => setDeleteTarget({ kind: 'row', location })}
          onRestore={restoreRow}
          filtered={filtered}
          onClearFilters={() => {
            setText('');
            void navigate({ search: {}, replace: true });
          }}
          emptyAction={
            canManage ? (
              <Button type="button" onClick={() => setDialog('new')}>
                Tambah lokasi
              </Button>
            ) : undefined
          }
          isLoading={list.isPending}
          isError={list.isLoadingError}
          onRetry={reload}
        />
      </ListPage>
      <LocationFormDialog
        open={dialog !== null}
        onOpenChange={(open) => (open ? undefined : setDialog(null))}
        location={dialog === null || dialog === 'new' ? undefined : dialog}
        onSave={async (input) => {
          await saveLocation.mutateAsync(input);
          toast.success('Lokasi disimpan');
        }}
      />
      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        count={deleteTarget?.kind === 'bulk' ? selection.count : 1}
        subject="lokasi"
        onConfirm={confirmDelete}
        busy={bulk.remove.busy || removeLocations.isPending}
      />
    </>
  );
}

/** Hapus massal: hanya lokasi Nonaktif yang dapat dihapus, jadi aksi dinonaktifkan dengan alasan bila ada yang Aktif. */
function DisabledDeleteAction({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <DisabledReason reason={disabled ? 'Nonaktifkan lokasi dulu sebelum dihapus' : undefined}>
      <ActionButton action="delete" disabled={disabled} onClick={onClick} />
    </DisabledReason>
  );
}
