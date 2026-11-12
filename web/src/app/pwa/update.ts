import { useMemo, useSyncExternalStore } from 'react';

/** Bentuk `registerSW` dari `virtual:pwa-register` yang dipakai di sini (disuntik agar mudah dites). */
export type RegisterSW = (options: {
  immediate?: boolean;
  onNeedReload?: () => void;
  onNeedRefresh?: () => void;
  onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
  onRegisterError?: (error: unknown) => void;
}) => (reloadPage?: boolean) => Promise<void>;

const DEFAULT_INTERVAL_MS = 30 * 60_000;
// FR-P11: pemeriksaan berkala paling jarang tiap 1 jam.
const MAX_INTERVAL_MS = 60 * 60_000;
// Pemeriksaan karena fokus/visibilitas yang berdekatan dilipat menjadi satu.
const EVENT_CHECK_DEBOUNCE_MS = 2_000;

let needRefresh = false;
// "Nanti": spanduk disembunyikan untuk sisa pemuatan halaman ini (tidak disimpan; pemicu baru mereset).
let dismissed = false;
let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined;
let currentWin: Window | undefined;
let currentRegistration: ServiceWorkerRegistration | undefined;
// Hanya tab yang pengguna menekan "Muat ulang" boleh dimuat ulang; tab lain menunggu persetujuannya sendiri.
let reloadRequested = false;
const listeners = new Set<() => void>();

/**
 * Menyalakan (atau mematikan) status versi baru; menyalakan juga memunculkan lagi spanduk yang disembunyikan.
 * Mengembalikan true bila status berhasil diperbarui (penangan preloadError baru mencegah galat bila berhasil).
 */
function setNeedRefresh(value: boolean): boolean {
  try {
    if (needRefresh !== value || (value && dismissed)) {
      needRefresh = value;
      dismissed = false;
      for (const listener of listeners) listener();
    }
    return true;
  } catch {
    return false;
  }
}

/** Galat muat potongan JS/CSS dinamis (cangkang lama meminta berkas yang sudah diganti oleh deploy baru). */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'ChunkLoadError') return true;
  return /dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(
    error.message,
  );
}

/** Menyalakan spanduk "Ada versi baru" karena muat potongan gagal; tidak memuat ulang apa pun. */
export function notifyChunkLoadFailure(): void {
  setNeedRefresh(true);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Mendaftarkan service worker dan memeriksa pembaruan: saat terdaftar (aplikasi dibuka), saat tab kembali terlihat,
 * dan berkala. Versi baru TIDAK diaktifkan otomatis; hanya `needRefresh` yang menyala (FR-P11, FR-P12).
 * Tanpa dukungan service worker fungsi ini tidak melakukan apa pun. Mengembalikan fungsi pembersih.
 */
export function startPwaUpdates(options: {
  register: RegisterSW;
  win?: Window;
  intervalMs?: number;
}): () => void {
  const win = options.win ?? window;
  if (!('serviceWorker' in win.navigator)) return () => undefined;
  const intervalMs = Math.min(options.intervalMs ?? DEFAULT_INTERVAL_MS, MAX_INTERVAL_MS);

  let registration: ServiceWorkerRegistration | undefined;
  let stopped = false;
  let lastEventCheckAt = Number.NEGATIVE_INFINITY;
  currentWin = win;
  currentRegistration = undefined;
  reloadRequested = false;

  function check() {
    if (stopped || !registration || win.navigator.onLine === false) return;
    try {
      // Galat jaringan/peramban pada pemeriksaan pembaruan tidak boleh mengganggu aplikasi.
      registration.update().catch(() => undefined);
    } catch {
      // Dibiarkan.
    }
  }

  function checkOnEvent() {
    const now = Date.now();
    if (now - lastEventCheckAt < EVENT_CHECK_DEBOUNCE_MS) return;
    lastEventCheckAt = now;
    check();
  }

  function onVisibility() {
    if (win.document.visibilityState === 'visible') checkOnEvent();
  }

  updateSW = options.register({
    immediate: true,
    // Tanpa ini pustaka memuat ulang SETIAP tab saat salah satu mengaktifkan versi baru (draf tab lain hilang).
    onNeedReload: () => {
      if (reloadRequested) win.location.reload();
    },
    onNeedRefresh: () => setNeedRefresh(true),
    onRegisteredSW: (_swUrl, registered) => {
      registration = registered;
      currentRegistration = registered;
      check();
    },
    onRegisterError: () => undefined,
  });
  // Cangkang lama dapat meminta potongan lazy yang sudah tak ada di server setelah deploy: ajak pengguna memuat
  // ulang (tanpa muat ulang otomatis, FR-P12) alih-alih membiarkan galat muat rute.
  const onPreloadError = (event: Event) => {
    if (!setNeedRefresh(true)) return;
    event.preventDefault();
  };
  win.document.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('focus', checkOnEvent);
  win.addEventListener('vite:preloadError', onPreloadError);
  const timer = win.setInterval(check, intervalMs);

  return () => {
    stopped = true;
    win.document.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('focus', checkOnEvent);
    win.removeEventListener('vite:preloadError', onPreloadError);
    win.clearInterval(timer);
  };
}

function reload() {
  reloadRequested = true;
  // Bila tak ada SW yang menunggu (sudah diaktifkan jendela lain), pesan SKIP_WAITING tak berefek: muat ulang langsung.
  if (currentRegistration && !currentRegistration.waiting) {
    currentWin?.location.reload();
    return;
  }
  void updateSW?.(true);
}

function dismiss() {
  if (!needRefresh || dismissed) return;
  dismissed = true;
  for (const listener of listeners) listener();
}

// Snapshot primitif: 0 = tak ada pembaruan, 1 = ada dan tampil, 2 = ada tetapi disembunyikan ("Nanti").
function snapshot(): number {
  if (!needRefresh) return 0;
  return dismissed ? 2 : 1;
}

/**
 * Status pembaruan: `needRefresh` menyala bila versi baru sudah diunduh; `dismissed` bila pengguna memilih "Nanti";
 * `reload` mengaktifkannya dan memuat ulang.
 */
export function usePwaUpdate(): {
  needRefresh: boolean;
  dismissed: boolean;
  reload: () => void;
  dismiss: () => void;
} {
  const value = useSyncExternalStore(subscribe, snapshot, () => 0);
  return useMemo(
    () => ({ needRefresh: value !== 0, dismissed: value === 2, reload, dismiss }),
    [value],
  );
}

/** Hanya untuk tes: membaca status tanpa memasang hook. */
export function usePwaUpdateSnapshotForTests(): boolean {
  return needRefresh;
}

export function resetPwaUpdateForTests(): void {
  needRefresh = false;
  dismissed = false;
  updateSW = undefined;
  currentWin = undefined;
  currentRegistration = undefined;
  reloadRequested = false;
  for (const listener of listeners) listener();
}
