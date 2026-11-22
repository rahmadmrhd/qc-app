import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { Skeleton } from '@/components/ui/skeleton';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { describeError } from '@/lib/api/describe-error';
import { FILTER_LIST_MAX } from '@/lib/filter-limits';
import { businessUnitLinkAccess, stickerTypeLinkAccess } from '@/lib/link-access';
import { businessUnitOptionsQueryOptions, useSaveBusinessUnit } from '@/modules/access/queries';
import { can, locationsWith, requireAnyPermission } from '@/modules/auth/permissions';
import { meQueryOptions } from '@/modules/auth/queries';
import { useMe } from '@/modules/auth/use-me';
import { useActiveLocations } from '@/modules/location/active-locations-context';
import { NoLocationNotice } from '@/modules/location/components/no-location-notice';
import {
  type StickerMutations,
  type StickersFilter,
  StickersPage,
} from '@/modules/sticker/components/stickers-page';
import { nextStickerStatus } from '@/modules/sticker/lib/status';
import { useStickerSave } from '@/modules/sticker/lib/use-sticker-save';
import { useStockWrites } from '@/modules/sticker/lib/use-stock-writes';
import {
  stickerStockQuery,
  stickersQuery,
  stickerTypesQuery,
  useRemoveStickers,
  useRestoreStickers,
  useSaveStickerType,
  useSetStickerStatus,
  useSetStickerStatusBatch,
} from '@/modules/sticker/queries';

const searchSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
  /** Id jenis tunggal (tautan dari View/daftar Jenis); pada mode stok saja berisi nama jenis. Tetap diterima. */
  typeId: z.string().max(100).optional().catch(undefined),
  /** Beberapa jenis sekaligus (filter chip Jenis); bila ada, mengalahkan `typeId`. */
  typeIds: z.array(z.string().max(100)).max(FILTER_LIST_MAX).optional().catch(undefined),
  status: z
    .enum(['all', 'active', 'inactive', 'deprecated', 'deleted'])
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute('/_app/sticker/')({
  staticData: { locationAware: true },
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  // Katalog (`sticker: view`) ATAU stok (`stickerstock: view` di minimal satu lokasi): halaman menyesuaikan isinya.
  beforeLoad: ({ context }) =>
    requireAnyPermission(context.queryClient, [
      { module: 'sticker', level: 'view' },
      { module: 'stickerstock', level: 'view' },
    ]),
  loader: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions());
    if (!can(me, 'sticker', 'view')) return;
    const search = searchSchema.parse(location.search);
    await Promise.all([
      // Tampilan Terhapus hanya untuk `sticker: manage`: tak dimuat di loader (server akan menolaknya).
      search.status === 'deleted'
        ? undefined
        : context.queryClient.ensureQueryData(stickersQuery()),
      context.queryClient.ensureQueryData(stickerTypesQuery()),
      context.queryClient.ensureQueryData(businessUnitOptionsQueryOptions()),
    ]);
  },
  component: StickersRoute,
});

function StickersRoute() {
  const me = useMe();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const stack = useStackNavigation();
  const { selectedIds } = useActiveLocations();
  const canCatalog = can(me, 'sticker', 'view');
  const canManage = can(me, 'sticker', 'manage');
  // `?status=deleted` tulisan tangan oleh pengguna tanpa hak diperlakukan sebagai "Semua status".
  const status = search.status === 'deleted' && !canManage ? 'all' : (search.status ?? 'all');
  const deletedView = status === 'deleted';
  // Hanya lokasi terpilih yang boleh dilihat user yang diminta: satu lokasi terlarang menolak seluruh permintaan.
  const readable = locationsWith(me, 'stickerstock', 'view', selectedIds);
  const readableIds = readable.map((location) => location.id);
  const canStock = readable.length > 0 && !deletedView;

  const stickers = useQuery({
    ...stickersQuery(deletedView ? 'deleted' : undefined),
    enabled: canCatalog,
  });
  const types = useQuery({ ...stickerTypesQuery(), enabled: canCatalog });
  const businessUnits = useQuery({ ...businessUnitOptionsQueryOptions(), enabled: canCatalog });
  const stock = useQuery({ ...stickerStockQuery(readableIds), enabled: canStock });
  const handleSave = useStickerSave();
  const saveType = useSaveStickerType();
  const saveBusinessUnit = useSaveBusinessUnit();
  const setStatus = useSetStickerStatus();
  const statusBatch = useSetStickerStatusBatch();
  const removeStickers = useRemoveStickers();
  const restoreStickers = useRestoreStickers();
  const { handleWrite } = useStockWrites();
  const typeLinks = stickerTypeLinkAccess(me);
  const buLinks = businessUnitLinkAccess(me);

  const filter: StickersFilter = {
    q: search.q ?? '',
    typeIds: search.typeIds ?? (search.typeId ? [search.typeId] : []),
    status,
  };

  function changeFilter(patch: Partial<StickersFilter>) {
    // Filter/cari mengganti entri riwayat (replace), bukan menumpuknya.
    void navigate({
      search: (prev) => ({
        ...prev,
        ...(patch.q !== undefined ? { q: patch.q || undefined } : {}),
        // Filter jenis memakai `typeIds`; `typeId` lama (tautan masuk) ikut dibuang agar tak hidup lagi.
        ...(patch.typeIds !== undefined
          ? { typeIds: patch.typeIds.length > 0 ? patch.typeIds : undefined, typeId: undefined }
          : {}),
        ...(patch.status !== undefined
          ? { status: patch.status === 'all' ? undefined : patch.status }
          : {}),
      }),
      replace: true,
    });
  }

  const mutations: StickerMutations = {
    setStatus: (ids, next) => statusBatch.mutateAsync({ ids, status: next }).then((r) => r.items),
    remove: (ids) => removeStickers.mutateAsync({ ids }).then((r) => r.ids),
    restore: (ids) => restoreStickers.mutateAsync({ ids }).then((r) => r.items),
    reload: () => void stickers.refetch(),
  };

  if (!canCatalog && !canStock) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Stiker</h1>
        <NoLocationNotice />
        <p className="text-sm text-muted-foreground">
          Tidak ada lokasi aktif yang dapat Anda lihat stoknya. Pilih lokasi lain di header.
        </p>
      </div>
    );
  }
  const failed = [types, businessUnits, stock].find((query) => query.isError);
  if (failed) {
    return (
      <p role="alert" className="text-sm text-destructive-text">
        {describeError(failed.error)}
      </p>
    );
  }
  if (
    (canCatalog && (types.isPending || businessUnits.isPending)) ||
    (canStock && stock.isPending)
  ) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <StickersPage
      stickers={canCatalog ? (stickers.data ?? []) : undefined}
      types={types.data ?? []}
      businessUnits={businessUnits.data ?? []}
      stock={
        canStock && stock.data
          ? {
              rows: stock.data,
              locations: readable,
              canEdit: locationsWith(me, 'stickerstock', 'edit', selectedIds).length > 0,
              canManage: locationsWith(me, 'stickerstock', 'manage', selectedIds).length > 0,
              onWrite: handleWrite,
            }
          : undefined
      }
      canEdit={can(me, 'sticker', 'edit')}
      canManage={canManage}
      canOpenBusinessUnit={buLinks.openBusinessUnitHref !== undefined}
      filter={filter}
      onFilterChange={changeFilter}
      pendingStatusId={setStatus.isPending ? (setStatus.variables?.id ?? null) : null}
      onSave={handleSave}
      onCreateType={
        typeLinks.canCreateStickerType ? (input) => saveType.mutateAsync(input) : undefined
      }
      onCreateBusinessUnit={
        buLinks.canCreateBusinessUnit ? (input) => saveBusinessUnit.mutateAsync(input) : undefined
      }
      openBusinessUnitHref={buLinks.openBusinessUnitHref}
      openStickerTypeHref={typeLinks.openStickerTypeHref}
      onToggleStatus={(sticker) => {
        const next = nextStickerStatus(sticker.status);
        setStatus.mutate(
          { id: sticker.id, status: next },
          {
            onSuccess: () =>
              toast.success(next === 'active' ? 'Stiker diaktifkan' : 'Stiker dinonaktifkan'),
            onError: (error) => toast.error(describeError(error)),
          },
        );
      }}
      mutations={mutations}
      onStartOpname={() => stack.push({ to: '/sticker/opname' })}
      onStartEntry={(mode) => stack.push({ to: '/sticker/entry', search: { mode } })}
      isLoading={canCatalog && stickers.isPending}
      isError={canCatalog && stickers.isLoadingError}
      onRetry={() => void stickers.refetch()}
    />
  );
}
