import { useEffect, useSyncExternalStore } from 'react';

// Registri formulir dengan perubahan belum disimpan (FR-P13). Tiap pemanggil mendaftar dengan token sendiri
// (bukan penghitung global), sehingga dua formulir kotor yang salah satunya ditutup tetap terbaca kotor.
const tokens = new Set<symbol>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Berlangganan perubahan status "belum disimpan" (juga dipakai `safe-reload`). */
export function subscribeUnsavedChanges(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Mendaftarkan formulir ini sebagai "belum disimpan" selama terpasang DAN `dirty`. */
export function useUnsavedChanges(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const token = Symbol('unsaved');
    tokens.add(token);
    emit();
    return () => {
      tokens.delete(token);
      emit();
    };
  }, [dirty]);
}

export function hasUnsavedChanges(): boolean {
  return tokens.size > 0;
}

export function useHasUnsavedChanges(): boolean {
  return useSyncExternalStore(subscribeUnsavedChanges, hasUnsavedChanges, () => false);
}

export function resetUnsavedChangesForTests(): void {
  tokens.clear();
  emit();
}
