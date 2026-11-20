import { useSyncExternalStore } from 'react';

// Seberapa mendesak klien ini perlu diperbarui (fase 3 versi API). `deprecated` = server menandai versi API yang dipakai
// klien ini akan dihapus (spanduk, tanpa memuat ulang); `outdated` = server menolak dengan 426 `CLIENT_OUTDATED`
// (muat ulang paksa lewat alur `update.ts`). Hanya naik selama halaman hidup: pemuatan ulang yang berhasil membuang
// keadaan ini bersama halamannya. Sengaja tanpa impor lain agar `client.ts`/`versions.ts` dapat memanggilnya tanpa siklus.

export type OutdatedLevel = 'none' | 'deprecated' | 'outdated';

const RANK: Record<OutdatedLevel, number> = { none: 0, deprecated: 1, outdated: 2 };

let level: OutdatedLevel = 'none';
const listeners = new Set<() => void>();

export function getOutdatedLevel(): OutdatedLevel {
  return level;
}

/** Menaikkan tingkat (tak pernah menurun); pendengar hanya diberi tahu bila nilainya benar-benar berubah. */
export function raiseOutdatedLevel(next: OutdatedLevel): void {
  if (RANK[next] <= RANK[level]) return;
  level = next;
  for (const listener of listeners) listener();
}

export function subscribeOutdated(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOutdatedLevel(): OutdatedLevel {
  return useSyncExternalStore(subscribeOutdated, getOutdatedLevel, () => 'none');
}

export function resetOutdatedForTests(): void {
  const changed = level !== 'none';
  level = 'none';
  if (changed) for (const listener of listeners) listener();
}
