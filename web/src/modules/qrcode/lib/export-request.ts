/**
 * Permintaan satu kali "buka dialog ekspor" dari form Ubah ke View konfigurasi yang sama. "Simpan dan ekspor" kembali ke
 * View lewat `stack.pop` (riwayat tidak menjadi [daftar, View, View], butir 41c); `history.back()` tak membawa search
 * param, jadi permintaannya dititipkan di sini dan diambil View saat tampil. Kedaluwarsa cepat agar tak bocor ke
 * kunjungan View berikutnya.
 */
const EXPIRES_MS = 15_000;

let pending: { designId: string; at: number } | null = null;

export function requestExportOnView(designId: string): void {
  pending = { designId, at: Date.now() };
}

/** Mengambil (dan menghapus) permintaan untuk konfigurasi ini; false bila tak ada, milik konfigurasi lain, atau basi. */
export function takeExportRequest(designId: string): boolean {
  const request = pending;
  if (!request || request.designId !== designId) return false;
  pending = null;
  return Date.now() - request.at <= EXPIRES_MS;
}
