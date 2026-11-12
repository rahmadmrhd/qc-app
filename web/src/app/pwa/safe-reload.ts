import { isBusy, subscribeBusy } from './busy';
import { hasUnsavedChanges, subscribeUnsavedChanges } from './unsaved-changes';

/** Sumber hitungan mutasi (QueryClient); disuntik dari main.tsx agar modul ini murni dan mudah dites. */
export interface MutationSource {
  isMutating: () => number;
  subscribe: (callback: () => void) => () => void;
}

let mutationSource: MutationSource | undefined;

export function setMutationSource(source: MutationSource | undefined): void {
  mutationSource = source;
}

/**
 * Aman memuat ulang halaman bila TIDAK ada formulir belum tersimpan DAN tidak ada penulisan yang sedang
 * berjalan (mutasi react-query, centang checklist yang antre, atau permintaan tulis API apa pun). Satu-satunya
 * definisi "aman" untuk muat ulang otomatis dan untuk menentukan tampilnya spanduk (keputusan pemilik 2026-11-13).
 */
export function isSafeToReload(): boolean {
  if (hasUnsavedChanges()) return false;
  if (isBusy()) return false;
  if (mutationSource && mutationSource.isMutating() > 0) return false;
  return true;
}

/** Memberi tahu saat salah satu sumber "tidak aman" berubah (formulir, penulisan, mutasi). */
export function subscribeSafety(listener: () => void): () => void {
  const offUnsaved = subscribeUnsavedChanges(listener);
  const offBusy = subscribeBusy(listener);
  const offMutation = mutationSource?.subscribe(listener);
  return () => {
    offUnsaved();
    offBusy();
    offMutation?.();
  };
}

export function resetSafeReloadForTests(): void {
  mutationSource = undefined;
}
