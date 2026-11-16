import type { HandoverDto, SaveHandoverBatchInput } from '@shared/contract';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api/api-error';
import { useSaveHandoverBatch } from '../queries';
import { enqueueOutbox, newClientId } from './outbox';

export type SendCreateInput = SaveHandoverBatchInput & { owner: string };

export interface SendCreateDeps {
  /** Kirim online (di aplikasi: mutasi `useSaveHandoverBatch`, yang juga memasang hasil ke cache). */
  send: (input: SaveHandoverBatchInput) => Promise<HandoverDto[]>;
  enqueue?: typeof enqueueOutbox;
  newId?: () => string;
  now?: () => number;
}

/**
 * Menyimpan task baru (satu permintaan `handovers.saveBatch`, maks. 30 task). `clientId` per task dibuat SEKALI sebelum
 * percobaan pertama dan dipakai ulang bila entri diantrekan: kiriman pertama yang sudah tersimpan di server tetapi
 * putus di jalan (dipetakan `UNAVAILABLE`) tak menggandakan task saat dikirim ulang. Hanya `UNAVAILABLE` yang mengantre;
 * galat lain dilempar apa adanya. Antrean penuh/penulisan gagal melempar galat biasa supaya formulir tidak dikosongkan.
 */
export async function sendCreate(
  input: SendCreateInput,
  deps: SendCreateDeps,
): Promise<{ queued: boolean; dtos?: HandoverDto[] }> {
  const { owner, locationId } = input;
  const newId = deps.newId ?? newClientId;
  const tasks = input.tasks.map((task) => ({
    customerName: task.customerName,
    note: task.note,
    clientId: task.clientId ?? newId(),
  }));
  try {
    const dtos = await deps.send({ locationId, tasks });
    return { queued: false, dtos };
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'UNAVAILABLE') throw error;
    const result = await (deps.enqueue ?? enqueueOutbox)(owner, {
      kind: 'create',
      locationId,
      tasks,
      at: (deps.now ?? Date.now)(),
    });
    if (result === 'ok') return { queued: true };
    throw new ApiError(
      'INTERNAL',
      result === 'full'
        ? 'Antrean di perangkat penuh. Tunggu task sebelumnya terkirim dulu.'
        : 'Task belum bisa disimpan di perangkat.',
      '-',
    );
  }
}

/** Pengirim task baru untuk UI: online lewat mutasi, offline diantrekan dengan toast info. */
export function useSendCreate(owner: string) {
  const saveBatch = useSaveHandoverBatch();
  const send = saveBatch.mutateAsync;
  return (input: SaveHandoverBatchInput) => sendCreate({ ...input, owner }, { send });
}

export function notifyCreateQueued(count: number): void {
  toast.info(
    count === 1
      ? 'Task disimpan di perangkat dan dikirim saat tersambung.'
      : `${count} task disimpan di perangkat dan dikirim saat tersambung.`,
    { id: 'create-outbox-queued' },
  );
}
