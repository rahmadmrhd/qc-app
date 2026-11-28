import type { StagingRow } from './draft';

/** Satu kartu ringkasan: kombinasi unik BU, Item, Lokasi, dan Tanggal uji, beserta jumlah serialnya. */
export interface SaveConfirmGroup {
  bu: string;
  item: string;
  location: string;
  testDate: string;
  count: number;
}

/** Ringkasan isian yang ditampilkan di konfirmasi sebelum Simpan (langkah konfirmasi, sama dengan Catat WH). */
export interface SaveConfirmSummary {
  total: number;
  newCount: number;
  groups: SaveConfirmGroup[];
  /** Baris yang pilihan stikernya sudah dimuat: jumlah jenis dan total qty. Baris lain memakai bawaan saat Simpan. */
  stickerKinds: number;
  stickerQty: number;
  stickerPending: number;
}

/** Ringkasan baris draf yang akan dikirim (hanya baris yang dikirim: `rows` sudah disaring pemanggil). */
export function saveConfirmSummaryOf(rows: readonly StagingRow[]): SaveConfirmSummary {
  let stickerKinds = 0;
  let stickerQty = 0;
  let stickerPending = 0;
  for (const row of rows) {
    if (row.stickers === null) {
      stickerPending++;
      continue;
    }
    for (const sticker of row.stickers) {
      if (sticker.qty > 0) {
        stickerKinds++;
        stickerQty += sticker.qty;
      }
    }
  }
  const groups = new Map<string, SaveConfirmGroup>();
  for (const row of rows) {
    const key = [row.buLabel, row.itemLabel, row.locationLabel, row.testDate].join('\u0000');
    const found = groups.get(key);
    if (found) {
      found.count++;
    } else {
      groups.set(key, {
        bu: row.buLabel,
        item: row.itemLabel,
        location: row.locationLabel,
        testDate: row.testDate,
        count: 1,
      });
    }
  }
  return {
    total: rows.length,
    newCount: rows.filter((row) => row.existing === undefined).length,
    groups: [...groups.values()],
    stickerKinds,
    stickerQty,
    stickerPending,
  };
}
