import type { StagingRow } from './draft';
import { ITEM_IDS_PER_REQUEST, type ItemLookup, isQueryableItemId } from './import-verify';

/** Id item unik pada baris draft yang dapat ditanyakan ke `serials.itemOptions` (urutan kemunculan). */
export function uniqueItemIds(rows: readonly StagingRow[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (isQueryableItemId(row.itemId)) ids.add(row.itemId);
  }
  return [...ids];
}

/**
 * Minimum foto bukti terkini per item (0 = tidak wajib), satu permintaan per `ITEM_IDS_PER_REQUEST` id unik (bukan per
 * baris). Pecahan yang gagal (jaringan/server) dilewati: barisnya tetap seperti semula dan server tetap menegakkan aturan.
 * Item yang tak kembali (tak ada atau tak terlihat) tidak masuk peta.
 */
export async function fetchProofMins(
  itemIds: readonly string[],
  findItems: (chunk: readonly string[]) => Promise<ItemLookup[]>,
): Promise<Map<string, number>> {
  const mins = new Map<string, number>();
  for (let index = 0; index < itemIds.length; index += ITEM_IDS_PER_REQUEST) {
    const chunk = itemIds.slice(index, index + ITEM_IDS_PER_REQUEST);
    try {
      for (const item of await findItems(chunk)) mins.set(item.id, item.proofMin ?? 0);
    } catch {
      // Gagal: biarkan baris-baris pecahan ini apa adanya.
    }
  }
  return mins;
}

/**
 * Menyegarkan `proofMin` baris draft (draft lama tidak membawanya). Nilai yang sudah diketahui (> 0) tidak ditimpa
 * kecuali item kini tak wajib foto (0, nilainya dibuang); baris tanpa nilai mendapat minimum item bila > 0. Hasil/pesan
 * penyimpanan dan foto baris tidak disentuh. Mengembalikan larik yang SAMA bila tak ada yang berubah.
 */
export function applyProofMins(
  rows: readonly StagingRow[],
  mins: ReadonlyMap<string, number>,
): StagingRow[] {
  let changed = false;
  const next = rows.map((row) => {
    const fresh = mins.get(row.itemId);
    if (fresh === undefined) return row;
    const current = row.proofMin ?? 0;
    if (fresh === 0) {
      if (row.proofMin === undefined) return row;
      changed = true;
      const { proofMin: _gone, ...rest } = row;
      return rest;
    }
    if (current > 0) return row;
    changed = true;
    return { ...row, proofMin: fresh };
  });
  return changed ? next : (rows as StagingRow[]);
}
