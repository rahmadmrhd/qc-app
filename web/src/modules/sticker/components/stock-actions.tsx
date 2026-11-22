import type { StickerStockDto } from '@shared/contract';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
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
