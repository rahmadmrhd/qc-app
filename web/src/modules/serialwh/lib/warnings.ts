import type { WarehouseSerialDto } from '@shared/contract';
import type { WarehouseDraftRow } from './draft-store';

/**
 * Peringatan per baris (spek 5.4). `prior_other_bu` hanya info (transaksi internal antar-BU yang sah); tiga lainnya
 * warning. Semuanya dihitung dari snapshot dan chip form, jadi dihitung ulang saat chip BU berubah.
 */
export type RowWarning = 'test_date_diff' | 'bu_diff' | 'prior_same_bu' | 'prior_other_bu';

export const WARNING_LABEL: Record<RowWarning, string> = {
  test_date_diff: 'Tanggal uji beda',
  bu_diff: 'BU berbeda',
  prior_same_bu: 'Pernah keluar di BU ini',
  prior_other_bu: 'Pernah keluar di BU lain',
};

/** Info tidak dihitung sebagai warning pada banner. */
export const isRealWarning = (warning: RowWarning) => warning !== 'prior_other_bu';

/** Tanggal uji acuan = yang paling banyak muncul di draf (seri: yang muncul lebih dulu); `''` bila draf kosong. */
export function referenceTestDate(testDates: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const date of testDates) counts.set(date, (counts.get(date) ?? 0) + 1);
  let best = '';
  let bestCount = 0;
  for (const [date, count] of counts) {
    if (count > bestCount) {
      best = date;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Pelacak tanggal uji acuan bertahap (tempelan banyak baris tidak menghitung ulang seluruh draf per serial): hasilnya
 * sama dengan `referenceTestDate` selama tak ada seri, dan pada seri yang menang tanggal yang lebih dulu mencapai hitungan.
 */
export function createReferenceTracker(initial: readonly string[] = []) {
  const counts = new Map<string, number>();
  let best = '';
  let bestCount = 0;
  const add = (date: string) => {
    const next = (counts.get(date) ?? 0) + 1;
    counts.set(date, next);
    if (next > bestCount) {
      best = date;
      bestCount = next;
    }
  };
  for (const date of initial) add(date);
  return { add, best: () => best };
}

export interface WarningContext {
  /** BU form saat ini (chip BU atau BU SO); kosong = belum dipilih, tidak ada warning BU. */
  formBuId: string;
  referenceTestDate: string;
}

/** Peringatan satu serial yang sudah ada. */
export function snapshotWarnings(
  snapshot: Pick<WarehouseSerialDto, 'buId' | 'testDate' | 'dispatches' | 'recorded'>,
  context: WarningContext,
): RowWarning[] {
  const warnings: RowWarning[] = [];
  if (context.referenceTestDate !== '' && snapshot.testDate !== context.referenceTestDate) {
    warnings.push('test_date_diff');
  }
  if (context.formBuId !== '' && snapshot.buId !== context.formBuId) warnings.push('bu_diff');
  // `recorded` = pernah selesai keluar di BU mana pun (juga BU yang tak terbaca, tanpa rujukan). Perbandingan BU yang
  // sama hanya lewat `buId` yang ada: BU tak terbaca selalu dihitung "BU lain" (info).
  if (snapshot.recorded) {
    const sameBu =
      context.formBuId !== '' &&
      snapshot.dispatches.some(
        (dispatch) => dispatch.buId !== undefined && dispatch.buId === context.formBuId,
      );
    warnings.push(sameBu ? 'prior_same_bu' : 'prior_other_bu');
  }
  return warnings;
}

export function rowTestDate(row: WarehouseDraftRow): string {
  return row.kind === 'existing' ? row.snapshot.testDate : row.testDate;
}

/** Peringatan satu baris draf (baris baru hanya dapat tanggal uji beda). */
export function rowWarnings(row: WarehouseDraftRow, context: WarningContext): RowWarning[] {
  if (row.kind === 'existing') return snapshotWarnings(row.snapshot, context);
  return context.referenceTestDate !== '' && row.testDate !== context.referenceTestDate
    ? ['test_date_diff']
    : [];
}

export type WarningCounts = Record<RowWarning, number>;

/** Jumlah baris per jenis peringatan (untuk banner ringkas dan dialog konfirmasi). */
export function countWarnings(
  rows: readonly WarehouseDraftRow[],
  formBuId: string,
): { counts: WarningCounts; reference: string; serials: Record<RowWarning, string[]> } {
  const reference = referenceTestDate(rows.map(rowTestDate));
  const counts: WarningCounts = {
    test_date_diff: 0,
    bu_diff: 0,
    prior_same_bu: 0,
    prior_other_bu: 0,
  };
  const serials: Record<RowWarning, string[]> = {
    test_date_diff: [],
    bu_diff: [],
    prior_same_bu: [],
    prior_other_bu: [],
  };
  for (const row of rows) {
    for (const warning of rowWarnings(row, { formBuId, referenceTestDate: reference })) {
      counts[warning] += 1;
      serials[warning].push(row.serial);
    }
  }
  return { counts, reference, serials };
}
