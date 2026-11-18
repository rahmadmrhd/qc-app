/**
 * Kamera dilaporkan tak dapat dipakai (izin ditolak, tak ada kamera): penanda tingkat modul selama halaman terbuka, agar
 * tombol Kamera di dialog Foto bukti tidak muncul lagi pada pembukaan berikutnya. Dihapus saat "Coba lagi" berhasil
 * menyalakan kamera, atau saat halaman dimuat ulang. Tes memanggil `resetCameraBlocked` (lihat `test/setup.ts`).
 */
let blocked = false;

export function isCameraBlocked(): boolean {
  return blocked;
}

export function markCameraBlocked(): void {
  blocked = true;
}

export function resetCameraBlocked(): void {
  blocked = false;
}
