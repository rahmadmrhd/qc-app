import { isBusy, subscribeBusy } from './busy';
import { hasUnsavedChanges, subscribeUnsavedChanges } from './unsaved-changes';

/** Sumber hitungan mutasi (QueryClient); disuntik dari main.tsx agar modul ini murni dan mudah dites. */
export interface MutationSource {
  isMutating: () => number;
  subscribe: (callback: () => void) => () => void;
}

// Untuk TAMPILAN spanduk saja: penulisan yang lebih singkat dari ini diabaikan (spanduk tidak berkedip tiap centang
// atau simpan selama versi baru menunggu; keputusan pemilik 2026-11-13, M-d).
const DISPLAY_BUSY_DELAY_MS = 1_000;

let mutationSource: MutationSource | undefined;
let offMutation: (() => void) | undefined;
let busyLong = false;
let busyTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function writing(): boolean {
  return isBusy() || (mutationSource?.isMutating() ?? 0) > 0;
}

// Memperbarui "sibuk lama": menyala setelah penulisan bertahan >= DISPLAY_BUSY_DELAY_MS, padam seketika bila selesai.
function syncBusyLong(): void {
  if (!writing()) {
    if (busyTimer !== undefined) clearTimeout(busyTimer);
    busyTimer = undefined;
    busyLong = false;
    return;
  }
  if (busyLong || busyTimer !== undefined) return;
  busyTimer = setTimeout(() => {
    busyTimer = undefined;
    if (!writing()) return;
    busyLong = true;
    notify();
  }, DISPLAY_BUSY_DELAY_MS);
}

function onWritingChange(): void {
  syncBusyLong();
  notify();
}

// Langganan sumber tetap seumur modul (murah); pelanggan hanya mendaftar ke `listeners`.
subscribeBusy(onWritingChange);
subscribeUnsavedChanges(notify);

export function setMutationSource(source: MutationSource | undefined): void {
  offMutation?.();
  mutationSource = source;
  offMutation = source?.subscribe(onWritingChange);
  syncBusyLong();
}

/**
 * Aman memuat ulang halaman bila TIDAK ada formulir belum tersimpan DAN tidak ada penulisan yang sedang
 * berjalan (mutasi react-query, centang checklist yang antre, atau permintaan tulis API apa pun). Satu-satunya
 * definisi "aman" untuk muat ulang otomatis (diperiksa seketika, tanpa jeda) (keputusan pemilik 2026-11-13).
 */
export function isSafeToReload(): boolean {
  if (hasUnsavedChanges()) return false;
  if (writing()) return false;
  return true;
}

/**
 * "Tidak aman" untuk TAMPILAN spanduk: formulir belum tersimpan seketika, atau penulisan yang bertahan >= 1 dtk
 * (penulisan singkat tidak membuat spanduk berkedip). Keputusan muat ulang tetap memakai `isSafeToReload`.
 */
export function isUnsafeForDisplay(): boolean {
  return hasUnsavedChanges() || busyLong;
}

/** Memberi tahu saat salah satu sumber "tidak aman" berubah (formulir, penulisan, mutasi, atau sibuk lama). */
export function subscribeSafety(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetSafeReloadForTests(): void {
  offMutation?.();
  offMutation = undefined;
  mutationSource = undefined;
  if (busyTimer !== undefined) clearTimeout(busyTimer);
  busyTimer = undefined;
  busyLong = false;
}
