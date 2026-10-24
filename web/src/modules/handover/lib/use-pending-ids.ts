import { useCallback, useState } from 'react';

/**
 * Melacak id task yang sedang punya mutasi berjalan, sehingga hanya kartu itu yang dinonaktifkan
 * (bukan seluruh papan). Beberapa task dapat berjalan bersamaan.
 */
export function usePendingIds() {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  const isPending = useCallback((id: string) => ids.has(id), [ids]);
  const track = useCallback(async <T>(id: string, run: () => Promise<T>): Promise<T> => {
    setIds((current) => new Set(current).add(id));
    try {
      return await run();
    } finally {
      setIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }, []);
  return { isPending, track };
}
