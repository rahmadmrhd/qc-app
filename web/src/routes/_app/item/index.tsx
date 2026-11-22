import type { ItemSummaryDto } from '@shared/contract';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
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
import { brandLinkAccess, businessUnitLinkAccess } from '@/lib/link-access';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import {
  can,
  canCreateItem,
  canEditItem,
  canManageAnyItem,
  canManageItem,
  liveBuIdsWithLevelOf,
  requirePermission,
} from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { brandQueryOptions, brandsQueryOptions } from '@/modules/brand/queries';
import { ItemFilters } from '@/modules/item/components/item-filters';
import { ItemsTable } from '@/modules/item/components/items-table';
import { filterOfSearch, itemsSearchSchema, searchPatchOf } from '@/modules/item/lib/list-filter';
import {
  itemsInfiniteQueryOptions,
  useRemoveItems,
  useRestoreItems,
  useSetItemStatus,
  useSetItemStatusBatch,
} from '@/modules/item/queries';
import { stickersQuery, stickerTypesQuery } from '@/modules/sticker/queries';

export const Route = createFileRoute('/_app/item/')({
  validateSearch: (search: Record<string, unknown>) => itemsSearchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'item', 'view'),
  // Tanpa loaderDeps: mengetik di kolom cari tidak menjalankan ulang loader; daftar memuat halamannya sendiri.
  loader: ({ context, location }) => {
    const search = itemsSearchSchema.parse(location.search);
    // Tampilan Terhapus hanya untuk pemegang `item: manage`: tak dimuat di loader (server akan menolaknya).
    if (search.status === 'deleted') return undefined;
    return context.queryClient.ensureInfiniteQueryData(
      itemsInfiniteQueryOptions(filterOfSearch(search)),
    );
  },
  component: ItemsPage,
});

type DeleteTarget = { kind: 'bulk' } | { kind: 'row'; item: ItemSummaryDto };

function ItemsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const me = useMe();
  const canCreate = canCreateItem(me);
  const manageAny = canManageAnyItem(me);
  // Label dan filter "Belum ada Postel" tampil bagi semua pembaca item, sama seperti Manual Book
  // (keputusan pemilik 2026-11-12, spek 4b §7 butir 5).
  const base = filterOfSearch(search);
  // `?status=deleted` tulisan tangan oleh pengguna tanpa hak diperlakukan sebagai "Semua status".
  const filter =
    base.status === 'deleted' && !manageAny ? { ...base, status: 'all' as const } : base;
  const deletedView = filter.status === 'deleted';
  const list = useInfiniteQuery(itemsInfiniteQueryOptions(filter));
  // Katalog untuk filter stiker/jenis: hanya bagi yang boleh membacanya (`sticker: view` atau `item: edit`);
  // tanpa itu (atau bila ditolak server) filter stiker/jenis disembunyikan, filter instruksi tetap ada.
  const canReadCatalog = can(me, 'sticker', 'view') || can(me, 'item', 'edit');
  const stickers = useQuery({ ...stickersQuery(), enabled: canReadCatalog, retry: false });
  const types = useQuery({ ...stickerTypesQuery(), enabled: canReadCatalog, retry: false });
  const showStickerFilter = canReadCatalog && stickers.isSuccess && types.isSuccess;
  // Chip Merk dan BU: merk hidup dan BU hidup yang boleh dilihat (BU terhapus hanya memberi hak, bukan pilihan).
  const brands = useQuery({ ...brandsQueryOptions(), retry: false });
  // Merk terhapus dari tautan "Lihat item merk ini" tak ada di daftar hidup: nama untuk chip dimuat lewat `brands.get`
  // (hanya bila `brandId` di URL dan belum ada di daftar; galat/ditolak = chip "Merk tidak dikenal").
  const queryClient = useQueryClient();
  // Satu merk di URL yang tak ada di daftar hidup (mis. merk terhapus dari tautan View merk).
  const brandIdInUrl = brands.isSuccess
    ? (filter.brandIds.find((id) => !brands.data?.some((brand) => brand.id === id)) ?? '')
    : '';
  const knownBrand = useQuery({
    ...brandQueryOptions(queryClient, brandIdInUrl),
    enabled: brandIdInUrl !== '',
  });
  const filterBus = liveBuIdsWithLevelOf(me, 'item', 'view').flatMap((id) => {
    const bu = me.businessUnits.find((entry) => entry.id === id);
    return bu ? [{ id, code: bu.code, name: bu.name }] : [];
  });
  const visible = list.data?.pages.flatMap((page) => page.items) ?? [];
  const setStatus = useSetItemStatus();
  const statusBatch = useSetItemStatusBatch();
  const removeItems = useRemoveItems();
  const restoreItems = useRestoreItems();
  const selection = useRowSelection(JSON.stringify(filter));
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [text, setText] = useUrlSyncedText(
    search.q ?? '',
    (value) =>
      void navigate({ search: (prev) => ({ ...prev, q: value || undefined }), replace: true }),
  );

  const reload = () => void list.refetch();
  /** Id terpilih yang memenuhi `changes` (mis. belum Aktif): hanya itu yang dibalik oleh Urungkan. */
  const changedIds = (ids: string[], changes: (item: ItemSummaryDto) => boolean) =>
    ids.filter((id) => {
      const item = visible.find((entry) => entry.id === id);
      return item === undefined || changes(item);
    });
  const activate = useBulkAction({
    selection,
    verb: 'diaktifkan',
    send: (ids) => statusBatch.mutateAsync({ ids, status: 'active' }).then((r) => r.items),
    undo: {
      changed: (ids) => changedIds(ids, (item) => item.status !== 'active'),
      run: (ids) => statusBatch.mutateAsync({ ids, status: 'inactive' }).then((r) => r.items),
    },
    reload,
  });
  const deactivate = useBulkAction({
    selection,
    verb: 'dinonaktifkan',
    send: (ids) => statusBatch.mutateAsync({ ids, status: 'inactive' }).then((r) => r.items),
    undo: {
      changed: (ids) => changedIds(ids, (item) => item.status !== 'inactive'),
      run: (ids) => statusBatch.mutateAsync({ ids, status: 'active' }).then((r) => r.items),
    },
    reload,
  });
  const remove = useBulkAction({
    selection,
    verb: 'dihapus',
    send: (ids) => removeItems.mutateAsync({ ids }).then((r) => r.ids),
    undo: {
      label: 'Pulihkan',
      run: (ids) => restoreItems.mutateAsync({ ids }).then((r) => r.items),
    },
    reload,
  });
  const restore = useBulkAction({
    selection,
    verb: 'dipulihkan',
    send: (ids) => restoreItems.mutateAsync({ ids }).then((r) => r.items),
    reload,
  });
  const bulkBusy = activate.busy || deactivate.busy || remove.busy || restore.busy;

  const selected = visible.filter((item) => selection.selected.has(item.id));
  // Aksi massal hanya bila pengguna berhak `manage` pada SEMUA item terpilih.
  const allManageable = selected.length > 0 && selected.every((item) => canManageItem(me, item));
  const allInactive = selected.every((item) => item.status === 'inactive');
  const manageReason = allManageable
    ? undefined
    : 'Anda tidak berhak mengelola sebagian item yang dipilih';
  const deleteReason = allInactive ? undefined : 'Nonaktifkan item dulu sebelum dihapus';

  function toggleStatus(item: ItemSummaryDto) {
    const status = item.status === 'active' ? 'inactive' : 'active';
    setStatus.mutate(
      { id: item.id, status },
      {
        onSuccess: () =>
          toast.success(status === 'active' ? 'Item diaktifkan' : 'Item dinonaktifkan'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  function restoreRow(item: ItemSummaryDto) {
    restoreItems.mutate(
      { ids: [item.id] },
      {
        onSuccess: () => toast.success('Item dipulihkan (Nonaktif)'),
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
    removeItems.mutate(
      { ids: [target.item.id] },
      {
        onSuccess: () => toast.success('Item dihapus'),
        onError: (error) => toast.error(describeError(error)),
        onSettled: () => setDeleteTarget(null),
      },
    );
  }

  const statusOptions = statusFilterOptions(manageAny);
  const statusLabel = statusOptions.find((option) => option.value === filter.status)?.label;
  const pendingId = setStatus.isPending
    ? (setStatus.variables?.id ?? null)
    : restoreItems.isPending && restoreItems.variables?.ids.length === 1
      ? (restoreItems.variables.ids[0] ?? null)
      : null;

  const filtered =
    filter.query !== '' ||
    filter.status !== 'all' ||
    filter.instruction !== 'all' ||
    filter.stickerKey !== '' ||
    filter.manualBook !== 'all' ||
    filter.postel !== 'all' ||
    filter.brandIds.length > 0 ||
    filter.buIds.length > 0;
  const countLabel =
    list.isSuccess && (visible.length > 0 || filtered)
      ? `${visible.length}${list.hasNextPage ? '+' : ''} item`
      : undefined;

  return (
    <>
      <ListPage
        title="Data Item"
        count={countLabel}
        createAction={
          canCreate
            ? { label: 'Tambah item', onClick: () => void navigate({ to: '/item/new' }) }
            : undefined
        }
        filters={
          <FilterBar
            search={{
              value: text,
              onChange: setText,
              placeholder: 'Cari merk, tipe, atau nama lain',
              label: 'Cari item',
            }}
          >
            <FilterChip
              label="Status"
              display={filter.status === 'all' ? null : statusLabel}
              onClear={() =>
                void navigate({ search: (prev) => ({ ...prev, status: undefined }), replace: true })
              }
            >
              <Select
                id="items-filter-status"
                label="Filter status"
                hideLabel
                options={statusOptions}
                value={filter.status}
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
            <ItemFilters
              filter={filter}
              stickers={stickers.data ?? []}
              types={types.data ?? []}
              brands={brands.data}
              knownBrand={knownBrand.data}
              businessUnits={filterBus}
              showStickerFilter={showStickerFilter}
              onChange={(patch) =>
                void navigate({
                  search: (prev) => ({ ...prev, ...searchPatchOf(patch) }),
                  replace: true,
                })
              }
            />
          </FilterBar>
        }
        bulkBar={
          manageAny ? (
            <BulkBar count={selection.count} onClear={selection.clear} busy={bulkBusy}>
              {deletedView ? (
                <DisabledReason reason={manageReason}>
                  <ActionButton
                    action="restore"
                    disabled={!allManageable}
                    onClick={() => void restore.run()}
                  />
                </DisabledReason>
              ) : (
                <>
                  <DisabledReason reason={manageReason}>
                    <ActionButton
                      action="activate"
                      disabled={!allManageable}
                      onClick={() => void activate.run()}
                    />
                  </DisabledReason>
                  <DisabledReason reason={manageReason}>
                    <ActionButton
                      action="deactivate"
                      disabled={!allManageable}
                      onClick={() => void deactivate.run()}
                    />
                  </DisabledReason>
                  <DisabledReason reason={manageReason ?? deleteReason}>
                    <ActionButton
                      action="delete"
                      disabled={!allManageable || !allInactive}
                      onClick={() => setDeleteTarget({ kind: 'bulk' })}
                    />
                  </DisabledReason>
                </>
              )}
            </BulkBar>
          ) : null
        }
      >
        <ItemsTable
          items={visible}
          deletedView={deletedView}
          canEdit={(item) => canEditItem(me, item)}
          canManage={(item) => canManageItem(me, item)}
          canOpenBrand={brandLinkAccess(me).openBrandHref !== undefined}
          canOpenDeletedBrand={manageAny}
          canOpenBusinessUnit={businessUnitLinkAccess(me).openBusinessUnitHref !== undefined}
          selection={manageAny ? selection : undefined}
          pendingId={pendingId}
          onEdit={(item) =>
            void navigate({ to: '/item/$itemId/edit', params: { itemId: item.id } })
          }
          onToggleStatus={toggleStatus}
          onDelete={(item) => setDeleteTarget({ kind: 'row', item })}
          onRestore={restoreRow}
          filtered={filtered}
          onClearFilters={() => {
            setText('');
            void navigate({ search: {}, replace: true });
          }}
          emptyAction={
            canCreate ? (
              <Button type="button" onClick={() => void navigate({ to: '/item/new' })}>
                Tambah item
              </Button>
            ) : undefined
          }
          isLoading={list.isPending}
          isError={list.isLoadingError}
          onRetry={reload}
          hasMore={list.hasNextPage}
          loadingMore={list.isFetchingNextPage}
          loadMoreError={list.isFetchNextPageError}
          onLoadMore={() => void list.fetchNextPage()}
        />
      </ListPage>
      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        count={deleteTarget?.kind === 'bulk' ? selection.count : 1}
        subject="item"
        onConfirm={confirmDelete}
        busy={remove.busy || removeItems.isPending}
      />
    </>
  );
}
