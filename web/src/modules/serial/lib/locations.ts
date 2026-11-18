import type { SerialLocationOptionDto } from '@shared/contract';
import { wibDateIso } from '@shared/postel';
import type { LinkOption } from '@/components/link-field';

/** Lokasi dari `serials.locationOptions` -> pilihan `LinkField` ("Nama (KODE)"). */
export function toLocationOptions(locations: readonly SerialLocationOptionDto[]): LinkOption[] {
  return locations.map((location) => ({
    id: location.id,
    label: `${location.name} (${location.code})`,
  }));
}

/** Tanggal hari ini menurut WIB (`YYYY-MM-DD`), bukan jam peramban. */
export function todayWib(now: number = Date.now()): string {
  return wibDateIso(now);
}

/**
 * Lokasi Default yang terkunci di halaman Catat (spek Catat wajib foto, butir N.2): lokasi aktif di header bila TEPAT
 * satu dan termasuk lokasi yang dapat dipilih; bila tidak, satu-satunya lokasi yang dapat dipilih. `null` = tidak
 * terkunci (pengguna memilih sendiri). `source` menentukan teks petunjuk.
 */
export function lockedLocationOf(
  pickable: readonly SerialLocationOptionDto[],
  selectedIds: readonly string[],
): { id: string; label: string; source: 'active' | 'only' } | null {
  const [onlySelected] = selectedIds;
  if (selectedIds.length === 1 && onlySelected !== undefined) {
    const found = pickable.find((location) => location.id === onlySelected);
    const [option] = found ? toLocationOptions([found]) : [];
    if (found && option) return { id: found.id, label: option.label, source: 'active' };
  }
  const [only] = pickable;
  if (pickable.length === 1 && only) {
    const [option] = toLocationOptions([only]);
    if (option) return { id: only.id, label: option.label, source: 'only' };
  }
  return null;
}
