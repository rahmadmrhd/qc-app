import type { WarehouseDraftRow } from './draft-store';

/** Nilai yang sama pada SEMUA serial yang sudah ada di pilihan (baris baru diabaikan); `''` bila beda atau tak ada. */
function commonOfExisting(
  rows: readonly WarehouseDraftRow[],
  pick: (row: Extract<WarehouseDraftRow, { kind: 'existing' }>) => string,
): string {
  let common = '';
  for (const row of rows) {
    if (row.kind !== 'existing') continue;
    const value = pick(row);
    if (value === '') return '';
    if (common === '') common = value;
    else if (common !== value) return '';
  }
  return common;
}

export interface DefaultBuInput {
  rows: readonly WarehouseDraftRow[];
  /** Chip BU form; dipakai bila data serial tak seragam. */
  chipBuId: string;
  /** BU Item terpilih (kosong = tak diketahui). */
  itemBuIds: readonly string[];
  /** BU yang boleh ditulis pengguna (pilihan di dialog). */
  buOptionIds: readonly string[];
}

/**
 * BU awal dialog simpan: BU yang sama pada semua serial yang sudah ada, lalu chip BU form, lalu satu-satunya BU Item
 * yang juga ada di pilihan pengguna; selain itu kosong (pilih manual).
 */
export function defaultBuId({ rows, chipBuId, itemBuIds, buOptionIds }: DefaultBuInput): string {
  const common = commonOfExisting(rows, (row) => row.snapshot.buId);
  if (common !== '' && buOptionIds.includes(common)) return common;
  if (chipBuId !== '') return chipBuId;
  const candidates = itemBuIds.filter((id) => buOptionIds.includes(id));
  const [only] = candidates;
  return candidates.length === 1 && only ? only : '';
}

export interface DefaultLocationInput {
  rows: readonly WarehouseDraftRow[];
  /** Chip Lokasi form; dipakai bila data serial tak seragam. */
  chipLocationId: string;
  /** Lokasi aktif pengguna (hanya dipakai bila tepat satu). */
  activeLocationIds: readonly string[];
  /** Lokasi yang boleh dipilih di dialog. */
  locationOptionIds: readonly string[];
}

/**
 * Lokasi awal dialog simpan, aturan sama dengan BU: lokasi yang sama pada semua serial yang sudah ada, lalu chip
 * Lokasi form, lalu lokasi aktif pengguna bila tepat satu; selain itu kosong.
 */
export function defaultLocationId({
  rows,
  chipLocationId,
  activeLocationIds,
  locationOptionIds,
}: DefaultLocationInput): string {
  const common = commonOfExisting(rows, (row) => row.snapshot.locationId);
  if (common !== '' && locationOptionIds.includes(common)) return common;
  if (chipLocationId !== '') return chipLocationId;
  const [only] = activeLocationIds;
  return activeLocationIds.length === 1 && only && locationOptionIds.includes(only) ? only : '';
}
