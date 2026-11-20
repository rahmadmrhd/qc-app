import type { StickerDto, StickerStockDto } from '@shared/contract';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { describeError } from '@/lib/api/describe-error';
import { businessUnitLinkAccess, stickerTypeLinkAccess } from '@/lib/link-access';
import { businessUnitOptionsQueryOptions, useSaveBusinessUnit } from '@/modules/access/queries';
import { can, locationsWith, requireAnyPermission } from '@/modules/auth/permissions';
import { meQueryOptions } from '@/modules/auth/queries';
import { useMe } from '@/modules/auth/use-me';
import { useActiveLocations } from '@/modules/location/active-locations-context';
import { NoLocationNotice } from '@/modules/location/components/no-location-notice';
import {
  type StickerSaveInput,
  type StickerSaveResult,
  stickerSaveFailure,
} from '@/modules/sticker/components/sticker-form-dialog';
import { StickersPage } from '@/modules/sticker/components/stickers-page';
import {
  type StockSaveResult,
  type StockWrite,
  stockSaveFailure,
} from '@/modules/sticker/components/stock-entry-dialog';
import { StockHistoryDialog } from '@/modules/sticker/components/stock-history';
import { stickerKeys } from '@/modules/sticker/keys';
import { isStaleSaveError } from '@/modules/sticker/lib/stale';
import { nextStickerStatus } from '@/modules/sticker/lib/status';
import {
  stickerStockQuery,
  stickersQuery,
  stickerTypesQuery,
  useAdjustStock,
  useRecordStock,
  useSaveSticker,
  useSaveStickerType,
  useSetStickerStatus,
} from '@/modules/sticker/queries';

export const Route = createFileRoute('/_app/sticker/')({
  // Katalog (`sticker: view`) ATAU stok (`stickerstock: view` di minimal satu lokasi): halaman menyesuaikan isinya.
  beforeLoad: ({ context }) =>
    requireAnyPermission(context.queryClient, [
      { module: 'sticker', level: 'view' },
      { module: 'stickerstock', level: 'view' },
    ]),
  loader: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions());
    if (!can(me, 'sticker', 'view')) return;
    await Promise.all([
      context.queryClient.ensureQueryData(stickersQuery()),
      context.queryClient.ensureQueryData(stickerTypesQuery()),
      context.queryClient.ensureQueryData(businessUnitOptionsQueryOptions()),
    ]);
  },
  component: StickersRoute,
});

function StickersRoute() {
  const me = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { selectedIds } = useActiveLocations();
  const canCatalog = can(me, 'sticker', 'view');
  // Hanya lokasi terpilih yang boleh dilihat user yang diminta: satu lokasi terlarang menolak seluruh permintaan.
  const readable = locationsWith(me, 'stickerstock', 'view', selectedIds);
  const readableIds = readable.map((location) => location.id);
  const canStock = readable.length > 0;

  const stickers = useQuery({ ...stickersQuery(), enabled: canCatalog });
  const types = useQuery({ ...stickerTypesQuery(), enabled: canCatalog });
  const businessUnits = useQuery({ ...businessUnitOptionsQueryOptions(), enabled: canCatalog });
  const stock = useQuery({ ...stickerStockQuery(readableIds), enabled: canStock });
  const save = useSaveSticker();
  const saveType = useSaveStickerType();
  const saveBusinessUnit = useSaveBusinessUnit();
  const setStatus = useSetStickerStatus();
  const record = useRecordStock();
  const adjust = useAdjustStock();
  const [historyOf, setHistoryOf] = useState<StickerStockDto | null>(null);
  const typeLinks = stickerTypeLinkAccess(me);
  const buLinks = businessUnitLinkAccess(me);

  const refetchStock = () => queryClient.invalidateQueries({ queryKey: stickerKeys.stocks });

  async function handleSave(input: StickerSaveInput): Promise<StickerSaveResult> {
    try {
      await save.mutateAsync(input);
      toast.success(input.id ? 'Stiker diperbarui' : 'Stiker ditambahkan');
      return null;
    } catch (error) {
      // Versi usang: muat ulang daftar agar tabel (dan form yang dibuka ulang) memakai data terbaru.
      if (isStaleSaveError(error))
        void queryClient.invalidateQueries({ queryKey: stickerKeys.all });
      return stickerSaveFailure(error);
    }
  }

  function toggleStatus(sticker: StickerDto) {
    const status = nextStickerStatus(sticker.status);
    setStatus.mutate(
      { id: sticker.id, status },
      {
        onSuccess: () =>
          toast.success(status === 'active' ? 'Stiker diaktifkan' : 'Stiker dinonaktifkan'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  async function handleWrite(write: StockWrite): Promise<StockSaveResult> {
    try {
      if (write.type === 'record') await record.mutateAsync(write.input);
      else await adjust.mutateAsync(write.input);
      toast.success('Stok dicatat');
      return null;
    } catch (error) {
      // Stok bisa berubah oleh orang lain (mis. stok tidak cukup): muat ulang agar angka yang tampil terbaru.
      void refetchStock();
      return stockSaveFailure(error);
    }
  }

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
  const failed = [stickers, types, businessUnits, stock].find((query) => query.isError);
  if (failed) {
    return (
      <p role="alert" className="text-sm text-destructive-text">
        {describeError(failed.error)}
      </p>
    );
  }
  if (
    (canCatalog && (stickers.isPending || types.isPending || businessUnits.isPending)) ||
    (canStock && stock.isPending)
  ) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <>
      <StickersPage
        stickers={canCatalog ? stickers.data : undefined}
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
                onStartOpname: () => void navigate({ to: '/sticker/opname' }),
                onShowHistory: setHistoryOf,
              }
            : undefined
        }
        canEdit={can(me, 'sticker', 'edit')}
        canManage={can(me, 'sticker', 'manage')}
        pendingStatusId={setStatus.isPending ? (setStatus.variables?.id ?? null) : null}
        onSave={handleSave}
        onCreateType={
          typeLinks.canCreateStickerType ? (input) => saveType.mutateAsync(input) : undefined
        }
        onCreateBusinessUnit={
          buLinks.canCreateBusinessUnit ? (input) => saveBusinessUnit.mutateAsync(input) : undefined
        }
        openBusinessUnitHref={buLinks.openBusinessUnitHref}
        onToggleStatus={toggleStatus}
      />
      <StockHistoryDialog
        sticker={historyOf}
        locationIds={readableIds}
        locationNames={new Map(readable.map((location) => [location.id, location.name]))}
        onClose={() => setHistoryOf(null)}
      />
    </>
  );
}
