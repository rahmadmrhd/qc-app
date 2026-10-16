export const ACTIVE_LOCATIONS_STORAGE_KEY = 'qc.locations';

export function parseStoredLocationIds(raw: string | null): string[] | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : null;
  } catch {
    return null;
  }
}

/** Saring ke lokasi yang masih tersedia; tanpa pilihan yang sah kembali ke semua lokasi yang tersedia. */
export function normalizeSelection(
  stored: readonly string[] | null,
  available: readonly string[],
): string[] {
  const kept = [...new Set((stored ?? []).filter((id) => available.includes(id)))];
  return kept.length > 0 ? kept : [...available];
}

/** Pilihan tidak boleh kosong; urutan mengikuti `available`. */
export function toggleSelection(
  current: readonly string[],
  id: string,
  available: readonly string[],
): string[] {
  if (current.includes(id)) {
    return current.length === 1 ? [...current] : current.filter((item) => item !== id);
  }
  return available.filter((item) => item === id || current.includes(item));
}
