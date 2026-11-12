import { useMemo, useSyncExternalStore } from 'react';
import { isSafeToReload, subscribeSafety } from './safe-reload';

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
// Batas menunggu SW baru yang masih dipasang sebelum menyerah dan memuat ulang halaman.
const INSTALL_WAIT_MS = 15_000;
// Batas menunggu SW yang sudah diminta aktif mengambil alih halaman (controllerchange) sebelum memuat ulang saja.
const ACTIVATE_WAIT_MS = 10_000;
// Pembatas lintas muat ulang: setelah muat ulang otomatis, tidak mengulang otomatis dalam jendela ini (cegah loop bila
// SW baru tak kunjung mengambil alih); spanduk yang tampil.
const AUTO_RELOAD_GUARD_KEY = 'qc-pwa-auto-reload';
const AUTO_RELOAD_GUARD_MS = 60_000;
// Penanda "macet" tanpa kedaluwarsa: percobaan otomatis berakhir di batas waktu (SW baru tak mengambil alih). Selama
// ada, hanya spanduk; dihapus saat halaman dimuat tanpa SW menunggu.
const AUTO_STUCK_KEY = 'qc-pwa-auto-stuck';

let needRefresh = false;
// "Nanti": spanduk disembunyikan untuk sisa pemuatan halaman ini (tidak disimpan; pemicu baru mereset).
let dismissed = false;
let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined;
let currentWin: Window | undefined;
let currentRegistration: ServiceWorkerRegistration | undefined;
// Hanya tab yang pengguna menekan "Muat ulang" boleh dimuat ulang; tab lain menunggu persetujuannya sendiri.
let reloadRequested = false;
// Memeriksa pembaruan registrasi yang terpakai (no-op bila belum ada); diisi startPwaUpdates.
let runCheck: () => void = () => undefined;
// Pembatal penunggu yang berjalan (SW baru masih dipasang, atau menunggu SW mengambil alih). Terisi = "pending":
// tombol Muat ulang menampilkan umpan balik, klik ulang diabaikan, dan Nanti/pembersih membatalkannya.
let cancelPending: (() => void) | undefined;
// Muat ulang OTOMATIS bila aman (keputusan pemilik 2026-11-13): hanya pada pemicu (pindah halaman, tab kembali
// terlihat), satu percobaan per versi, lalu spanduk.
// Halaman rusak (galat muat potongan): spanduk tampil walau aman.
let urgent = false;
// Percobaan otomatis sudah dilakukan pada halaman ini (satu percobaan per versi: setiap pemuatan halaman memuat
// satu versi, dan muat ulang yang berhasil membuang keadaan ini).
let autoAttempted = false;
// Sampai kapan percobaan otomatis diblokir oleh pembatas lintas muat ulang (epoch ms).
let autoGuardUntil = 0;
// Penanda macet dari muat ulang otomatis sebelumnya masih berlaku.
let autoStuck = false;
// sessionStorage tak dapat dipakai (tidak ada atau melempar): pembatas tak dapat dijamin, jadi hanya spanduk.
let autoStorageUnavailable = false;
// Muat ulang yang sedang menunggu dimulai otomatis (spanduk disembunyikan selama itu).
let autoInitiated = false;
// Hindari memuat ulang dua kali untuk satu peristiwa (pendengar controllerchange sendiri + onNeedReload pustaka).
let reloading = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Menyalakan (atau mematikan) status versi baru; menyalakan juga memunculkan lagi spanduk yang disembunyikan. */
function setNeedRefresh(value: boolean): void {
  if (needRefresh === value && !(value && dismissed)) return;
  needRefresh = value;
  dismissed = false;
  emit();
}

function markUrgent(): void {
  if (urgent) return;
  urgent = true;
  emit();
}

/** Percobaan otomatis untuk versi ini sudah dilakukan (atau diblokir pembatas lintas muat ulang). */
function autoTried(): boolean {
  return autoAttempted || autoStuck || autoStorageUnavailable || Date.now() < autoGuardUntil;
}

/** Galat muat potongan JS/CSS dinamis (cangkang lama meminta berkas yang sudah diganti oleh deploy baru). */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'ChunkLoadError') return true;
  return /dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(
    error.message,
  );
}

/** Tanpa jaringan, potongan yang gagal dimuat bukan bukti ada versi baru (mis. membuka /qrcode saat offline). */
function isOffline(): boolean {
  return (currentWin ?? window).navigator.onLine === false;
}

/**
 * Menyalakan spanduk "Ada versi baru" karena muat potongan gagal dan memeriksa pembaruan; tidak memuat ulang apa
 * pun. Saat offline tidak melakukan apa-apa.
 */
export function notifyChunkLoadFailure(): void {
  if (isOffline()) return;
  markUrgent();
  setNeedRefresh(true);
  runCheck();
}

function setPending(cancel: (() => void) | undefined) {
  const changed = (cancelPending === undefined) !== (cancel === undefined);
  cancelPending = cancel;
  if (changed) for (const listener of listeners) listener();
}

function reloadPage(win: Window) {
  if (reloading) return;
  // Muat ulang otomatis: periksa ulang "aman" TEPAT sebelum memuat ulang (keadaan dapat berubah selama menunggu
  // SW). Bila kini tidak aman, batalkan: spanduk tampil (percobaan sudah tercatat) dan Muat ulang oleh pengguna
  // memuat ulang langsung. Klik pengguna sendiri tidak diperiksa (keputusannya).
  if (autoInitiated && !isSafeToReload()) {
    autoInitiated = false;
    reloadRequested = false;
    emit();
    return;
  }
  reloading = true;
  win.location.reload();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Spanduk bergantung pada "aman": ikut berubah saat formulir/penulisan/mutasi berubah.
  const offSafety = subscribeSafety(listener);
  return () => {
    listeners.delete(listener);
    offSafety();
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
  autoGuardUntil = readAutoReloadGuard(win);
  autoStuck = readAutoStuck(win);
  autoStorageUnavailable = !storageUsable(win);
  reloadRequested = false;
  cancelPending = undefined;
  reloading = false;
  // SW menunggu terakhir yang sudah diumumkan; pembanding agar "Nanti" bertahan untuk SW yang sama tetapi deploy
  // berikutnya muncul lagi (workbox-window berhenti memanggil onNeedRefresh setelah pembaruan eksternal pertama).
  let announcedWaiting: ServiceWorker | null = null;
  // Pembatal pendengar statechange pada SW yang sedang dipasang (dilepas di pembersih).
  const disposers = new Set<() => void>();
  let watchedInstalling: ServiceWorker | null = null;

  function announceWaiting() {
    const waiting = registration?.waiting ?? null;
    if (stopped || !waiting || waiting === announcedWaiting) return;
    announcedWaiting = waiting;
    setNeedRefresh(true);
  }

  // registration.update() selesai SAAT SW baru masih `installing` (`waiting` baru terisi sesudah pra-cache), jadi
  // pengumuman menunggu transisi ke `installed` alih-alih pemeriksaan berikutnya (sampai ±30 menit kemudian).
  function watchInstalling() {
    const installing = registration?.installing ?? null;
    if (stopped || !installing || installing === watchedInstalling) return;
    watchedInstalling = installing;
    const onChange = () => {
      if (installing.state === 'installed') announceWaiting();
      if (installing.state !== 'installing') dispose();
    };
    const dispose = () => {
      installing.removeEventListener('statechange', onChange);
      disposers.delete(dispose);
    };
    installing.addEventListener('statechange', onChange);
    disposers.add(dispose);
  }

  function check() {
    if (stopped || !registration || win.navigator.onLine === false) return;
    try {
      // Galat jaringan/peramban pada pemeriksaan pembaruan tidak boleh mengganggu aplikasi.
      registration
        .update()
        .then(() => {
          announceWaiting();
          watchInstalling();
        })
        .catch(() => undefined);
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
    if (win.document.visibilityState !== 'visible') return;
    // Tab kembali terlihat: saat yang wajar untuk memakai versi baru bila aman (tanpa spanduk).
    maybeAutoReload();
    checkOnEvent();
  }

  updateSW = options.register({
    immediate: true,
    // Tanpa ini pustaka memuat ulang SETIAP tab saat salah satu mengaktifkan versi baru (draf tab lain hilang).
    onNeedReload: () => {
      if (reloadRequested) reloadPage(win);
    },
    onNeedRefresh: () => {
      announcedWaiting = registration?.waiting ?? announcedWaiting;
      setNeedRefresh(true);
    },
    onRegisteredSW: (_swUrl, registered) => {
      registration = registered;
      currentRegistration = registered;
      // Pembaruan SW yang dimulai peramban sendiri (navigasi, pemeriksaan 24 jam) juga dipantau, tanpa menunggu
      // pemeriksaan kita berikutnya; pustaka berhenti memanggil onNeedRefresh setelah pembaruan eksternal pertama.
      if (registered?.addEventListener) {
        const onUpdateFound = () => watchInstalling();
        registered.addEventListener('updatefound', onUpdateFound);
        const disposeUpdateFound = () => {
          registered.removeEventListener('updatefound', onUpdateFound);
          disposers.delete(disposeUpdateFound);
        };
        disposers.add(disposeUpdateFound);
      }
      // Pustaka dapat mengumumkan SW menunggu sebelum registrasi diketahui: samakan pembanding agar pemeriksaan
      // pertama tidak menganggapnya "baru" dan membatalkan Nanti.
      if (needRefresh) announcedWaiting = registered?.waiting ?? null;
      // Halaman dimuat tanpa SW menunggu: yang macet sebelumnya sudah beres; percobaan otomatis boleh lagi.
      if (autoStuck && !registered?.waiting) {
        autoStuck = false;
        clearAutoStuck(win);
        emit();
      }
      check();
    },
    onRegisterError: () => undefined,
  });
  runCheck = check;
  // Cangkang lama dapat meminta potongan lazy yang sudah tak ada di server setelah deploy: ajak pengguna memuat
  // ulang lewat spanduk (FR-P11/P12) dan periksa pembaruan. `preventDefault` menekan muat ulang otomatis
  // TanStack Router (isModuleNotFoundError), yang kini digantikan spanduk dan tombol "Muat ulang" (FR-P13);
  // impor rute itu sendiri lalu bernilai undefined dan ErrorView mengarahkan pengguna ke "Muat ulang".
  // Saat offline tidak ada bukti versi baru: biarkan penanganan bawaan.
  const onPreloadError = (event: Event) => {
    if (isOffline()) return;
    markUrgent();
    setNeedRefresh(true);
    event.preventDefault();
    check();
  };
  win.document.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('focus', checkOnEvent);
  win.addEventListener('vite:preloadError', onPreloadError);
  const timer = win.setInterval(check, intervalMs);

  return () => {
    stopped = true;
    for (const dispose of [...disposers]) dispose();
    win.document.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('focus', checkOnEvent);
    win.removeEventListener('vite:preloadError', onPreloadError);
    win.clearInterval(timer);
    // Lepas rujukan ke jendela/registrasi lama; status spanduk (needRefresh/dismissed) sengaja dibiarkan.
    updateSW = undefined;
    currentWin = undefined;
    currentRegistration = undefined;
    cancelPending?.();
    reloadRequested = false;
    reloading = false;
    autoInitiated = false;
    runCheck = () => undefined;
  };
}

function readAutoReloadGuard(win: Window): number {
  try {
    const stored = Number(win.sessionStorage?.getItem(AUTO_RELOAD_GUARD_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored + AUTO_RELOAD_GUARD_MS : 0;
  } catch {
    return 0;
  }
}

function writeAutoReloadGuard(win: Window): void {
  try {
    win.sessionStorage?.setItem(AUTO_RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // Tak mungkin sampai sini: percobaan otomatis hanya dilakukan bila penyimpanan dapat dipakai.
  }
}

function readAutoStuck(win: Window): boolean {
  try {
    return win.sessionStorage?.getItem(AUTO_STUCK_KEY) === '1';
  } catch {
    return false;
  }
}

function clearAutoStuck(win: Window): void {
  try {
    win.sessionStorage?.removeItem(AUTO_STUCK_KEY);
  } catch {
    // Dibiarkan.
  }
}

/** Percobaan otomatis berakhir di batas waktu tanpa SW mengambil alih: tandai macet (tanpa kedaluwarsa). */
function markAutoStuck(win: Window): void {
  if (!autoInitiated) return;
  autoStuck = true;
  try {
    win.sessionStorage?.setItem(AUTO_STUCK_KEY, '1');
  } catch {
    // Dibiarkan: penyimpanan tak dapat dipakai berarti tak ada percobaan otomatis sejak awal.
  }
}

/** sessionStorage dapat ditulis dan dibaca (pembatas lintas muat ulang bergantung padanya). */
function storageUsable(win: Window): boolean {
  try {
    const storage = win.sessionStorage;
    if (!storage) return false;
    storage.setItem('qc-pwa-probe', '1');
    return storage.getItem('qc-pwa-probe') === '1';
  } catch {
    return false;
  }
}

/**
 * Muat ulang OTOMATIS pada "saat wajar" (pindah halaman, tab kembali terlihat) bila ada versi baru dan AMAN
 * (`isSafeToReload`: tanpa formulir belum tersimpan dan tanpa penulisan berjalan). Satu percobaan per versi; setelah
 * itu spanduk. Keamanan diperiksa lagi tepat sebelum memuat ulang (`reloadPage`).
 */
function maybeAutoReload(): void {
  const win = currentWin;
  if (!win || !needRefresh || reloading || cancelPending) return;
  // Tanpa registrasi dikenal, "SKIP_WAITING" tak berarti (kecuali halaman rusak): jangan menebak.
  if (!currentRegistration && !urgent) return;
  if (autoTried() || !isSafeToReload()) return;
  autoAttempted = true;
  writeAutoReloadGuard(win);
  startReload(true);
  emit();
}

/**
 * Pemicu perpindahan halaman (dari router): muat ulang otomatis bila ada versi baru dan aman. Selalu
 * `location.reload()`: saat muat ulang berjalan, navigasi sudah dikomit sehingga URL saat ini = tujuan.
 */
export function notifyNavigation(): void {
  maybeAutoReload();
}

/** Router minimal yang dibutuhkan untuk mendengar perpindahan (dipenuhi `router.subscribe` TanStack). */
export interface NavigationSource {
  subscribe: (
    type: 'onBeforeNavigate',
    listener: (event: {
      fromLocation?: unknown;
      toLocation: { href: string };
      pathChanged: boolean;
    }) => void,
  ) => () => void;
}

/** Menghubungkan perpindahan halaman nyata (bukan muat awal, bukan ubah query/hash) ke `notifyNavigation`. */
export function attachNavigationTrigger(router: NavigationSource): () => void {
  return router.subscribe('onBeforeNavigate', (event) => {
    if (event.fromLocation && event.pathChanged) notifyNavigation();
  });
}

/** Menunggu SW yang sedang dipasang selesai (installed/activated/redundant) atau batas waktu, lalu memanggil `done`. */
function waitForInstall(win: Window, worker: ServiceWorker, done: () => void) {
  let timer: ReturnType<Window['setTimeout']> | undefined;
  const cancel = () => {
    worker.removeEventListener('statechange', onChange);
    if (timer !== undefined) win.clearTimeout(timer);
    setPending(undefined);
  };
  const finish = () => {
    cancel();
    done();
  };
  const onChange = () => {
    if (
      worker.state === 'installed' ||
      worker.state === 'activated' ||
      worker.state === 'redundant'
    ) {
      finish();
    }
  };
  worker.addEventListener('statechange', onChange);
  timer = win.setTimeout(() => {
    markAutoStuck(win);
    finish();
  }, INSTALL_WAIT_MS);
  setPending(cancel);
}

/**
 * Mengaktifkan SW yang menunggu dan memuat ulang begitu ia mengendalikan halaman. Pendengar `controllerchange`
 * dipasang sendiri karena pendengar `controlling` milik pustaka tak selalu terpasang (mis. spanduk dinyalakan oleh
 * pemeriksaan kami atau oleh galat muat potongan, bukan oleh peristiwa `waiting` pustaka). Bila peristiwa itu tak
 * kunjung datang, halaman dimuat ulang setelah batas waktu agar tombol tidak buntu.
 */
function activateWaiting(win: Window) {
  const container = win.navigator.serviceWorker;
  let timer: ReturnType<Window['setTimeout']> | undefined;
  const cancel = () => {
    container?.removeEventListener?.('controllerchange', onControllerChange);
    if (timer !== undefined) win.clearTimeout(timer);
    setPending(undefined);
  };
  const onControllerChange = () => {
    cancel();
    reloadPage(win);
  };
  container?.addEventListener?.('controllerchange', onControllerChange, { once: true });
  timer = win.setTimeout(() => {
    markAutoStuck(win);
    onControllerChange();
  }, ACTIVATE_WAIT_MS);
  setPending(cancel);
  void updateSW?.(true);
}

/** Tombol Muat ulang (klik pengguna). */
function reload() {
  startReload(false);
}

function startReload(auto: boolean) {
  // Sudah menunggu (installing/pengambilalihan): klik ulang tidak menumpuk penunggu.
  if (cancelPending) return;
  autoInitiated = auto;
  reloadRequested = true;
  const win = currentWin ?? window;
  const registration = currentRegistration;
  // SKIP_WAITING hanya berefek bila ada SW yang menunggu pada registrasi yang terpakai.
  if (registration?.waiting && updateSW) {
    activateWaiting(win);
    return;
  }
  // SW baru masih dipasang (mis. potongan gagal sebelum selesai): tunggu dulu, jangan memuat ulang cangkang lama.
  if (registration?.installing && updateSW) {
    waitForInstall(win, registration.installing, () => {
      if (currentRegistration?.waiting && updateSW) activateWaiting(win);
      else reloadPage(win);
    });
    return;
  }
  // Selain itu (tak ada registrasi: gagal/belum selesai/dev/tanpa serviceWorker; atau SW sudah diaktifkan jendela
  // lain) SKIP_WAITING no-op dan tombol tampak mati: muat ulang halaman langsung.
  reloadPage(win);
}

function dismiss() {
  // Selama fase menunggu (SW dipasang/mengambil alih) Nanti diabaikan: SKIP_WAITING sudah terkirim dan tak dapat
  // dibatalkan (keputusan pemilik 2026-11-13, N1).
  if (cancelPending) return;
  if (!needRefresh || dismissed) return;
  dismissed = true;
  for (const listener of listeners) listener();
}

// Snapshot primitif (bit): 1 = ada pembaruan, 2 = disembunyikan ("Nanti"), 4 = muat ulang tertunda, 8 = tidak aman
// dimuat ulang, 16 = halaman rusak (galat muat potongan), 32 = percobaan otomatis versi ini sudah dilakukan,
// 64 = muat ulang yang tertunda dimulai otomatis.
function snapshot(): number {
  return (
    (needRefresh ? 1 : 0) |
    (dismissed ? 2 : 0) |
    (cancelPending ? 4 : 0) |
    (isSafeToReload() ? 0 : 8) |
    (urgent ? 16 : 0) |
    (autoTried() ? 32 : 0) |
    (autoInitiated && cancelPending ? 64 : 0)
  );
}

/**
 * Status pembaruan: `needRefresh` menyala bila versi baru sudah diunduh; `dismissed` bila pengguna memilih "Nanti";
 * `reload` mengaktifkannya dan memuat ulang.
 */
export function usePwaUpdate(): {
  needRefresh: boolean;
  dismissed: boolean;
  /**
   * Spanduk harus tampil: ada versi baru, tidak disembunyikan, DAN (halaman rusak, atau tidak aman dimuat ulang, atau
   * percobaan otomatis sudah dilakukan). Saat aman, versi baru dipakai otomatis pada pemicu tanpa spanduk.
   */
  visible: boolean;
  /** Muat ulang sedang menunggu (SW dipasang/mengambil alih): tombol memberi umpan balik dan klik ulang diabaikan. */
  pending: boolean;
  reload: () => void;
  dismiss: () => void;
} {
  const value = useSyncExternalStore(subscribe, snapshot, () => 0);
  return useMemo(
    () => ({
      needRefresh: (value & 1) !== 0,
      dismissed: (value & 2) !== 0,
      visible:
        (value & 1) !== 0 &&
        (value & 2) === 0 &&
        (value & (8 | 16 | 32)) !== 0 &&
        (value & 64) === 0,
      pending: (value & 4) !== 0,
      reload,
      dismiss,
    }),
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
  cancelPending?.();
  cancelPending = undefined;
  reloading = false;
  urgent = false;
  autoAttempted = false;
  autoGuardUntil = 0;
  autoStuck = false;
  autoStorageUnavailable = false;
  autoInitiated = false;
  runCheck = () => undefined;
  for (const listener of listeners) listener();
}
