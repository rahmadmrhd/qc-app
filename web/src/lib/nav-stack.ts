/**
 * Riwayat peramban sebagai tumpukan layar di ponsel (spek redesain butir 41): overlay (dialog, panel menu, lembar
 * pilihan, mode pilih, kamera) menyisipkan SATU entri riwayat saat terbuka sehingga tombol/gestur back menutup overlay
 * lebih dulu, bukan meninggalkan halaman. Entri overlay adalah salinan state riwayat terakhir ditambah penanda
 * `qcOverlay` = kedalaman (1, 2, ...), jadi router (yang membaca `__TSR_key`/`__TSR_index` dari state) tetap melihat
 * lokasi yang sama. Modul ini TIDAK memutuskan ponsel atau desktop: pemanggilnya (`useBackToClose`) yang menjaga.
 */

export const OVERLAY_KEY = 'qcOverlay';

interface OverlayState {
  [OVERLAY_KEY]?: number;
}

/** Kedalaman overlay pada entri riwayat saat ini (0 = tidak ada overlay terbuka di atas halaman). */
export function overlayDepth(): number {
  const state = window.history.state as OverlayState | null;
  return state?.[OVERLAY_KEY] ?? 0;
}

/** Menyisipkan entri overlay baru; mengembalikan kedalamannya. */
export function pushOverlayEntry(): number {
  const depth = overlayDepth() + 1;
  window.history.pushState(
    { ...(window.history.state as object | null), [OVERLAY_KEY]: depth },
    '',
  );
  return depth;
}

/**
 * Menjalankan `action` setelah semua entri overlay yang terbuka dilepas (`history.go(-kedalaman)`). Dipakai untuk
 * navigasi yang dimulai dari dalam overlay (mis. memilih menu di panel): tanpa ini, `replace` akan mengganti entri
 * overlay (bukan halaman) dan satu entri berlebih tertinggal. Tanpa overlay terbuka, `action` langsung jalan.
 */
export function runAfterOverlays(action: () => void, timeoutMs = 400): void {
  const depth = overlayDepth();
  if (depth === 0) {
    action();
    return;
  }
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    window.removeEventListener('popstate', onPop);
    clearTimeout(timer);
    action();
  };
  const onPop = () => {
    if (overlayDepth() === 0) finish();
  };
  const timer = setTimeout(finish, timeoutMs);
  window.addEventListener('popstate', onPop);
  window.history.go(-depth);
}
