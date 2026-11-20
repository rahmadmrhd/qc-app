import { runAfterOverlays } from './nav-stack';

/**
 * Aturan push/replace/pop untuk riwayat sebagai tumpukan layar di ponsel (spek redesain butir 41c). Modul murni
 * (tanpa React/router): pemanggilnya (`useStackNavigation`) menyuntik fungsi navigasi router dan `history`.
 *
 * - push  : maju ke layar baru yang "lebih dalam" (buka View dari daftar, buka form dari View).
 * - replace: mengganti layar tanpa menambah entri (filter/cari/urut/tab, ganti modul lewat menu, simpan form Tambah).
 * - pop   : kembali ke layar asal (simpan form Ubah, hapus dari View, Batal): `history.back()` bila entri sebelumnya
 *           memang tujuannya, selain itu replace ke tujuan (tak ada entri yang berlebihan).
 */

interface TrailEntry {
  /** `pathname` saja: query (filter) tidak menentukan identitas layar. */
  path: string;
}

/** Jejak lokasi per indeks riwayat (`__TSR_index`), hanya di memori; hilang saat muat ulang (lalu aman = replace). */
const trail = new Map<number, TrailEntry>();

export function historyIndex(): number | null {
  const state = window.history.state as { __TSR_index?: unknown } | null;
  return typeof state?.__TSR_index === 'number' ? state.__TSR_index : null;
}

/** Mencatat lokasi saat ini pada indeksnya; dipanggil setiap navigasi router selesai. */
export function recordLocation(path: string = window.location.pathname): void {
  const index = historyIndex();
  if (index !== null) trail.set(index, { path });
}

/** Pathname entri riwayat sebelum yang sekarang, bila diketahui. */
export function previousPath(): string | null {
  const index = historyIndex();
  if (index === null) return null;
  return trail.get(index - 1)?.path ?? null;
}

/** Mengisi jejak untuk entri yang disisipkan (rantai induk tautan dalam). */
export function seedTrail(index: number, path: string): void {
  trail.set(index, { path });
}

export function resetTrail(): void {
  trail.clear();
}

export interface StackNavigator<T> {
  /** Navigasi router; `replace` mengganti entri. Dipasok pemanggil (mis. `router.navigate`). */
  go: (target: T, options: { replace: boolean }) => void;
  /** Pathname hasil dari `target`, untuk dibandingkan dengan entri riwayat sebelumnya. */
  pathOf: (target: T) => string;
}

/** replace ke `target` setelah semua overlay dilepas (agar yang diganti entri halaman, bukan entri overlay). */
export function replaceTo<T>(nav: StackNavigator<T>, target: T): void {
  runAfterOverlays(() => nav.go(target, { replace: true }));
}

/** push ke `target` setelah semua overlay dilepas. */
export function pushTo<T>(nav: StackNavigator<T>, target: T): void {
  runAfterOverlays(() => nav.go(target, { replace: false }));
}

/**
 * Kembali ke `target`: bila entri sebelumnya adalah `target` (pathname sama) cukup `history.back()`; selain itu
 * (muat ulang, tautan dalam, jejak tak diketahui) replace ke `target`.
 */
export function popTo<T>(nav: StackNavigator<T>, target: T): void {
  const targetPath = nav.pathOf(target);
  runAfterOverlays(() => {
    if (previousPath() === targetPath) window.history.back();
    else nav.go(target, { replace: true });
  });
}
