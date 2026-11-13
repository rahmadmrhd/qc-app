import type { ReactNode } from 'react';

/** Satu cue keterangan klip: `at` = detik sejak awal klip; teks berlaku sampai cue berikutnya. */
export interface DemoCue {
  at: number;
  text: string;
}

/**
 * Satu adegan demo tooltip (spek 4.6). `kode` = adegan HTML/CSS yang dimainkan langsung (`render`) selama
 * `durationMs`; `klip` = video pendek berulang untuk yang terjadi di luar aplikasi. `klip` tanpa `berkas`
 * (belum direkam) memakai fallback daftar langkah bernomor.
 */
export type DemoScene =
  | { kind: 'kode'; caption: string; durationMs: number; render: () => ReactNode }
  | { kind: 'klip'; caption: string; berkas?: string; cues?: readonly DemoCue[] };

const registry = new Map<string, readonly DemoScene[]>();

/**
 * Daftar adegan menurut id entri `tip`, agar `TipButton` (dan tur, untuk langkah ber-`tip`) menemukan demo yang
 * sama tanpa menulisnya dua kali. Pemilik demo mendaftarkannya sekali saat modulnya dimuat.
 */
export function registerDemoScenes(tipId: string, scenes: readonly DemoScene[]): void {
  registry.set(tipId, scenes);
}

export function getDemoScenes(tipId: string): readonly DemoScene[] | undefined {
  return registry.get(tipId);
}
