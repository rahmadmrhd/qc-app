import { NOTIFICATIONS_BRIDGE_VERSION } from '@countrylock/bridge-channels';
import type { QcBridge } from '@countrylock/bridge-contract';
import { NOTIFICATIONS_STREAM_EVENT, NOTIFICATIONS_STREAM_PATH } from '@shared/notifications';
import type { QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getBridge, isDesktop } from '@/lib/platform';
import { notificationKeys } from './queries';
import { isNotificationStreamConnected, setNotificationStreamConnected } from './stream-state';

/** Jendela penggabungan bingkai `notification` yang berdekatan menjadi satu pemuatan ulang daftar (milidetik). */
export const REFRESH_DEBOUNCE_MS = 150;

/** Jeda membuka ulang stream yang DITUTUP peramban (mis. ditolak 401/5xx); sambung ulang biasa diurus `EventSource`. */
export const STREAM_REOPEN_MS = 15_000;

/** Bagian `EventSource` yang dipakai; memudahkan tes tanpa peramban. */
export interface StreamSource {
  readyState: number;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: () => void): void;
  close(): void;
}

export interface StreamDeps {
  /** `null` = tanpa dukungan `EventSource` (hanya polling). */
  createSource?: (url: string) => StreamSource | null;
  reopenMs?: number;
}

/**
 * Pemuat ulang daftar lonceng. Pemicu yang berdekatan (tunggakan sambung ulang membawa sampai 50 bingkai) digabung
 * menjadi satu pemuatan: `invalidateQueries` membatalkan pemuatan yang sedang berjalan, jadi 50 pemicu tanpa
 * penggabungan = 50 permintaan yang saling membatalkan.
 */
function createRefresher(queryClient: QueryClient) {
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = undefined;
    void queryClient.invalidateQueries({ queryKey: notificationKeys.list });
  };
  const scheduleRefresh = () => {
    if (refreshTimer !== undefined) return;
    refreshTimer = setTimeout(refresh, REFRESH_DEBOUNCE_MS);
  };
  const cancelRefresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = undefined;
  };
  return { refresh, scheduleRefresh, cancelRefresh };
}

/** `EventSource.CLOSED`. */
const CLOSED = 2;

function defaultSource(url: string): StreamSource | null {
  // Aplikasi desktop (web berjalan di renderer Electron) TIDAK membuka aliran dari lonceng: proses utamanya sudah
  // memegang aliran Bearer sendiri untuk notifikasi Windows, dan aliran renderer lewat proxy memakai bucket desktop
  // yang sama (maks. 3 per pengguna), sehingga dua PC milik satu pengguna akan saling menggusur. Lonceng desktop
  // diperbarui lewat sinyal jembatan (`startBridgeNotifications`), dengan polling 10 dtk sebagai cadangan.
  if (isDesktop()) return null;
  if (typeof EventSource === 'undefined') return null;
  // Same-origin: cookie sesi ikut terkirim tanpa `withCredentials`.
  return new EventSource(url) as StreamSource;
}

/**
 * Menyambung stream SSE notifikasi (hub yang sama dengan aplikasi desktop, cookie sesi; spek notifikasi, "Lonceng
 * seketika"). Muatan bingkai `notification` TIDAK dipakai: tiap bingkai hanya membuat daftar lonceng dimuat ulang lewat
 * `notifications.list` (izin dan isi tetap dari jalur baca), digabung dalam `REFRESH_DEBOUNCE_MS` karena sambung ulang
 * dapat membawa puluhan bingkai tunggakan sekaligus. Saat tersambung, polling melambat; saat putus polling kembali
 * 10 dtk (`queries.ts`) dan daftar langsung dimuat ulang. Sambung ulang: `EventSource` mengurusnya sendiri; bila peramban menutupnya (status ditolak), dibuka ulang
 * tiap `STREAM_REOPEN_MS`, atau segera saat tab kembali terlihat. Mengembalikan fungsi penutup.
 */
export function startNotificationStream(
  queryClient: QueryClient,
  deps: StreamDeps = {},
): () => void {
  const create = deps.createSource ?? defaultSource;
  const reopenMs = deps.reopenMs ?? STREAM_REOPEN_MS;
  let source: StreamSource | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const { refresh, scheduleRefresh, cancelRefresh } = createRefresher(queryClient);

  const open = () => {
    if (stopped) return;
    clearTimeout(timer);
    source?.close();
    const next = create(NOTIFICATIONS_STREAM_PATH);
    source = next;
    if (next === null) return;
    next.onopen = () => {
      if (source !== next) return;
      setNotificationStreamConnected(true);
      // Sinyal yang lewat selama putus tak terulang: muat ulang sekali pada tiap (re)koneksi.
      refresh();
    };
    next.addEventListener(NOTIFICATIONS_STREAM_EVENT, () => {
      if (source === next) scheduleRefresh();
    });
    next.onerror = () => {
      if (source !== next) return;
      const wasConnected = isNotificationStreamConnected();
      setNotificationStreamConnected(false);
      // Hanya saat status BERBALIK dari tersambung ke putus: polling cepat ambil alih seketika (selang dihitung ulang
      // setelah pemuatan ini). Percobaan sambung ulang berikutnya (tiap 3 dtk selama server mati, mis. saat deploy)
      // tidak memuat daftar lagi, kalau tidak tiap tab membanjiri server di luar polling 10 dtk.
      if (wasConnected) refresh();
      if (next.readyState === CLOSED) {
        clearTimeout(timer);
        timer = setTimeout(open, reopenMs);
      }
    };
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible' && source?.readyState === CLOSED) open();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onVisible);
  open();

  return () => {
    stopped = true;
    clearTimeout(timer);
    cancelRefresh();
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onVisible);
    source?.close();
    source = null;
    setNotificationStreamConnected(false);
  };
}

/**
 * Aplikasi desktop: lonceng tidak membuka aliran sendiri (lihat `defaultSource`); proses utama meneruskan sinyal
 * "ada notifikasi baru" dari alirannya lewat jembatan (`bridge.notifications.onChange`, jembatan v4), dan tiap sinyal
 * memuat ulang daftar (digabung seperti bingkai aliran web). Aplikasi desktop dengan jembatan lama (< v4) tidak
 * punya sinyal itu: lonceng tetap hanya polling 10 dtk. Status polling tidak diubah (`isNotificationStreamConnected`
 * tetap false): renderer tak tahu apakah aliran proses utama sehat, jadi polling cepat dipertahankan sebagai
 * jaring pengaman. Mengembalikan fungsi penutup.
 */
export function startBridgeNotifications(
  queryClient: QueryClient,
  bridge: QcBridge | null = getBridge(),
): () => void {
  if (
    bridge === null ||
    bridge.version < NOTIFICATIONS_BRIDGE_VERSION ||
    typeof bridge.notifications?.onChange !== 'function'
  ) {
    return () => {};
  }
  const { scheduleRefresh, cancelRefresh } = createRefresher(queryClient);
  const unsubscribe = bridge.notifications.onChange(scheduleRefresh);
  return () => {
    unsubscribe();
    cancelRefresh();
  };
}

/**
 * Menyambung pembaruan seketika selama komponen terpasang (dipakai lonceng di header): aliran SSE di peramban,
 * sinyal jembatan di aplikasi desktop. Tanpa keduanya = hanya polling.
 */
export function useNotificationStream(): void {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      isDesktop() ? startBridgeNotifications(queryClient) : startNotificationStream(queryClient),
    [queryClient],
  );
}
