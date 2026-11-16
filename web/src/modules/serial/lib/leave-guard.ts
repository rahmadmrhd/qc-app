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

/** Ada baris draft yang memuat foto bukti QC (sudah terunggah ke server dengan status draft)? */
export function hasProofPhotos(rows: readonly { proofPhotos: readonly unknown[] }[]): boolean {
  return rows.some((row) => row.proofPhotos.length > 0);
}

/**
 * Cara menahan navigasi keluar dari halaman Catat Serial:
 *  - `none`: tidak ditahan (tabel kosong, atau keluar dari aplikasi);
 *  - `confirm`: draft biasa, `window.confirm` seperti semula;
 *  - `dialog`: draft memuat foto bukti: dialog tegas dengan pilihan Simpan dulu (foto sementara hanya bertahan 7 hari di
 *    server, sedangkan draft barisnya hanya ada di perangkat ini).
 */
export type LeaveMode = 'none' | 'confirm' | 'dialog';

export function leaveMode(dirty: boolean, hasProof: boolean): LeaveMode {
  if (!dirty || draftWritesSuspended()) return 'none';
  return hasProof ? 'dialog' : 'confirm';
}
