// Keadaan "bundel UI baru siap" di aplikasi desktop, disimpan di tingkat modul agar pengumuman dari proses
// utama (`bridge.ui.onUpdateReady`, dikirim sekali per versi) tidak terlewat bila spanduk belum terpasang
// (halaman /login) atau di-mount ulang (pindah antara AppShell dan /country-lock).

import type { QcBridge } from '@countrylock/bridge-contract';
import { useSyncExternalStore } from 'react';
import { getBridge } from '@/lib/platform';

/** `bridge.ui` diperkenalkan di jembatan v3; jembatan yang lebih rendah tidak punya kanal ini. */
export const UI_BRIDGE_MIN_VERSION = 3;

/** Jembatan punya `bridge.ui` yang dapat dipakai (versi cukup dan fungsi ada)? */
export function hasUiBridge(bridge: QcBridge | null): bridge is QcBridge {
  return (
    bridge !== null &&
    bridge.version >= UI_BRIDGE_MIN_VERSION &&
    typeof bridge.ui?.onUpdateReady === 'function' &&
    typeof bridge.ui?.reload === 'function'
  );
}

let ready = false;
let watched: QcBridge | null = null;
let unsubscribe: (() => void) | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

/**
 * Mulai mendengarkan pengumuman bundel UI siap (idempoten per objek jembatan). Dipanggil saat aplikasi
 * desktop start (`main.tsx`) dan oleh spanduk; tak berbuat apa pun di peramban atau pada jembatan lama.
 */
export function startUiUpdateWatch(): void {
  const bridge = getBridge();
  if (!hasUiBridge(bridge) || watched === bridge) return;
  unsubscribe?.();
  watched = bridge;
  unsubscribe = bridge.ui.onUpdateReady(() => {
    ready = true;
    emit();
  });
}

/** Hanya untuk tes: kembali ke keadaan awal dan berhenti berlangganan. */
export function resetUiUpdateStore(): void {
  unsubscribe?.();
  unsubscribe = null;
  watched = null;
  ready = false;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Bundel UI baru sudah siap diterapkan (pengumuman sudah diterima pada sesi ini)? */
export function useUiUpdateReady(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => ready,
    () => false,
  );
}
