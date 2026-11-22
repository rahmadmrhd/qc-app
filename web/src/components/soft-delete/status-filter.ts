import type { ListStatusFilter } from '@shared/batch';

/**
 * Opsi filter Status halaman daftar: Semua status / Aktif / Nonaktif, ditambah Terhapus hanya bagi pemegang izin
 * Pulihkan (`canRestore`; rancangan soft delete §4.5).
 */
export function statusFilterOptions(
  canRestore: boolean,
): { value: ListStatusFilter; label: string }[] {
  const options: { value: ListStatusFilter; label: string }[] = [
    { value: 'all', label: 'Semua status' },
    { value: 'active', label: 'Aktif' },
    { value: 'inactive', label: 'Nonaktif' },
  ];
  if (canRestore) options.push({ value: 'deleted', label: 'Terhapus' });
  return options;
}

/**
 * Opsi filter Status untuk model tanpa status aktif/nonaktif (Desain QR, Default QR, Postel): Hidup atau Terhapus.
 * Filternya hanya ditampilkan bagi pemegang izin Pulihkan (`canRestore`); tanpa izin itu tak ada opsi (daftar hidup
 * saja).
 */
export function liveStatusFilterOptions(
  canRestore: boolean,
): { value: 'live' | 'deleted'; label: string }[] {
  return canRestore
    ? [
        { value: 'live', label: 'Hidup' },
        { value: 'deleted', label: 'Terhapus' },
      ]
    : [];
}
