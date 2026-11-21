/**
 * Riwayat peramban sebagai tumpukan layar di ponsel (spek redesain butir 41): overlay (dialog, panel menu, lembar
 * pilihan, mode pilih, kamera) menyisipkan SATU entri riwayat saat terbuka sehingga tombol/gestur back menutup overlay
 * lebih dulu, bukan meninggalkan halaman. Entri overlay adalah salinan state riwayat terakhir ditambah penanda
 * `qcOverlay` = kedalaman (1, 2, ...), jadi router (yang membaca `__TSR_key`/`__TSR_index` dari state) tetap melihat
 * lokasi yang sama. Modul ini TIDAK memutuskan ponsel atau desktop: pemanggilnya (`useBackToClose`) yang menjaga.
 *
 * Satu pengelola untuk semuanya (review navigasi C1/I1/I2/I3):
 * - SEMUA traversal (`history.go`) dikirim lewat `traverse()`, yang mencatat traversal yang belum tiba (`settling`).
 *   Membuka overlay baru atau menjalankan aksi navigasi selalu menunggu sampai semuanya tiba, sehingga satu tik
 *   tidak dapat menghasilkan traversal ganda atau mendorong entri yang kemudian terlepas oleh traversal tertunda.
 * - Satu pendengar `popstate`: bila tidak ada traversal milik kita, itu back dari pengguna (menutup overlay teratas).
 * - Overlay yang ditutup lewat state dan overlay yang dilepas `runAfterOverlays` ditandai di satu tempat, jadi
 *   pembersihan (`closeOverlay`) tidak pernah memanggil back untuk entri yang sudah dilepas.
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

export interface OverlayHandle {
  level: number;
  /** Dipanggil saat pengguna menekan back: pemilik menutup overlay. */
  onClose: () => void;
  /** Overlay masih ingin terbuka (dibaca setelah `onClose` untuk mendeteksi penolakan). */
  isOpen: () => boolean;
  /** Entri riwayatnya sudah dilepas (oleh back pengguna atau `runAfterOverlays`). */
  popped: boolean;
  /** Pemilik sudah menutup/melepas overlay ini. */
  closed: boolean;
  /** Entri belum didorong (menunggu traversal lain tiba). */
  pending: boolean;
}

const overlays: OverlayHandle[] = [];
const waiters: Array<() => void> = [];
let settling = 0;
let settleTimer: ReturnType<typeof setTimeout> | undefined;
let listening = false;

const SETTLE_TIMEOUT_MS = 1500;

function flushWaiters(): void {
  const run = waiters.splice(0);
  for (const fn of run) fn();
}

function arrived(): void {
  settling = Math.max(0, settling - 1);
  clearTimeout(settleTimer);
  if (settling === 0) flushWaiters();
  else settleTimer = setTimeout(forceSettle, SETTLE_TIMEOUT_MS);
}

/** Pengaman: traversal yang tak pernah menghasilkan popstate (riwayat lebih pendek) tidak boleh menahan selamanya. */
function forceSettle(): void {
  settling = 0;
  flushWaiters();
}

function traverse(count: number): void {
  if (count <= 0) return;
  ensureListener();
  settling += 1;
  clearTimeout(settleTimer);
  settleTimer = setTimeout(forceSettle, SETTLE_TIMEOUT_MS);
  window.history.go(-count);
}

/** Menjalankan `fn` setelah semua traversal milik kita tiba (langsung bila tak ada). */
function whenSettled(fn: () => void): void {
  if (settling === 0) fn();
  else waiters.push(fn);
}

function pushEntry(): number {
  const depth = overlayDepth() + 1;
  window.history.pushState(
    { ...(window.history.state as object | null), [OVERLAY_KEY]: depth },
    '',
  );
  return depth;
}

/** Melepas entri milik overlay yang sudah ditutup dan berada di puncak (satu traversal untuk beberapa entri). */
function reconcile(): void {
  if (settling > 0) {
    whenSettled(reconcile);
    return;
  }
  let drop = 0;
  for (let top = overlays[overlays.length - 1]; top && (top.closed || top.popped); ) {
    overlays.pop();
    if (!top.popped) drop += 1;
    top = overlays[overlays.length - 1];
  }
  traverse(drop);
}

function onPop(): void {
  if (settling > 0) {
    arrived();
    return;
  }
  // Back dari pengguna: tutup overlay yang entrinya hilang.
  const actual = overlayDepth();
  const gone = overlays.filter((o) => !o.popped && !o.pending && o.level > actual);
  if (gone.length === 0) return;
  for (const overlay of gone) overlay.popped = true;
  for (const overlay of [...gone].reverse()) overlay.onClose();
  // Pemilik menolak menutup (mis. form kotor): pasang entri lagi agar back berikutnya tetap menutup overlay.
  setTimeout(() => {
    for (const overlay of gone) {
      if (overlay.closed || !overlay.isOpen() || !overlays.includes(overlay)) continue;
      overlay.popped = false;
      overlay.level = pushEntry();
    }
  }, 30);
}

function ensureListener(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('popstate', onPop);
}

/**
 * Mendaftarkan overlay terbuka: menyisipkan entri riwayat (menunggu bila ada traversal tertunda; aman terhadap
 * StrictMode yang memasang, melepas, lalu memasang lagi dalam satu tik).
 */
export function openOverlay(onClose: () => void, isOpen: () => boolean): OverlayHandle {
  ensureListener();
  const handle: OverlayHandle = {
    level: 0,
    onClose,
    isOpen,
    popped: false,
    closed: false,
    pending: true,
  };
  overlays.push(handle);
  whenSettled(() => {
    handle.pending = false;
    if (handle.closed) {
      // Ditutup sebelum sempat didorong: tak ada entri; cukup dikeluarkan dari daftar.
      handle.popped = true;
      reconcile();
      return;
    }
    handle.level = pushEntry();
  });
  return handle;
}

/** Overlay ditutup oleh pemiliknya (state): lepas entrinya bila masih ada. Tidak berbuat apa pun bila sudah dilepas. */
export function closeOverlay(handle: OverlayHandle): void {
  if (handle.closed) return;
  handle.closed = true;
  reconcile();
}

/**
 * Menjalankan `action` setelah semua entri overlay yang terbuka dilepas. Dipakai untuk navigasi yang dimulai dari
 * dalam/bersamaan dengan overlay: tanpa ini, `replace` akan mengganti entri overlay (bukan halaman) dan satu entri
 * berlebih tertinggal. Overlay yang terbuka ditutup lewat `onClose`-nya dan ditandai terlepas, sehingga pembersihannya
 * kemudian tidak memanggil back lagi. Tanpa overlay terbuka, `action` langsung jalan.
 */
export function runAfterOverlays(action: () => void): void {
  if (settling > 0) {
    whenSettled(() => runAfterOverlays(action));
    return;
  }
  const open = overlays.filter((o) => !o.popped && !o.pending);
  if (open.length === 0 && overlayDepth() === 0) {
    action();
    return;
  }
  const depth = overlayDepth();
  for (const overlay of open) overlay.popped = true;
  for (const overlay of [...open].reverse()) overlay.onClose();
  for (const overlay of overlays.splice(0)) {
    overlay.popped = true;
    overlay.closed = true;
  }
  waiters.push(action);
  if (depth > 0) traverse(depth);
  else flushWaiters();
}

/** Hanya untuk tes: kembali ke keadaan awal. */
export function resetOverlayManager(): void {
  overlays.length = 0;
  waiters.length = 0;
  settling = 0;
  clearTimeout(settleTimer);
}
