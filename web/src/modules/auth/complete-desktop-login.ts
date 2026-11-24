/**
 * Menyelesaikan login desktop setelah `auth.onChange` melaporkan `signedIn` dan `me` berhasil dimuat: memuat ulang
 * jendela ke `/` agar jalur boot normal berjalan penuh dengan sesi baru (restore cache query dan papan, muat antrean
 * tulis, penyinkron antrean, pendengar logout antar tab). Cukup menandai sesi dan `navigate` tidak menyalakan itu
 * semua, dan setelah logout penahan tulis antrean (`suspendOutboxWrites`) tetap aktif sampai modul dimuat ulang.
 */
export function completeDesktopLogin(
  reload: () => void = () => window.location.replace('/'),
): void {
  reload();
}
