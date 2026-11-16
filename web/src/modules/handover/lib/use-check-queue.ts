import type { HandoverDto } from '@shared/contract';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { requestOutboxFlush } from '@/app/outbox-sync';
import { beginBusy } from '@/app/pwa/busy';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { markStale } from '@/lib/query-cache';
import { accessKeys } from '@/modules/access/queries';
import { applySavedHandover, handoverKeys } from '../queries';
import { findCachedHandover, patchHandoverInBoards } from './board-cache';
import { enqueueCheck, hasEntriesForTask } from './check-outbox';
import { applyOptimisticCheck } from './optimistic-check';
import { beginSending } from './outbox-status';

interface TaskQueue {
  /** Rantai serial: satu permintaan terbang per task. */
  chain: Promise<void>;
  /** Permintaan yang belum selesai (terbang + antre). */
  pending: number;
  /** Respons server terakhir yang berhasil (dipasang ke cache hanya saat antrean kosong). */
  latest: HandoverDto | null;
  /** Ada permintaan yang gagal pada rentetan klik ini: muat ulang task saat antrean kosong. */
  failed: boolean;
  /** Menandai "ada penulisan berjalan" selama antrean belum kosong (muat ulang otomatis PWA tidak boleh memotongnya). */
  endBusy?: () => void;
}

export interface CheckTarget {
  id: string;
  locationId: string;
}

type Patch = (dto: HandoverDto) => HandoverDto;

/** Toast info dengan id tetap: rentetan klik offline tidak menumpuk banyak toast. */
function notifyQueued(offline: boolean): void {
  toast.info(
    offline
      ? 'Tidak ada koneksi. Centang disimpan di perangkat dan dikirim saat tersambung.'
      : 'Centang disimpan dan dikirim berurutan.',
    { id: 'check-outbox-queued' },
  );
}

/** Mengubah task `id` di setiap papan dan cache detail, di tempat (urutan daftar tidak berubah). */
function patchCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string,
  patch: Patch,
): void {
  patchHandoverInBoards(queryClient, id, patch);
  queryClient.setQueriesData<HandoverDto>({ queryKey: ['handovers', 'one', id] }, (one) =>
    one ? patch(one) : one,
  );
}

/**
 * Centang instan (update optimistis) dengan antrean serial per task:
 *  - klik langsung mengubah cache (hanya butir itu); tiap klik tetap satu permintaan `handovers.setCheck`;
 *  - permintaan task yang sama dikirim berurutan (satu terbang), task berbeda boleh paralel; teks butir yang
 *    dikirim diambil dari DTO terbaru di cache;
 *  - respons server menimpa cache HANYA setelah antrean task itu kosong (tanpa kedipan/rollback palsu);
 *  - bila gagal: butir itu dikembalikan, toast galat, antrean berikutnya lanjut, task dimuat ulang di akhir;
 *  - server tidak terjangkau (`UNAVAILABLE`): centang masuk antrean di perangkat (`check-outbox`) dan tampilan
 *    dipertahankan; task yang masih punya entri antrean selalu mengantre (urutan per task terjaga). Antrean itu
 *    dikirim ulang oleh penyinkron foreground (`app/outbox-sync`).
 */
export function useCheckQueue(by: string) {
  const queryClient = useQueryClient();
  const queues = useRef(new Map<string, TaskQueue>());
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());

  const setSavingFor = useCallback((id: string, on: boolean) => {
    setSaving((current) => {
      if (current.has(id) === on) return current;
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggle = useCallback(
    (task: CheckTarget, item: { index: number; text: string }, checked: boolean) => {
      let queue = queues.current.get(task.id);
      if (!queue) {
        queue = { chain: Promise.resolve(), pending: 0, latest: null, failed: false };
        queues.current.set(task.id, queue);
      }
      const q = queue;
      if (q.pending === 0) q.endBusy = beginBusy();
      q.pending++;
      setSavingFor(task.id, true);
      patchCaches(queryClient, task.id, (dto) =>
        applyOptimisticCheck(dto, item.index, checked, by, new Date().toISOString()),
      );

      const send = async () => {
        try {
          // Teks dari DTO terbaru (catatan bisa berubah oleh respons/refetch sebelumnya).
          const text =
            findCachedHandover(queryClient, task.id)?.checklist.find(
              (entry) => entry.index === item.index,
            )?.text ?? item.text;
          const queueIt = async (): Promise<boolean> =>
            (await enqueueCheck(by, {
              taskId: task.id,
              locationId: task.locationId,
              index: item.index,
              text,
              checked,
              at: Date.now(),
            })) === 'ok';
          // Diperiksa SAAT kirim (bukan saat klik): task yang masih punya entri antrean tidak boleh didahului
          // klik langsung, agar urutan per task terjaga.
          if (hasEntriesForTask(by, task.id)) {
            if (await queueIt()) {
              // Antre karena task masih punya entri: teks koneksi hanya bila peramban memang offline.
              notifyQueued(typeof navigator !== 'undefined' && navigator.onLine === false);
              requestOutboxFlush();
              return;
            }
            throw new ApiError('INTERNAL', 'Centang tidak dapat disimpan di perangkat', '-');
          }
          // Penanda "Mengirim…" hanya selama permintaan berjalan. `end()` di `finally` luar: pada jalur UNAVAILABLE
          // entri sudah ditulis `queueIt()` (di `catch` dalam) SEBELUM penanda dibersihkan, jadi tampilan langsung
          // berganti ke "Belum terkirim" tanpa kedipan.
          const end = beginSending(task.id, item.index);
          try {
            try {
              q.latest = await api('handovers.setCheck', {
                id: task.id,
                locationId: task.locationId,
                index: item.index,
                text,
                checked,
              });
              // Server terbukti sehat: antrean lain (task berbeda) yang tertunda boleh dikuras (no-op bila kosong).
              requestOutboxFlush();
            } catch (error) {
              // Server tidak terjangkau: simpan di perangkat dan pertahankan tampilan. Antrean penuh/penyimpanan
              // diblokir = perilaku lama (balik + galat biasa).
              if (error instanceof ApiError && error.code === 'UNAVAILABLE' && (await queueIt())) {
                notifyQueued(true);
                return;
              }
              throw error;
            }
          } finally {
            end();
          }
        } catch (error) {
          q.failed = true;
          // Kembalikan hanya butir ini; yang lain tetap.
          patchCaches(queryClient, task.id, (dto) =>
            applyOptimisticCheck(dto, item.index, !checked, '', ''),
          );
          toast.error(describeError(error));
          if (error instanceof ApiError && error.code === 'CONFLICT') {
            void queryClient.invalidateQueries({ queryKey: handoverKeys.all });
          }
        } finally {
          q.pending--;
          if (q.pending === 0) {
            q.endBusy?.();
            setSavingFor(task.id, false);
            if (q.failed) {
              void queryClient.invalidateQueries({ queryKey: handoverKeys.all });
            } else if (q.latest) {
              applySavedHandover(queryClient, q.latest);
            }
            markStale(queryClient, accessKeys.audit);
            queues.current.delete(task.id);
          }
        }
      };
      q.chain = q.chain.then(send);
    },
    [by, queryClient, setSavingFor],
  );

  /** Menunggu antrean centang task `id` kosong (mis. sebelum Mark done/Batalkan/Buka kembali). */
  const whenIdle = useCallback(
    (id: string): Promise<void> => queues.current.get(id)?.chain ?? Promise.resolve(),
    [],
  );

  return { toggle, whenIdle, isSaving: (id: string) => saving.has(id) };
}
