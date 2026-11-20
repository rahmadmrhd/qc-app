import { useEffect, useMemo, useRef, useState } from 'react';

export interface RowSelection {
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
  setAll: (ids: readonly string[], on: boolean) => void;
  /** Membuang id yang sudah selesai diproses (aksi massal bertahap). */
  remove: (ids: readonly string[]) => void;
  clear: () => void;
  count: number;
}

/**
 * Pilihan baris untuk aksi massal. Dikosongkan setiap `resetKey` berubah (mis. filter terserialisasi), agar
 * aksi massal tak mengenai baris yang tidak terlihat.
 */
export function useRowSelection(resetKey: unknown): RowSelection {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const first = useRef(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey sengaja memicu pengosongan
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSelected(new Set());
  }, [resetKey]);

  return useMemo<RowSelection>(
    () => ({
      selected,
      count: selected.size,
      toggle: (id) =>
        setSelected((current) => {
          const next = new Set(current);
          if (!next.delete(id)) next.add(id);
          return next;
        }),
      setAll: (ids, on) =>
        setSelected((current) => {
          const next = new Set(current);
          for (const id of ids) {
            if (on) next.add(id);
            else next.delete(id);
          }
          return next;
        }),
      remove: (ids) =>
        setSelected((current) => {
          const next = new Set(current);
          for (const id of ids) next.delete(id);
          return next;
        }),
      clear: () => setSelected(new Set()),
    }),
    [selected],
  );
}
