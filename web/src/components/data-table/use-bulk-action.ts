import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { batchSummary, runChunkedBatch } from '@/lib/run-chunked-batch';
import type { RowSelection } from './use-row-selection';

export interface BulkActionOptions<T> {
  selection: RowSelection;
  /** Mengirim satu tahap (maks. `BATCH_MAX` id) dan mengembalikan hasil server per id. */
  send: (ids: string[]) => Promise<readonly T[]>;
  /** Kata kerja untuk toast sukses: "N item {verb}". */
  verb: string;
  /** Memasang hasil tahap yang berhasil ke cache (mis. `upsertInList`). */
  onResults?: (results: readonly T[]) => void;
  /** Memuat ulang data; dipanggil bila ada tahap gagal atau id hilang (`NOT_FOUND`). */
  reload?: () => void;
}

/**
 * Kontrak pemanggil aksi massal (spek redesain §6.9, keputusan 19): kirim bertahap, pasang hasil tahap yang
 * berhasil, buang id yang selesai dari pilihan, muat ulang bila gagal (id yang hilang di server ikut terpangkas
 * lewat `usePruneSelection`), dan beri toast sukses/sebagian/galat (`UNAVAILABLE` = toast galat "Tidak ada koneksi",
 * aksi massal tidak diantrekan). `busy` mencegah kiriman ganda; teruskan ke `BulkBar`.
 */
export function useBulkAction<T>(options: BulkActionOptions<T>): {
  run: () => Promise<void>;
  busy: boolean;
} {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const latest = useRef(options);
  latest.current = options;

  const run = useCallback(async () => {
    if (running.current) return;
    const { selection, send, verb, onResults, reload } = latest.current;
    const ids = [...selection.selected];
    if (ids.length === 0) return;
    running.current = true;
    setBusy(true);
    try {
      const outcome = await runChunkedBatch(ids, send);
      if (outcome.results.length > 0) onResults?.(outcome.results);
      if (outcome.doneIds.length > 0) selection.remove(outcome.doneIds);
      const summary = batchSummary(outcome, verb);
      if (summary.kind === 'success') toast.success(summary.message);
      else if (summary.kind === 'partial') toast.warning(summary.message);
      else toast.error(summary.message);
      if (outcome.failedIds.length > 0) reload?.();
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);

  return { run, busy };
}
