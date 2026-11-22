import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/**
 * Draf filter di dalam chip (R8): kontrol di dalam `FilterChip` menahan perubahan secara lokal dan baru memanggil
 * `onChange` halaman SEKALI saat chip menutup (Esc, klik luar, tombol kembali, seret turun, X). Kontrol yang sama di
 * luar chip tidak berubah perilakunya (tanpa konteks = nilai dan komit apa adanya).
 */
export interface FilterDraftApi {
  /** Mendaftarkan penguras draf; mengembalikan fungsi pelepas (chip dilepas tanpa menutup = draf dibuang, tak bocor). */
  register(flush: () => void): () => void;
}

export const FilterDraftContext = createContext<FilterDraftApi | null>(null);

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * `[nilai yang tampil, ubah]`. Di dalam chip `ubah` hanya menyimpan draf dan `commit` dipanggil saat chip menutup
 * (dilewati bila draf sama dengan nilai terakhir, jadi pilih lalu batal pilih = tanpa komit). Penguras idempoten dan
 * mengosongkan draf SEBELUM memanggil `commit`: `commit` boleh memicu navigasi yang menutup chip lagi lewat
 * `runAfterOverlays` (panggilan kedua mendapati draf kosong).
 */
export function useChipDraft<T>(
  value: T,
  commit: (next: T) => void,
): readonly [T, (next: T) => void] {
  const chip = useContext(FilterDraftContext);
  const [draft, setDraft] = useState<{ v: T } | null>(null);
  const draftRef = useRef<{ v: T } | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const flush = useCallback(() => {
    const pending = draftRef.current;
    if (!pending) return;
    draftRef.current = null;
    setDraft(null);
    if (!sameValue(pending.v, valueRef.current)) commitRef.current(pending.v);
  }, []);

  useEffect(() => chip?.register(flush), [chip, flush]);

  const change = useCallback((next: T) => {
    draftRef.current = { v: next };
    setDraft({ v: next });
  }, []);

  if (!chip) return [value, commit];
  return [draft ? draft.v : value, change];
}
