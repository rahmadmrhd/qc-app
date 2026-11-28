import type { StagingRow } from './draft';

/** Ringkasan isian yang ditampilkan di konfirmasi sebelum Simpan (langkah konfirmasi, sama dengan Catat WH). */
export interface SaveConfirmSummary {
  total: number;
  newCount: number;
  buLabels: string[];
  itemLabels: string[];
  locationLabels: string[];
  testDateFrom: string;
  testDateTo: string;
  /** Baris yang pilihan stikernya sudah dimuat: jumlah jenis dan total qty. Baris lain memakai bawaan saat Simpan. */
  stickerKinds: number;
  stickerQty: number;
  stickerPending: number;
}

/** Ringkasan baris draf yang akan dikirim (hanya baris yang dikirim: `rows` sudah disaring pemanggil). */
export function saveConfirmSummaryOf(rows: readonly StagingRow[]): SaveConfirmSummary {
  const dates = rows
    .map((row) => row.testDate)
    .filter((date) => date !== '')
    .sort();
  const distinct = (values: string[]) => [...new Set(values.filter((value) => value !== ''))];
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
  return {
    total: rows.length,
    newCount: rows.filter((row) => row.existing === undefined).length,
    buLabels: distinct(rows.map((row) => row.buLabel)),
    itemLabels: distinct(rows.map((row) => row.itemLabel)),
    locationLabels: distinct(rows.map((row) => row.locationLabel)),
    testDateFrom: dates[0] ?? '',
    testDateTo: dates[dates.length - 1] ?? '',
    stickerKinds,
    stickerQty,
    stickerPending,
  };
}
