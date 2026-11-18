// Unggah antrean pending ke server (spek desktop §6.6, Fase 5): dipicu pengguna, butuh login, idempoten lewat
// `clientId` per baris. Baris yang berhasil dihapus dari antrean; duplikat dan gagal tetap ada beserta alasannya.
// Pemanggilan API lewat parameter `save` (bawaan `serials.saveBatch`) supaya tes tak perlu menyentuh jaringan.

import type { QcBridge } from '@countrylock/bridge-contract';
import type { PendingEntry } from '@countrylock/pending';
import type { SaveSerialBatchInput, SaveSerialBatchOutput } from '@shared/contract';
import { useCallback, useRef, useState } from 'react';
import { api, describeError } from '@/lib/api';
import {
  chunkRows,
  isUploadable,
  outcomesBySerial,
  summarize,
  toSerialRow,
  type UploadOutcome,
  type UploadSummary,
} from './lib/upload';

export type SaveBatch = (input: SaveSerialBatchInput) => Promise<SaveSerialBatchOutput>;

const defaultSave: SaveBatch = (input) => api('serials.saveBatch', input);

export interface UseUploadPending {
  uploading: boolean;
  /** Hasil terakhir per serial (kunci = serial di antrean); dikosongkan tiap unggah baru. */
  outcomes: ReadonlyMap<string, UploadOutcome>;
  summary: UploadSummary | null;
  /** Jumlah entri yang siap diunggah. */
  readyCount: number;
  upload(): void;
}

export function useUploadPending(
  bridge: QcBridge,
  pending: readonly PendingEntry[],
  refreshPending: () => Promise<void>,
  save: SaveBatch = defaultSave,
): UseUploadPending {
  const [uploading, setUploading] = useState(false);
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, UploadOutcome>>(new Map());
  const [summary, setSummary] = useState<UploadSummary | null>(null);
  const busyRef = useRef(false);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const upload = useCallback(() => {
    // Penjaga re-entry sinkron: dua klik cepat tak boleh mengirim dua kali.
    if (busyRef.current) return;
    const ready = pendingRef.current.filter(isUploadable);
    if (ready.length === 0) return;
    busyRef.current = true;
    setUploading(true);
    setSummary(null);
    setOutcomes(new Map());

    void (async () => {
      const collected = new Map<string, UploadOutcome>();
      let stopped: string | null = null;
      try {
        for (const part of chunkRows(ready)) {
          const output = await save({ rows: part.map(toSerialRow) });
          for (const [serial, outcome] of outcomesBySerial(part, output.results)) {
            collected.set(serial, outcome);
          }
        }
      } catch (error) {
        // Sesi berakhir, izin kurang, atau jaringan putus: yang belum terkirim tetap di antrean untuk dicoba lagi.
        stopped = describeError(error);
      }
      // Hanya yang dipastikan tersimpan yang dihapus dari antrean.
      const done = [...collected].filter(
        ([, outcome]) => outcome.state === 'created' || outcome.state === 'rechecked',
      );
      await Promise.all(
        done.map(([serial]) => bridge.pending.remove(serial).catch(() => undefined)),
      );
      await refreshPending();
      setOutcomes(collected);
      setSummary(summarize(collected, stopped));
      setUploading(false);
      busyRef.current = false;
    })();
  }, [bridge, refreshPending, save]);

  return {
    uploading,
    outcomes,
    summary,
    readyCount: pending.filter(isUploadable).length,
    upload,
  };
}
