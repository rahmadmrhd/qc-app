import type { BusinessUnitDto } from '@shared/contract';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { ActionButton } from '@/components/action-button';
import { BulkBar, useRowSelection } from '@/components/data-table';
import { FilterBar, FilterChip } from '@/components/page/filter-bar';
import { ListPage } from '@/components/page/list-page';
import { Select } from '@/components/select';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { statusFilterOptions } from '@/components/soft-delete/status-filter';
import { Button } from '@/components/ui/button';
import { describeError } from '@/lib/api/describe-error';
import {
  BusinessUnitDeactivateDialog,
  needsDeactivateConfirmation,
} from '@/modules/access/components/business-unit-deactivate-dialog';
import { BusinessUnitFormDialog } from '@/modules/access/components/business-unit-form-dialog';
import { BusinessUnitsTable } from '@/modules/access/components/business-units-table';
import { filterCodeNameRecords } from '@/modules/access/lib/filter-records';
import { useRecordBulk } from '@/modules/access/lib/use-record-bulk';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import {
  businessUnitsQueryOptions,
  useRemoveBusinessUnits,
  useRestoreBusinessUnits,
  useSaveBusinessUnit,
  useSetBusinessUnitStatus,
  useSetBusinessUnitStatusBatch,
} from '@/modules/access/queries';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';

const searchSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
  status: z.enum(['all', 'active', 'inactive', 'deleted']).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/access/business-units/')({
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'access', 'view'),
  loader: ({ context, location }) => {
    const search = searchSchema.parse(location.search);
    // Tampilan Terhapus hanya untuk `access: manage`: tak dimuat di loader (server akan menolaknya).
    return search.status === 'deleted'
      ? undefined
      : context.queryClient.ensureQueryData(businessUnitsQueryOptions());
  },
  component: BusinessUnitsPage,
});

type DeleteTarget = { kind: 'bulk' } | { kind: 'row'; businessUnit: BusinessUnitDto };

function BusinessUnitsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const me = useMe();
  const canManage = can(me, 'access', 'manage');
  // `?status=deleted` tulisan tangan oleh pengguna tanpa hak diperlakukan sebagai "Semua status".
  const status = search.status === 'deleted' && !canManage ? 'all' : (search.status ?? 'all');
  const deletedView = status === 'deleted';
  const list = useQuery(businessUnitsQueryOptions(deletedView ? 'deleted' : undefined));
  const saveBusinessUnit = useSaveBusinessUnit();
  const setStatus = useSetBusinessUnitStatus();
  const statusBatch = useSetBusinessUnitStatusBatch();
  const removeBusinessUnits = useRemoveBusinessUnits();
  const restoreBusinessUnits = useRestoreBusinessUnits();
  const selection = useRowSelection(JSON.stringify({ status, q: search.q ?? '' }));
  /** `'new'` = dialog tambah; objek = dialog ubah BU itu. */
  const [dialog, setDialog] = useState<BusinessUnitDto | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  /** BU (satu atau banyak) yang menunggu konfirmasi nonaktifkan karena masih dipakai. */
  const [deactivating, setDeactivating] = useState<{
    rows: readonly BusinessUnitDto[];
    bulk: boolean;
  } | null>(null);
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
    subject: 'BU',
    rows: visible,
    setStatusBatch: (input) => statusBatch.mutateAsync(input),
    removeBatch: (input) => removeBusinessUnits.mutateAsync(input),
    restoreBatch: (input) => restoreBusinessUnits.mutateAsync(input),
    reload,
  });

  const selected = visible.filter((bu) => selection.selected.has(bu.id));

  function applyStatus(bu: BusinessUnitDto, next: 'active' | 'inactive') {
    setStatus.mutate(
      { id: bu.id, status: next },
      {
        onSuccess: () =>
          toast.success(
            next === 'active' ? 'Business Unit diaktifkan' : 'Business Unit dinonaktifkan',
          ),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  function toggleStatus(bu: BusinessUnitDto) {
    if (needsDeactivateConfirmation(bu)) setDeactivating({ rows: [bu], bulk: false });
    else applyStatus(bu, bu.status === 'active' ? 'inactive' : 'active');
  }

  function deactivateSelected() {
    // Hanya BU yang memenuhi syarat Nonaktifkan (Aktif) yang dikirim dan dihitung pada konfirmasi.
    const inUse = selected.filter(
      (bu) => bulk.isEligible.deactivate(bu.id) && needsDeactivateConfirmation(bu),
    );
    if (inUse.length > 0) setDeactivating({ rows: inUse, bulk: true });
    else void bulk.deactivate.run();
  }

  function confirmDeactivate() {
    const target = deactivating;
    setDeactivating(null);
    const [only] = target?.rows ?? [];
    if (target && !target.bulk && only) applyStatus(only, 'inactive');
    else if (target) void bulk.deactivate.run();
  }

  function restoreRow(bu: BusinessUnitDto) {
    restoreBusinessUnits.mutate(
      { ids: [bu.id] },
      {
        onSuccess: () => toast.success('Business Unit dipulihkan (Nonaktif)'),
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
    removeBusinessUnits.mutate(
      { ids: [target.businessUnit.id] },
      {
        onSuccess: () => toast.success('Business Unit dihapus'),
        onError: (error) => toast.error(describeError(error)),
        onSettled: () => setDeleteTarget(null),
      },
    );
  }

  const deleteUsage = (() => {
    if (deleteTarget?.kind === 'row') {
      const { itemCount, userCount } = deleteTarget.businessUnit;
      return itemCount > 0 || userCount > 0
        ? `Dipakai ${itemCount} item, ${userCount} pengguna`
        : undefined;
    }
    if (deleteTarget?.kind === 'bulk') {
      const doomed = selected.filter((bu) => bulk.isEligible.remove(bu.id));
      const items = doomed.reduce((sum, bu) => sum + bu.itemCount, 0);
      const users = doomed.reduce((sum, bu) => sum + bu.userCount, 0);
      return items > 0 || users > 0 ? `Dipakai ${items} item, ${users} pengguna` : undefined;
    }
    return undefined;
  })();

  const statusOptions = statusFilterOptions(canManage);
  const statusLabel = statusOptions.find((option) => option.value === status)?.label;
  const pendingId = setStatus.isPending
    ? (setStatus.variables?.id ?? null)
    : restoreBusinessUnits.isPending && restoreBusinessUnits.variables?.ids.length === 1
      ? (restoreBusinessUnits.variables.ids[0] ?? null)
      : null;
  const filtered = text.trim() !== '' || status !== 'all';
  const countLabel =
    list.isSuccess && (visible.length > 0 || filtered) ? `${visible.length} BU` : undefined;

  return (
    <>
      <ListPage
        title="Business Unit"
        count={countLabel}
        createAction={
          canManage ? { label: 'Tambah BU', onClick: () => setDialog('new') } : undefined
        }
        filters={
          <FilterBar
            search={{
              value: text,
              onChange: setText,
              placeholder: 'Cari kode atau nama BU',
              label: 'Cari Business Unit',
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
                id="business-units-filter-status"
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
                  {bulk.activate.eligibleCount > 0 ? (
                    <ActionButton action="activate" onClick={() => void bulk.activate.run()} />
                  ) : null}
                  {bulk.deactivate.eligibleCount > 0 ? (
                    <ActionButton action="deactivate" onClick={deactivateSelected} />
                  ) : null}
                  {bulk.remove.eligibleCount > 0 ? (
                    <ActionButton
                      action="delete"
                      onClick={() => setDeleteTarget({ kind: 'bulk' })}
                    />
                  ) : null}
                </>
              )}
            </BulkBar>
          ) : null
        }
      >
        <BusinessUnitsTable
          businessUnits={visible}
          deletedView={deletedView}
          canManage={canManage}
          selection={canManage ? selection : undefined}
          pendingId={pendingId}
          onEdit={(bu) => setDialog(bu)}
          onToggleStatus={toggleStatus}
          onDelete={(bu) => setDeleteTarget({ kind: 'row', businessUnit: bu })}
          onRestore={restoreRow}
          filtered={filtered}
          onClearFilters={() => {
            setText('');
            void navigate({ search: {}, replace: true });
          }}
          emptyAction={
            canManage ? (
              <Button type="button" onClick={() => setDialog('new')}>
                Tambah BU
              </Button>
            ) : undefined
          }
          isLoading={list.isPending}
          isError={list.isLoadingError}
          onRetry={reload}
        />
      </ListPage>
      <BusinessUnitFormDialog
        open={dialog !== null}
        onOpenChange={(open) => (open ? undefined : setDialog(null))}
        businessUnit={dialog === null || dialog === 'new' ? undefined : dialog}
        onSave={async (input) => {
          await saveBusinessUnit.mutateAsync(input);
          toast.success('Business Unit disimpan');
        }}
      />
      <BusinessUnitDeactivateDialog
        businessUnits={deactivating?.rows ?? []}
        onCancel={() => setDeactivating(null)}
        onConfirm={confirmDeactivate}
      />
      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        count={deleteTarget?.kind === 'bulk' ? bulk.remove.eligibleCount : 1}
        subject="BU"
        {...(deleteUsage ? { usage: deleteUsage } : {})}
        onConfirm={confirmDelete}
        busy={bulk.remove.busy || removeBusinessUnits.isPending}
      />
    </>
  );
}
