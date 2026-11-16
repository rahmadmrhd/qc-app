// Menampilkan notifikasi aliran sebagai notifikasi OS. Logika murni (dedupe, tautan klik) dengan penampil yang
// disuntik; `index.ts` memasang `Notification` Electron sebagai penampil.

import { type StreamNotice, safeAppPath } from './notice';

export interface ShownNotice {
  title: string;
  body: string;
  /** Dipanggil saat pengguna mengklik notifikasi. */
  onClick(): void;
}

export interface NotifierDeps {
  /** `false` = OS/penampil tak mendukung notifikasi (diam saja). */
  supported(): boolean;
  /**
   * Jendela utama sedang terlihat dan difokuskan pengguna? Bila ya, popup OS dilewati: lonceng di header sudah berubah
   * seketika (sinyal jembatan), jadi popup hanya akan menggandakan kabar yang sedang dilihat pengguna (keputusan pemilik
   * 2026-11-16). Berlaku di desktop saja: Web Push di peramban wajib menampilkan notifikasi (Safari/iOS dapat mencabut
   * langganan bila tidak), jadi tak ada penyembunyian serupa di sana.
   */
  isWindowFocused(): boolean;
  show(notice: ShownNotice): void;
  /** Menampilkan jendela utama (dari tray/terminimalkan) dan memfokuskannya. */
  focusWindow(): void;
  /** Membuka jalur dalam aplikasi (sudah divalidasi). */
  openPath(path: string): void;
}

/** Id yang diingat untuk menolak duplikat (server bisa mengirim ulang saat sambung ulang). */
const SEEN_MAX = 200;

export interface Notifier {
  handle(notice: StreamNotice): void;
}

export function createNotifier(deps: NotifierDeps): Notifier {
  const seen = new Set<string>();
  return {
    handle(notice) {
      if (seen.has(notice.id)) return;
      seen.add(notice.id);
      if (seen.size > SEEN_MAX) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      // Sudah tercatat di `seen` di atas: kiriman ulang saat sambung ulang tak memunculkan popup basi setelahnya.
      if (deps.isWindowFocused()) return;
      if (!deps.supported()) return;
      const path = safeAppPath(notice.url) ?? '/';
      deps.show({
        title: notice.title,
        body: notice.body,
        onClick: () => {
          deps.focusWindow();
          deps.openPath(path);
        },
      });
    },
  };
}
