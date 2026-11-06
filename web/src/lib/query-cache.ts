import type { QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * Memasang hasil simpan dari server langsung ke cache daftar (tanpa memanggil server lagi). Tidak berbuat apa-apa bila
 * daftarnya belum pernah dimuat (halaman daftar akan memuatnya sendiri saat dibuka).
 */
export function upsertInList<T extends { id: string }>(
  queryClient: QueryClient,
  key: QueryKey,
  saved: T,
  compare: (a: T, b: T) => number,
): void {
  queryClient.setQueryData<T[]>(key, (current) => {
    if (!current) return current;
    const others = current.filter((entry) => entry.id !== saved.id);
    return [...others, saved].sort(compare);
  });
}

export function removeFromList<T extends { id: string }>(
  queryClient: QueryClient,
  key: QueryKey,
  id: string,
): void {
  queryClient.setQueryData<T[]>(key, (current) =>
    current ? current.filter((entry) => entry.id !== id) : current,
  );
}

/**
 * Menandai data basi TANPA memuat ulang sekarang: tidak menahan navigasi setelah simpan dan tidak mengantre RPC
 * (menghemat satu permintaan ke Worker dan D1). Data yang berubah dipasang lewat `upsertInList`/`setQueryData`.
 */
export function markStale(queryClient: QueryClient, ...keys: QueryKey[]): void {
  for (const queryKey of keys) {
    void queryClient.invalidateQueries({ queryKey, refetchType: 'none' });
  }
}
