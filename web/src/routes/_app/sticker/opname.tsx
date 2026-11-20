import type { OpnameInput } from '@shared/contract';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useBlocker, useNavigate } from '@tanstack/react-router';
import { useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { locationsWith, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { useActiveLocations } from '@/modules/location/active-locations-context';
import { NoLocationNotice } from '@/modules/location/components/no-location-notice';
import {
  OPNAME_STALE_MESSAGE,
  OpnamePage,
  type OpnameSaveResult,
} from '@/modules/sticker/components/opname-page';
import { stickerKeys } from '@/modules/sticker/keys';
import { stickerStockQuery, useOpname } from '@/modules/sticker/queries';

export const Route = createFileRoute('/_app/sticker/opname')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'stickerstock', 'manage'),
  component: StickerOpnameRoute,
  staticData: { crumb: 'Opname stok', locationAware: true },
});

const LEAVE_MESSAGE = 'Hitungan opname belum disimpan dan akan hilang. Tetap keluar dari halaman?';

function StickerOpnameRoute() {
  const me = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { selectedIds } = useActiveLocations();
  // Hanya lokasi terpilih yang boleh dilihat user yang diminta: satu lokasi terlarang menolak seluruh permintaan.
  const readable = locationsWith(me, 'stickerstock', 'view', selectedIds);
  const stock = useQuery(stickerStockQuery(readable.map((location) => location.id)));
  const opname = useOpname();
  const dirty = useRef(false);
  // Stabil agar efek di halaman hanya jalan saat status kotor berubah (bukan tiap render, yang dapat menyalakan lagi
  // penanda setelah simpan berhasil dan memicu konfirmasi keluar yang keliru).
  const setDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  // Hitungan hilang bila halaman ditinggalkan (tautan sidebar, tombol kembali): tanyakan dulu. Menutup tab juga.
  useBlocker({
    shouldBlockFn: () => dirty.current && !window.confirm(LEAVE_MESSAGE),
    enableBeforeUnload: () => dirty.current,
  });

  const backToStock = () => void navigate({ to: '/sticker' });

  async function handleOpname(input: OpnameInput): Promise<OpnameSaveResult> {
    try {
      await opname.mutateAsync(input);
      toast.success('Stok opname disimpan');
      return null;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONFLICT') {
        // Opname tak berETag: 409 berarti stok berubah sejak dihitung. Muat ulang dulu agar "Hitung ulang" memakai data baru.
        await queryClient.invalidateQueries({ queryKey: stickerKeys.stocks });
        return { message: OPNAME_STALE_MESSAGE, stale: true };
      }
      return { message: describeError(error) };
    }
  }

  if (locationsWith(me, 'stickerstock', 'manage', selectedIds).length === 0) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Stok opname</h1>
        <NoLocationNotice />
        <p className="text-sm text-muted-foreground">
          Tidak ada lokasi terpilih yang dapat Anda kelola stoknya. Pilih lokasi lain di header.
        </p>
      </div>
    );
  }
  if (stock.isPending) return <Skeleton className="h-64 w-full" />;
  if (stock.isError) {
    return (
      <p role="alert" className="text-sm text-destructive-text">
        {describeError(stock.error)}
      </p>
    );
  }

  return (
    <OpnamePage
      rows={stock.data}
      onSave={handleOpname}
      onDirtyChange={setDirty}
      onDone={() => {
        // Sudah tersimpan: keluar tanpa konfirmasi.
        dirty.current = false;
        backToStock();
      }}
      onCancel={backToStock}
    />
  );
}
