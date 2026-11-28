import type { StagingRow } from './draft';

/** Satu nilai isian beserta jumlah serial yang memakainya (ditampilkan "nilai (n)"). */
export interface CountedValue {
  label: string;
  count: number;
}

/** Ringkasan isian yang ditampilkan di konfirmasi sebelum Simpan (langkah konfirmasi, sama dengan Catat WH). */
export interface SaveConfirmSummary {
  total: number;
  newCount: number;
  bu: CountedValue[];
  item: CountedValue[];
  location: CountedValue[];
  testDate: CountedValue[];
  /** Baris yang pilihan stikernya sudah dimuat: jumlah jenis dan total qty. Baris lain memakai bawaan saat Simpan. */
  stickerKinds: number;
  stickerQty: number;
  stickerPending: number;
}

/** Hitung kemunculan tiap nilai (urut nilai); nilai kosong dilewati. */
function countBy(values: readonly string[]): CountedValue[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value === '') continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([label, count]) => ({ label, count }));
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
  return {
    total: rows.length,
    newCount: rows.filter((row) => row.existing === undefined).length,
    bu: countBy(rows.map((row) => row.buLabel)),
    item: countBy(rows.map((row) => row.itemLabel)),
    location: countBy(rows.map((row) => row.locationLabel)),
    testDate: countBy(rows.map((row) => row.testDate)),
    stickerKinds,
    stickerQty,
    stickerPending,
  };
}

/** Teks "nilai (n), nilai (n)"; kosong bila tak ada nilai. */
export function formatCounted(values: readonly CountedValue[]): string {
  if (values.length === 0) return '-';
  return values.map((value) => `${value.label} (${value.count})`).join(', ');
}
