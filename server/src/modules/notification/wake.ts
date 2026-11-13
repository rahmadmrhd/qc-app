/**
 * Sinyal "ada notifikasi baru" dari jalur tulis ke putaran latar notifikasi (`startNotificationLoop`), agar push
 * terkirim segera setelah penulisan di-commit, bukan menunggu detak berikutnya (bawaan 10 dtk).
 *
 * Sengaja satu penunjuk per proses: hanya putaran milik server yang berjalan (`createServer`) yang memasangnya,
 * jadi tes yang tidak menjalankan putaran tidak terpengaruh. Pemanggil tidak pernah menunggu dan tidak pernah gagal
 * karenanya: bangun-bangun adalah optimasi, putaran berdetak tetap menjadi jaminan.
 */

let handler: (() => void) | null = null;

/** Memasang penunjuk; mengembalikan fungsi pelepas (hanya melepas bila masih penunjuk yang sama). */
export function setNotificationWakeHandler(fn: () => void): () => void {
  handler = fn;
  return () => {
    if (handler === fn) handler = null;
  };
}

/** Dipanggil SETELAH `batch()` penulis notifikasi berhasil di-commit. */
export function wakeNotifications(): void {
  try {
    handler?.();
  } catch {
    // Tak boleh menggagalkan penulisan yang sudah di-commit.
  }
}
