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
 * Pilihan baris untuk aksi massal. Dikosongkan setiap `resetKey` berubah, agar aksi massal tak mengenai baris yang
 * tidak terlihat. `resetKey` WAJIB string stabil (mis. `JSON.stringify(filter)`); objek literal berubah referensi
 * di tiap render dan akan mengosongkan pilihan terus-menerus.
 */
export function useRowSelection(resetKey: string): RowSelection {
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

/**
 * Memangkas pilihan ke baris yang sedang dimuat: id yang hilang dari `ids` (dihapus/dinonaktifkan orang lain,
 * refetch) dibuang dari pilihan, jadi hitungan bar massal dan id yang dikirim selalu sama dengan yang terlihat.
 * Dipakai `DataTable` dan `GridView`; `enabled` false selama data belum ada (memuat).
 */
export function usePruneSelection(
  selection: RowSelection | undefined,
  ids: readonly string[],
  enabled = true,
): void {
  const key = ids.join('\u0000');
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` mewakili `ids`; `selection.selected` memicu ulang
  useEffect(() => {
    if (!selection || !enabled) return;
    const present = new Set(ids);
    const gone = [...selection.selected].filter((id) => !present.has(id));
    if (gone.length > 0) selection.remove(gone);
  }, [key, enabled, selection?.selected]);
}
