import { draftWritesSuspended } from './draft-store';

/**
 * Perlu menahan navigasi keluar dari halaman Catat Serial? Tidak bila tabel kosong, dan tidak saat keluar dari aplikasi
 * (draf sudah sengaja dibuang oleh Keluar, jadi konfirmasi "draf tersimpan otomatis" menyesatkan dan pembatalannya
 * akan meninggalkan halaman tanpa penyimpanan draf).
 */
export function shouldBlockLeave(dirty: boolean, confirmLeave: () => boolean): boolean {
  if (!dirty || draftWritesSuspended()) return false;
  return !confirmLeave();
}

export function shouldWarnBeforeUnload(dirty: boolean): boolean {
  return dirty && !draftWritesSuspended();
}
