/** Label ringkas lokasi aktif: nama (satu), "N lokasi", atau "Semua lokasi"; satu fungsi untuk header desktop dan ponsel. */
export function activeLocationLabel(
  available: readonly { id: string; name: string }[],
  selectedIds: readonly string[],
): string {
  if (selectedIds.length === 0) return 'Lokasi belum dipilih';
  if (available.length > 1 && selectedIds.length === available.length) return 'Semua lokasi';
  if (selectedIds.length === 1) {
    return available.find((location) => location.id === selectedIds[0])?.name ?? '1 lokasi';
  }
  return `${selectedIds.length} lokasi`;
}
