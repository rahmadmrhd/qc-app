import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { batchSummary, runChunkedBatch } from '@/lib/run-chunked-batch';
import type { RowSelection } from './use-row-selection';

export interface BulkActionOptions<T> {
  selection: RowSelection;
  /** Mengirim satu tahap (maks. `BATCH_MAX` id) dan mengembalikan hasil server per id. */
  send: (ids: string[]) => Promise<readonly T[]>;
  /** Kata kerja untuk toast sukses: "N {subject} {verb}". */
  verb: string;
  /** Sebutan yang dihitung pada toast sukses (bawaan "item"; mis. "merk"). */
  subject?: string;
  /** Memasang hasil tahap yang berhasil ke cache (mis. `upsertInList`). */
  onResults?: (results: readonly T[]) => void;
  /** Memuat ulang data; dipanggil bila ada tahap gagal atau id hilang (`NOT_FOUND`). */
  reload?: () => void;
  /**
   * Jalan kembali (mis. aktifkan lagi / pulihkan): toast sukses memuat tombol `undo.label` (bawaan "Urungkan").
   * - `changed(ids)` dipanggil SEBELUM aksi berjalan dengan id terpilih dan mengembalikan id yang benar-benar akan
   *   berubah (mis. yang belum Aktif); hanya itu yang dibalik. Tanpa `changed`, semua id yang berhasil dibalik.
   * - `run(chunk)` membalik satu tahap (maks. `BATCH_MAX` id; dikirim bertahap seperti aksi utamanya) dan
   *   mengembalikan hasil server per id. Gagal = tombol dapat ditekan lagi untuk id yang tersisa; setelah berjalan
   *   `reload` dipanggil agar hasilnya langsung tampak.
   */
  undo?: {
    label?: string;
    changed?: (ids: string[]) => string[];
    run: (ids: string[]) => Promise<readonly unknown[]>;
  };
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
    const { selection, send, verb, subject, onResults, reload, undo } = latest.current;
    const ids = [...selection.selected];
    if (ids.length === 0) return;
    const undoable = undo ? new Set(undo.changed ? undo.changed(ids) : ids) : null;
    running.current = true;
    setBusy(true);
    try {
      const outcome = await runChunkedBatch(ids, send);
      if (outcome.results.length > 0) onResults?.(outcome.results);
      if (outcome.doneIds.length > 0) selection.remove(outcome.doneIds);
      const summary = batchSummary(outcome, verb, subject);
      if (summary.kind === 'success') {
        const undoIds = undoable ? outcome.doneIds.filter((id) => undoable.has(id)) : [];
        if (undo && undoIds.length > 0) {
          let pending = undoIds;
          let undoing = false;
          toast.success(summary.message, {
            action: {
              label: undo.label ?? 'Urungkan',
              onClick: () => {
                if (undoing || pending.length === 0) return;
                undoing = true;
                void runChunkedBatch(pending, undo.run)
                  .then((result) => {
                    pending = result.failedIds;
                    const note = batchSummary(result, 'dikembalikan', subject);
                    if (note.kind === 'success') toast.success(note.message);
                    else if (note.kind === 'partial') toast.warning(note.message);
                    else toast.error(note.message);
                    reload?.();
                  })
                  .finally(() => {
                    undoing = false;
                  });
              },
            },
          });
        } else {
          toast.success(summary.message);
        }
      } else if (summary.kind === 'partial') toast.warning(summary.message);
      else toast.error(summary.message);
      if (outcome.failedIds.length > 0) reload?.();
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);

  return { run, busy };
}
