import type { ReactNode } from 'react';

/** Satu cue keterangan klip: `at` = detik sejak awal klip; teks berlaku sampai cue berikutnya. */
export interface DemoCue {
  at: number;
  text: string;
}

/**
 * Satu adegan demo tooltip (spek 4.6). `kode` = adegan HTML/CSS yang dimainkan langsung (`render`) selama
 * `durationMs`; `klip` = video pendek berulang untuk yang terjadi di luar aplikasi. `berkas` klip = NAMA POLOS
 * berkas di `web/public/klip/` (mis. `tip-handover-tempel-wa-1.webm`); pemutar membangun URL-nya lewat `klipUrl`.
 * `klip` tanpa `berkas` (belum direkam) tampil sebagai kartu langkah bernomor untuk adegan itu saja.
 */
export type DemoScene =
  | { kind: 'kode'; caption: string; durationMs: number; render: () => ReactNode }
  | { kind: 'klip'; caption: string; berkas?: string; cues?: readonly DemoCue[] };

/** Awalan URL berkas klip (disajikan sebagai berkas statis dari `web/public/klip/`). */
export const KLIP_URL_PREFIX = '/klip/';

/** URL klip untuk `berkas` (nama polos). Satu-satunya tempat URL ini dibangun. */
export function klipUrl(berkas: string): string {
  return `${KLIP_URL_PREFIX}${berkas}`;
}

type SceneLoader = () => Promise<readonly DemoScene[]>;

const registry = new Map<string, readonly DemoScene[]>();
const loaders = new Map<string, SceneLoader>();
const pending = new Map<string, Promise<readonly DemoScene[] | undefined>>();

/** Mendaftarkan adegan yang sudah ada di memori (tes, atau demo kecil) menurut id entri `tip`. */
export function registerDemoScenes(tipId: string, scenes: readonly DemoScene[]): void {
  registry.set(tipId, scenes);
}

/**
 * Mendaftarkan pemuat malas adegan entri `tip` (`() => import(...)`): katalog hanya memegang metadata dan adegan
 * (JSX, fungsi pemecah, dll.) baru diunduh saat demonya dibutuhkan lewat `loadDemoScenes`/`useDemoScenes`.
 */
export function registerDemoLoader(tipId: string, loader: SceneLoader): void {
  loaders.set(tipId, loader);
}

/** Adegan yang SUDAH termuat/terdaftar (sinkron); `undefined` bila belum. */
export function getDemoScenes(tipId: string): readonly DemoScene[] | undefined {
  return registry.get(tipId);
}

/**
 * Adegan entri `tip`: yang sudah terdaftar, atau dimuat lewat pemuatnya (sekali; hasilnya disimpan sehingga
 * `getDemoScenes` kemudian mengembalikannya). Pemuat yang gagal tidak disimpan, jadi pembukaan berikutnya mencoba
 * lagi. `undefined` bila `tipId` tak punya demo atau pemuatan gagal.
 */
export function loadDemoScenes(tipId: string): Promise<readonly DemoScene[] | undefined> {
  const ready = registry.get(tipId);
  if (ready) return Promise.resolve(ready);
  const existing = pending.get(tipId);
  if (existing) return existing;
  const loader = loaders.get(tipId);
  if (!loader) return Promise.resolve(undefined);
  const promise = loader()
    .then((scenes) => {
      registry.set(tipId, scenes);
      return scenes;
    })
    .catch(() => undefined)
    .finally(() => pending.delete(tipId));
  pending.set(tipId, promise);
  return promise;
}
