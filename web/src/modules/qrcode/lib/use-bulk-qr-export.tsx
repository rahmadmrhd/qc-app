import type { QrDesignDto } from '@shared/contract';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { beginBusy } from '@/app/pwa/busy';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { refreshQrDesign, useExportQrDesign } from '../queries';
import { classifyForExport } from './bulk-export-plan';
import { isStaleExportError } from './export-error';
import { prepareExportFiles } from './prepare-export';

/** Maks. konfigurasi yang diekspor dalam satu putaran (keputusan pemilik 2026-11-22, spek revisi lanjutan 2 R7). */
export const BULK_EXPORT_MAX = 50;

export type BulkRowStatus =
  | 'waiting'
  | 'rendering'
  | 'sending'
  | 'processing'
  | 'done'
  | 'failed'
  | 'skipped';

export interface BulkExportRow {
  id: string;
  name: string;
  status: BulkRowStatus;
  /** Langkah yang sedang berjalan, alasan dilewati, atau pesan galat. */
  message: string;
  /** Kemajuan job server (0-100) saat `processing`. */
  progress?: number;
}

/** Mengapa putaran berhenti sebelum semua selesai; `null` = berjalan sampai akhir. */
export type BulkStop = 'unavailable' | 'cancelled' | null;

export interface BulkExportOutcome {
  doneIds: string[];
  failedIds: string[];
  skippedIds: string[];
  /** Belum dikerjakan karena putaran berhenti. */
  waitingIds: string[];
  stopped: BulkStop;
}

export type BulkExportPhase = 'idle' | 'running' | 'finished';

export interface BulkQrExport {
  phase: BulkExportPhase;
  running: boolean;
  rows: readonly BulkExportRow[];
  outcome: BulkExportOutcome | null;
  /** Permintaan berhenti sudah diberikan; item yang sedang berjalan diselesaikan dulu. */
  cancelling: boolean;
  /**
   * Menjalankan ekspor berurutan satu per satu. `reason` = alasan perubahan label bersama, dipakai hanya untuk
   * konfigurasi yang melahirkan versi Manual Book baru. Mengembalikan `null` bila tidak dimulai (sedang berjalan atau
   * lebih dari `BULK_EXPORT_MAX` yang dapat diekspor).
   */
  start: (designs: readonly QrDesignDto[], reason: string) => Promise<BulkExportOutcome | null>;
  /** Berhenti SETELAH item yang sedang berjalan selesai (job server tidak dapat dibatalkan di tengah). */
  cancel: () => void;
  /** Kembali ke `idle` (menutup ringkasan). Tak berefek selagi berjalan. */
  reset: () => void;
}

type ItemResult =
  | { status: 'done' }
  | { status: 'skipped'; message: string }
  | { status: 'failed'; message: string }
  | { status: 'unavailable'; message: string };

const nameOf = (design: QrDesignDto) => (design.name !== '' ? design.name : design.title);
const isUnavailable = (error: unknown) => error instanceof ApiError && error.code === 'UNAVAILABLE';

/**
 * Ekspor massal konfigurasi QR (spek revisi lanjutan 2, R7). Render PDF/PNG/gambar contoh hanya ada di peramban dan
 * server menerima satu konfigurasi per permintaan, jadi putaran dikendalikan klien: satu konfigurasi pada satu waktu
 * (memuat ulang konfigurasi, render, kirim, tunggu job). Lanjut ke berikutnya walau satu gagal (dilaporkan per baris);
 * galat `UNAVAILABLE` menghentikan seluruh putaran (sisanya tetap menunggu); galat basi (412/422 alasan) mengulang
 * sekali setelah memuat ulang. Putaran dibungkus `beginBusy` (pembaruan UI otomatis tak memuat ulang di sela item) dan
 * `useUnsavedChanges` (peringatan menutup tab).
 */
export function useBulkQrExport(): BulkQrExport {
  const queryClient = useQueryClient();
  const exportMutation = useExportQrDesign();
  const [phase, setPhase] = useState<BulkExportPhase>('idle');
  const [rows, setRows] = useState<BulkExportRow[]>([]);
  const [outcome, setOutcome] = useState<BulkExportOutcome | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const runningRef = useRef(false);
  const cancelRef = useRef(false);
  const mutateRef = useRef(exportMutation.mutateAsync);
  mutateRef.current = exportMutation.mutateAsync;

  useUnsavedChanges(phase === 'running');
  // Pindah halaman selagi berjalan memberi sinyal batal yang sama (item berjalan tetap selesai di server).
  useEffect(() => {
    cancelRef.current = false;
    return () => {
      cancelRef.current = true;
    };
  }, []);

  function patchRow(id: string, patch: Partial<BulkExportRow>) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  async function exportOne(design: QrDesignDto, reason: string): Promise<ItemResult> {
    const id = design.id;
    try {
      // DTO daftar dapat basi (sampai 30 dtk): muat ulang dulu, lalu klasifikasi ulang dengan isi terbaru.
      patchRow(id, { status: 'rendering', message: 'Memuat konfigurasi terbaru…' });
      let current = await refreshQrDesign(queryClient, id);
      for (let attempt = 0; ; attempt++) {
        const plan = classifyForExport(current);
        if (plan.kind === 'skip') return { status: 'skipped', message: plan.skipReason ?? '' };
        if (plan.kind === 'export-new-version' && reason === '') {
          return {
            status: 'failed',
            message: 'Label berubah sejak dipilih dan butuh alasan perubahan. Ekspor ulang.',
          };
        }
        patchRow(id, { status: 'rendering', message: 'Menyiapkan berkas…' });
        const files = await prepareExportFiles(queryClient, current, (step) =>
          patchRow(id, { status: 'rendering', message: step }),
        );
        patchRow(id, { status: 'sending', message: 'Mengirim PDF dan PNG ke server…' });
        try {
          await mutateRef.current({
            id,
            expectedUpdatedAt: current.updatedAt,
            pdf: files.pdf,
            png: files.png,
            preview: files.preview,
            // Alasan hanya untuk yang melahirkan versi baru (server mengabaikannya pada hash sama).
            reason: plan.kind === 'export-new-version' ? reason : '',
            onProgress: (job) =>
              patchRow(id, {
                status: 'processing',
                message: `Server memproses ekspor ke Drive (${job.progress}%)…`,
                progress: job.progress,
              }),
          });
          return { status: 'done' };
        } catch (error) {
          // Basi (versi usang, atau label berubah sehingga alasan kini wajib): muat ulang dan coba SEKALI lagi.
          if (attempt === 0 && isStaleExportError(error)) {
            current = await refreshQrDesign(queryClient, id);
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      const message = describeError(error);
      return isUnavailable(error)
        ? { status: 'unavailable', message }
        : { status: 'failed', message };
    }
  }

  async function start(designs: readonly QrDesignDto[], reason: string) {
    if (runningRef.current) return null;
    const exportable = designs.filter((design) => classifyForExport(design).kind !== 'skip');
    if (exportable.length > BULK_EXPORT_MAX) return null;
    const trimmed = reason.trim();
    runningRef.current = true;
    cancelRef.current = false;
    setCancelling(false);
    setOutcome(null);
    setPhase('running');
    setRows(
      designs.map((design): BulkExportRow => {
        const plan = classifyForExport(design);
        return plan.kind === 'skip'
          ? {
              id: design.id,
              name: nameOf(design),
              status: 'skipped',
              message: plan.skipReason ?? '',
            }
          : { id: design.id, name: nameOf(design), status: 'waiting', message: 'Menunggu' };
      }),
    );
    const end = beginBusy();
    const result: BulkExportOutcome = {
      doneIds: [],
      failedIds: [],
      skippedIds: designs
        .filter((design) => classifyForExport(design).kind === 'skip')
        .map((design) => design.id),
      waitingIds: [],
      stopped: null,
    };
    try {
      for (const [index, design] of exportable.entries()) {
        if (cancelRef.current) {
          result.stopped = 'cancelled';
          result.waitingIds = exportable.slice(index).map((item) => item.id);
          break;
        }
        const item = await exportOne(design, trimmed);
        if (item.status === 'done') {
          result.doneIds.push(design.id);
          patchRow(design.id, { status: 'done', message: 'Selesai', progress: 100 });
        } else if (item.status === 'skipped') {
          result.skippedIds.push(design.id);
          patchRow(design.id, { status: 'skipped', message: item.message });
        } else {
          result.failedIds.push(design.id);
          patchRow(design.id, { status: 'failed', message: item.message });
          if (item.status === 'unavailable') {
            // Server tak terjangkau: berhenti, jangan menghantam terus. Sisanya tetap menunggu.
            result.stopped = 'unavailable';
            result.waitingIds = exportable.slice(index + 1).map((rest) => rest.id);
            break;
          }
        }
      }
    } finally {
      end();
      runningRef.current = false;
    }
    for (const id of result.waitingIds) patchRow(id, { message: 'Belum dikerjakan' });
    setOutcome(result);
    setPhase('finished');
    return result;
  }

  return {
    phase,
    running: phase === 'running',
    rows,
    outcome,
    cancelling,
    start,
    cancel: () => {
      if (!runningRef.current) return;
      cancelRef.current = true;
      setCancelling(true);
    },
    reset: () => {
      if (runningRef.current) return;
      setPhase('idle');
      setRows([]);
      setOutcome(null);
      setCancelling(false);
    },
  };
}
