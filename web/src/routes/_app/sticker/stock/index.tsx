import type { StickerStockDto } from '@shared/contract';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { describeError } from '@/lib/api/describe-error';
import { locationsWith, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { useActiveLocations } from '@/modules/location/active-locations-context';
import { NoLocationNotice } from '@/modules/location/components/no-location-notice';
import {
  type StockSaveResult,
  type StockWrite,
  stockSaveFailure,
} from '@/modules/sticker/components/stock-entry-dialog';
import { StockHistoryDialog } from '@/modules/sticker/components/stock-history';
import { StockPage } from '@/modules/sticker/components/stock-page';
import { stickerKeys } from '@/modules/sticker/keys';
import { stickerStockQuery, useAdjustStock, useRecordStock } from '@/modules/sticker/queries';

export const Route = createFileRoute('/_app/sticker/stock/')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'stickerstock', 'view'),
  component: StickerStockRoute,
});

function StickerStockRoute() {
  const me = useMe();
  const queryClient = useQueryClient();
  const { selectedIds } = useActiveLocations();
  // Hanya lokasi terpilih yang boleh dilihat user yang diminta: satu lokasi terlarang menolak seluruh permintaan.
  const readable = locationsWith(me, 'stickerstock', 'view', selectedIds);
  const readableIds = readable.map((location) => location.id);
  const stock = useQuery(stickerStockQuery(readableIds));
  const record = useRecordStock();
  const adjust = useAdjustStock();
  const navigate = useNavigate();
  const [historyOf, setHistoryOf] = useState<StickerStockDto | null>(null);

  const refetchStock = () => queryClient.invalidateQueries({ queryKey: stickerKeys.stocks });

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

  if (readable.length === 0) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Stok Stiker</h1>
        <NoLocationNotice />
        <p className="text-sm text-muted-foreground">
          Tidak ada lokasi aktif yang dapat Anda lihat stoknya. Pilih lokasi lain di header.
        </p>
      </div>
    );
  }
  if (stock.isPending) return <Skeleton className="h-64 w-full" />;
  if (stock.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {describeError(stock.error)}
      </p>
    );
  }

  return (
    <>
      <StockPage
        rows={stock.data}
        locations={readable}
        canEdit={locationsWith(me, 'stickerstock', 'edit', selectedIds).length > 0}
        canManage={locationsWith(me, 'stickerstock', 'manage', selectedIds).length > 0}
        onWrite={handleWrite}
        onStartOpname={() => void navigate({ to: '/sticker/stock/opname' })}
        onShowHistory={setHistoryOf}
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
