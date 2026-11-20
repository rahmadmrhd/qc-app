import type { BrandDto } from '@shared/contract';
import { normalizeKey } from '@shared/items';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { ActionButton } from '@/components/action-button';
import { BulkBar, useBulkAction, useRowSelection } from '@/components/data-table';
import { DisabledReason } from '@/components/disabled-reason';
import { FilterBar, FilterChip } from '@/components/page/filter-bar';
import { ListPage } from '@/components/page/list-page';
import { Select } from '@/components/select';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { statusFilterOptions } from '@/components/soft-delete/status-filter';
import { Button } from '@/components/ui/button';
import { describeError } from '@/lib/api/describe-error';
import { businessUnitLinkAccess } from '@/lib/link-access';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import { businessUnitOptionsQueryOptions, useSaveBusinessUnit } from '@/modules/access/queries';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { BrandFormDialog } from '@/modules/brand/components/brand-form-dialog';
import { BrandsManager } from '@/modules/brand/components/brands-manager';
import { useBrandSave } from '@/modules/brand/lib/use-brand-save';
import {
  brandsQueryOptions,
  useRemoveBrands,
  useRestoreBrands,
  useSetBrandStatus,
  useSetBrandStatusBatch,
} from '@/modules/brand/queries';

const searchSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
  status: z.enum(['all', 'active', 'inactive', 'deleted']).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/item/brands/')({
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'item', 'view'),
  loader: ({ context, location }) => {
    const search = searchSchema.parse(location.search);
    return Promise.all([
      // Tampilan Terhapus hanya untuk `item: manage`: tak dimuat di loader (server akan menolaknya).
      search.status === 'deleted'
        ? undefined
        : context.queryClient.ensureQueryData(brandsQueryOptions()),
      context.queryClient.ensureQueryData(businessUnitOptionsQueryOptions()),
    ]);
  },
  component: BrandsPage,
});

type DeleteTarget = { kind: 'bulk' } | { kind: 'row'; brand: BrandDto };

function BrandsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const me = useMe();
  const canEdit = can(me, 'item', 'edit');
  const canManage = can(me, 'item', 'manage');
  // `?status=deleted` tulisan tangan oleh pengguna tanpa hak diperlakukan sebagai "Semua status".
  const status = search.status === 'deleted' && !canManage ? 'all' : (search.status ?? 'all');
  const deletedView = status === 'deleted';
  const { data: businessUnits } = useSuspenseQuery(businessUnitOptionsQueryOptions());
  const list = useQuery(brandsQueryOptions(deletedView ? 'deleted' : undefined));
  const buLinks = businessUnitLinkAccess(me);
  const saveBusinessUnit = useSaveBusinessUnit();
  const saveBrand = useBrandSave();
  const setStatus = useSetBrandStatus();
  const statusBatch = useSetBrandStatusBatch();
  const removeBrands = useRemoveBrands();
  const restoreBrands = useRestoreBrands();
  const selection = useRowSelection(JSON.stringify({ status, q: search.q ?? '' }));
  /** `'new'` = dialog tambah; objek = dialog ubah merk itu. */
  const [dialog, setDialog] = useState<BrandDto | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [text, setText] = useUrlSyncedText(
    search.q ?? '',
    (value) =>
      void navigate({ search: (prev) => ({ ...prev, q: value || undefined }), replace: true }),
  );

  const termKey = normalizeKey(text);
  const visible = (list.data ?? []).filter(
    (brand) =>
      (status === 'all' || status === 'deleted' || brand.status === status) &&
      (termKey === '' || normalizeKey(brand.name).includes(termKey)),
  );

  const reload = () => void list.refetch();
  const activate = useBulkAction({
    selection,
    subject: 'merk',
    verb: 'diaktifkan',
    send: (ids) => statusBatch.mutateAsync({ ids, status: 'active' }).then((r) => r.items),
    undo: { run: (ids) => statusBatch.mutateAsync({ ids, status: 'inactive' }) },
    reload,
  });
  const deactivate = useBulkAction({
    selection,
    subject: 'merk',
    verb: 'dinonaktifkan',
    send: (ids) => statusBatch.mutateAsync({ ids, status: 'inactive' }).then((r) => r.items),
    undo: { run: (ids) => statusBatch.mutateAsync({ ids, status: 'active' }) },
    reload,
  });
  const remove = useBulkAction({
    selection,
    subject: 'merk',
    verb: 'dihapus',
    send: (ids) => removeBrands.mutateAsync({ ids }).then((r) => r.ids),
    undo: { label: 'Pulihkan', run: (ids) => restoreBrands.mutateAsync({ ids }) },
    reload,
  });
  const restore = useBulkAction({
    selection,
    subject: 'merk',
    verb: 'dipulihkan',
    send: (ids) => restoreBrands.mutateAsync({ ids }).then((r) => r.items),
    reload,
  });
  const bulkBusy = activate.busy || deactivate.busy || remove.busy || restore.busy;

  const selected = visible.filter((brand) => selection.selected.has(brand.id));
  const allInactive = selected.every((brand) => brand.status === 'inactive');

  function toggleStatus(brand: BrandDto) {
    const next = brand.status === 'active' ? 'inactive' : 'active';
    setStatus.mutate(
      { id: brand.id, status: next },
      {
        onSuccess: () =>
          toast.success(next === 'active' ? 'Merk diaktifkan' : 'Merk dinonaktifkan'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  function restoreRow(brand: BrandDto) {
    restoreBrands.mutate(
      { ids: [brand.id] },
      {
        onSuccess: () => toast.success('Merk dipulihkan (Nonaktif)'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    if (target.kind === 'bulk') {
      void remove.run().finally(() => setDeleteTarget(null));
      return;
    }
    removeBrands.mutate(
      { ids: [target.brand.id] },
      {
        onSuccess: () => toast.success('Merk dihapus'),
        onError: (error) => toast.error(describeError(error)),
        onSettled: () => setDeleteTarget(null),
      },
    );
  }

  const usedItems =
    deleteTarget?.kind === 'row'
      ? deleteTarget.brand.itemCount
      : selected.reduce((sum, brand) => sum + brand.itemCount, 0);
  const statusOptions = statusFilterOptions(canManage);
  const statusLabel = statusOptions.find((option) => option.value === status)?.label;
  const pendingId = setStatus.isPending
    ? (setStatus.variables?.id ?? null)
    : restoreBrands.isPending && restoreBrands.variables?.ids.length === 1
      ? (restoreBrands.variables.ids[0] ?? null)
      : null;

  const filtered = termKey !== '' || status !== 'all';
  const countLabel =
    list.isSuccess && (visible.length > 0 || filtered) ? `${visible.length} merk` : undefined;

  return (
    <>
      <ListPage
        title="Merk"
        count={countLabel}
        createAction={
          canEdit ? { label: 'Tambah merk', onClick: () => setDialog('new') } : undefined
        }
        filters={
          <FilterBar
            search={{
              value: text,
              onChange: setText,
              placeholder: 'Cari nama merk',
              label: 'Cari merk',
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
                id="brands-filter-status"
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
            <BulkBar count={selection.count} onClear={selection.clear} busy={bulkBusy}>
              {deletedView ? (
                <ActionButton action="restore" onClick={() => void restore.run()} />
              ) : (
                <>
                  <ActionButton action="activate" onClick={() => void activate.run()} />
                  <ActionButton action="deactivate" onClick={() => void deactivate.run()} />
                  <DisabledReason
                    reason={allInactive ? undefined : 'Nonaktifkan merk dulu sebelum dihapus'}
                  >
                    <ActionButton
                      action="delete"
                      disabled={!allInactive}
                      onClick={() => setDeleteTarget({ kind: 'bulk' })}
                    />
                  </DisabledReason>
                </>
              )}
            </BulkBar>
          ) : null
        }
      >
        <BrandsManager
          brands={visible}
          businessUnits={businessUnits}
          deletedView={deletedView}
          canEdit={canEdit}
          canManage={canManage}
          canOpenBusinessUnit={buLinks.openBusinessUnitHref !== undefined}
          selection={canManage ? selection : undefined}
          pendingId={pendingId}
          onEdit={(brand) => setDialog(brand)}
          onToggleStatus={toggleStatus}
          onDelete={(brand) => setDeleteTarget({ kind: 'row', brand })}
          onRestore={restoreRow}
          filtered={filtered}
          onClearFilters={() => {
            setText('');
            void navigate({ search: {}, replace: true });
          }}
          emptyAction={
            canEdit ? (
              <Button type="button" onClick={() => setDialog('new')}>
                Tambah merk
              </Button>
            ) : undefined
          }
          isLoading={list.isPending}
          isError={list.isLoadingError}
          onRetry={reload}
        />
      </ListPage>
      <BrandFormDialog
        open={dialog !== null}
        onOpenChange={(open) => (open ? undefined : setDialog(null))}
        brand={dialog === null || dialog === 'new' ? undefined : dialog}
        businessUnits={businessUnits}
        onSave={saveBrand}
        onCreateBusinessUnit={
          buLinks.canCreateBusinessUnit ? (input) => saveBusinessUnit.mutateAsync(input) : undefined
        }
        openBusinessUnitHref={buLinks.openBusinessUnitHref}
      />
      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        count={deleteTarget?.kind === 'bulk' ? selection.count : 1}
        subject="merk"
        {...(usedItems > 0 ? { usage: `Dipakai ${usedItems} item` } : {})}
        onConfirm={confirmDelete}
        busy={remove.busy || removeBrands.isPending}
      />
    </>
  );
}
