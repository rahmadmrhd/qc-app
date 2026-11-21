import type { StickerStockDto } from '@shared/contract';
import { MoreHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  StockEntryDialog,
  type StockEntryMode,
  type StockSaveResult,
  type StockWrite,
} from './stock-entry-dialog';
import { StockHistoryDialog } from './stock-history';

export interface StockPageLocation {
  id: string;
  code: string;
  name: string;
}

/** Bagian stok halaman/View: hanya ada bila user boleh melihat stok di minimal satu lokasi terpilih. */
export interface StickerStockPanel {
  rows: readonly StickerStockDto[];
  /** Lokasi yang sedang ditampilkan (terpilih dan boleh dilihat user). */
  locations: readonly StockPageLocation[];
  /** Catat masuk/keluar (`stickerstock: edit`). */
  canEdit: boolean;
  /** Koreksi dan stok opname (`stickerstock: manage`). */
  canManage: boolean;
  onWrite: (write: StockWrite) => Promise<StockSaveResult>;
}

/**
 * Aksi stok yang boleh dilakukan pada satu baris stok (satu aturan untuk tabel dan View): Masuk butuh stiker DAN
 * jenis aktif, Keluar tetap boleh pada yang nonaktif/usang, Koreksi butuh `manage`.
 */
export function stockAvailability(panel: StickerStockPanel, row: StickerStockDto) {
  return {
    canIn: panel.canEdit && row.status === 'active' && row.typeStatus === 'active',
    canOut: panel.canEdit,
    canAdjust: panel.canManage,
  };
}

/**
 * Keadaan dialog stok bersama: dialog Catat masuk/keluar/Koreksi dan dialog Riwayat. Hanya mode dan id yang disimpan;
 * barisnya diturunkan dari stok terbaru agar "Stok saat ini" di dialog ikut diperbarui bila stok dimuat ulang saat
 * dialog terbuka. Dipakai halaman Stiker (satu per halaman) dan View Stiker.
 */
export function useStockActions(panel: StickerStockPanel | undefined) {
  const [entry, setEntry] = useState<{ mode: StockEntryMode; stickerId: string } | null>(null);
  const [history, setHistory] = useState<StickerStockDto | null>(null);
  const entryRow = entry
    ? (panel?.rows.find((row) => row.stickerId === entry.stickerId) ?? null)
    : null;
  // Baris hilang dari stok saat dialog terbuka (mis. stiker nonaktif yang stoknya menjadi 0): tutup dengan bersih
  // dan beri tahu, alih-alih menghilang diam-diam atau terbuka sendiri lagi bila baris kembali.
  useEffect(() => {
    if (entry !== null && entryRow === null) {
      setEntry(null);
      toast.info('Stok stiker berubah; dialog ditutup');
    }
  }, [entry, entryRow]);

  const locationNames = useMemo(
    () => new Map((panel?.locations ?? []).map((location) => [location.id, location.name])),
    [panel?.locations],
  );

  const dialogs = panel ? (
    <>
      <StockEntryDialog
        mode={entry?.mode ?? null}
        sticker={entryRow}
        onOpenChange={(open) => (open ? undefined : setEntry(null))}
        onSave={panel.onWrite}
      />
      <StockHistoryDialog
        sticker={history}
        locationIds={panel.locations.map((location) => location.id)}
        locationNames={locationNames}
        onClose={() => setHistory(null)}
      />
    </>
  ) : null;

  return {
    openEntry: (mode: StockEntryMode, stickerId: string) => setEntry({ mode, stickerId }),
    openHistory: (row: StickerStockDto) => setHistory(row),
    dialogs,
  };
}

export type StockActionsController = ReturnType<typeof useStockActions>;

interface StockActionProps {
  row: StickerStockDto;
  /** Nama yang tampil untuk stiker (alias bila ada): dipakai nama aksesibel. */
  label: string;
  panel: StickerStockPanel;
  controller: StockActionsController;
}

/** Menu "Stok" per baris tabel: Catat masuk, Catat keluar, Koreksi, dan Riwayat. */
export function StockMenu({ row, label, panel, controller }: StockActionProps) {
  const { canIn, canOut, canAdjust } = stockAvailability(panel, row);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          color="primary"
          aria-label={`Stok ${label}`}
        >
          Stok
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canIn ? (
          <DropdownMenuItem onSelect={() => controller.openEntry('in', row.stickerId)}>
            Catat masuk
          </DropdownMenuItem>
        ) : null}
        {canOut ? (
          <DropdownMenuItem onSelect={() => controller.openEntry('out', row.stickerId)}>
            Catat keluar
          </DropdownMenuItem>
        ) : null}
        {canAdjust ? (
          <DropdownMenuItem onSelect={() => controller.openEntry('adjust', row.stickerId)}>
            Koreksi
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => controller.openHistory(row)}>Riwayat</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Tombol aksi stok untuk View Stiker (aturan sama dengan `StockMenu`); riwayat ada di tab Riwayat View. */
export function StockButtons({ row, label, panel, controller }: StockActionProps) {
  const { canIn, canOut, canAdjust } = stockAvailability(panel, row);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canIn ? (
        <Button
          type="button"
          variant="outline"
          color="primary"
          aria-label={`Catat masuk ${label}`}
          onClick={() => controller.openEntry('in', row.stickerId)}
        >
          Catat masuk
        </Button>
      ) : null}
      {canOut ? (
        <Button
          type="button"
          variant="outline"
          color="primary"
          aria-label={`Catat keluar ${label}`}
          onClick={() => controller.openEntry('out', row.stickerId)}
        >
          Catat keluar
        </Button>
      ) : null}
      {canAdjust ? (
        <Button
          type="button"
          variant="outline"
          color="primary"
          aria-label={`Koreksi ${label}`}
          onClick={() => controller.openEntry('adjust', row.stickerId)}
        >
          Koreksi
        </Button>
      ) : null}
    </div>
  );
}
