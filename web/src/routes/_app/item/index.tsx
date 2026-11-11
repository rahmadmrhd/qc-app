import type { ItemSummaryDto } from '@shared/contract';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Select } from '@/components/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { describeError } from '@/lib/api/describe-error';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import {
  can,
  canCreateItem,
  canEditItem,
  canManageItem,
  requirePermission,
} from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { ItemFilters } from '@/modules/item/components/item-filters';
import { ItemsTable } from '@/modules/item/components/items-table';
import { filterOfSearch, itemsSearchSchema, searchPatchOf } from '@/modules/item/lib/list-filter';
import { itemsInfiniteQueryOptions, useSetItemStatus } from '@/modules/item/queries';
import { stickersQuery, stickerTypesQuery } from '@/modules/sticker/queries';

export const Route = createFileRoute('/_app/item/')({
  validateSearch: (search: Record<string, unknown>) => itemsSearchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'item', 'view'),
  // Tanpa loaderDeps: mengetik di kolom cari tidak menjalankan ulang loader; daftar memuat halamannya sendiri.
  loader: ({ context, location }) => {
    const search = itemsSearchSchema.parse(location.search);
    return context.queryClient.ensureInfiniteQueryData(
      itemsInfiniteQueryOptions(filterOfSearch(search)),
    );
  },
  component: ItemsPage,
});

function ItemsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const me = useMe();
  const canCreate = canCreateItem(me);
  const filter = filterOfSearch(search);
  const list = useInfiniteQuery(itemsInfiniteQueryOptions(filter));
  // Katalog untuk filter stiker/jenis: hanya bagi yang boleh membacanya (`sticker: view` atau `item: edit`);
  // tanpa itu (atau bila ditolak server) filter stiker/jenis disembunyikan, filter instruksi tetap ada.
  const canReadCatalog = can(me, 'sticker', 'view') || can(me, 'item', 'edit');
  const stickers = useQuery({ ...stickersQuery(), enabled: canReadCatalog, retry: false });
  const types = useQuery({ ...stickerTypesQuery(), enabled: canReadCatalog, retry: false });
  const showStickerFilter = canReadCatalog && stickers.isSuccess && types.isSuccess;
  // Postel hanya terlihat bagi pemegang `sticker: view` (server juga menyaring); tanpa itu tanda dan filter disembunyikan.
  const canViewPostel = can(me, 'sticker', 'view');
  const visible = list.data?.pages.flatMap((page) => page.items) ?? [];
  const setStatus = useSetItemStatus();
  const [text, setText] = useUrlSyncedText(
    search.q ?? '',
    (value) =>
      void navigate({ search: (prev) => ({ ...prev, q: value || undefined }), replace: true }),
  );

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Data Item</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void navigate({ to: '/item/brands' })}>
            Kelola merk
          </Button>
          {canCreate ? (
            <Button onClick={() => void navigate({ to: '/item/new' })}>Tambah item</Button>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Input
          placeholder="Cari merk, tipe, atau nama lain"
          aria-label="Cari item"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <Select
          id="items-filter-status"
          label="Filter status"
          hideLabel
          className="sm:w-48"
          options={[
            { value: 'all', label: 'Semua status' },
            { value: 'active', label: 'Aktif' },
            { value: 'inactive', label: 'Nonaktif' },
          ]}
          value={search.status ?? 'all'}
          onValueChange={(next) =>
            void navigate({
              search: (prev) => ({ ...prev, status: next as 'all' | 'active' | 'inactive' }),
              replace: true,
            })
          }
        />
        <ItemFilters
          filter={filter}
          stickers={stickers.data ?? []}
          types={types.data ?? []}
          showStickerFilter={showStickerFilter}
          showPostelFilter={canViewPostel}
          onChange={(patch) =>
            void navigate({
              search: (prev) => ({ ...prev, ...searchPatchOf(patch) }),
              replace: true,
            })
          }
        />
      </div>
      {list.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Gagal memuat item. Coba muat ulang.
        </p>
      ) : null}
      <ItemsTable
        items={visible}
        canEdit={(item) => canEditItem(me, item)}
        canManage={(item) => canManageItem(me, item)}
        pendingStatusId={setStatus.isPending ? (setStatus.variables?.id ?? null) : null}
        showPostel={canViewPostel}
        onOpen={(item) => void navigate({ to: '/item/$itemId', params: { itemId: item.id } })}
        onEdit={(item) => void navigate({ to: '/item/$itemId/edit', params: { itemId: item.id } })}
        onToggleStatus={toggleStatus}
      />
      {list.hasNextPage ? (
        <Button
          variant="outline"
          className="w-full"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? 'Memuat…' : 'Muat lebih banyak'}
        </Button>
      ) : null}
    </div>
  );
}
