import { BATCH_MAX } from '@shared/batch';
import type { SerialSummaryDto } from '@shared/contract';

/** Kelompok serial terpilih dengan Item dan BU yang sama: stiker yang berlaku bagi mereka sama (keputusan pemilik K2). */
export interface StickerGroup {
  key: string;
  itemId: string;
  buId: string;
  itemLabel: string;
  buCode: string;
  /** Id serial kelompok ini, urut kemunculan. */
  ids: string[];
  /** Nomor serial kelompok ini (searah `ids`). */
  serials: string[];
}

/** Paling banyak kelompok (Item + BU) dalam satu pengiriman: tiap kelompok memuat satu daftar stiker dari server. */
export const STICKER_GROUPS_MAX = 10;

/** Paling banyak serial dalam satu pengiriman (batas server `serials.applyStickersBatch`). */
export const STICKER_ROWS_MAX = BATCH_MAX;

/** Mengelompokkan serial terpilih menurut (Item, BU), urut kemunculan pertama. */
export function groupSerialsByItemBu(rows: readonly SerialSummaryDto[]): StickerGroup[] {
  const groups = new Map<string, StickerGroup>();
  for (const row of rows) {
    const key = `${row.itemId}\u0000${row.buId}`;
    const group = groups.get(key);
    if (group) {
      group.ids.push(row.id);
      group.serials.push(row.serial);
    } else {
      groups.set(key, {
        key,
        itemId: row.itemId,
        buId: row.buId,
        itemLabel: row.itemLabel,
        buCode: row.buCode,
        ids: [row.id],
        serials: [row.serial],
      });
    }
  }
  return [...groups.values()];
}

/** Alasan tombol "Tempel stiker" nonaktif untuk pilihan ini, atau `undefined` bila boleh. */
export function stickerGroupsBlocker(groupCount: number): string | undefined {
  return groupCount > STICKER_GROUPS_MAX
    ? `Pilih serial dari paling banyak ${STICKER_GROUPS_MAX} kombinasi Item dan BU`
    : undefined;
}
