/**
 * Keterangan di dialog hapus catatan Postel. Hapus bersifat lunak: item tidak dilepas dari catatan, hanya dihitung
 * "Belum ada Postel" selama catatan terhapus dan tersambung lagi saat dipulihkan.
 */
export function postelDeleteUsage(itemCount: number): string {
  return `Memuat ${itemCount} item. Selama catatan terhapus, item dianggap belum ber-Postel; saat dipulihkan, item tersambung kembali (bila belum dipasang ke catatan lain).`;
}
