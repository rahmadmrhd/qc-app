import type { AddCommentInput, HandoverDto } from '@shared/contract';
import { toast } from 'sonner';
import { requestOutboxFlush } from '@/app/outbox-sync';
import { ApiError } from '@/lib/api/api-error';
import { useAddComment } from '../queries';
import { hasEntriesForTask } from './check-outbox';
import {
  enqueueOutbox,
  newClientId,
  OUTBOX_IO_BUDGET_MS,
  type OutboxEntry,
  outboxSynced,
  refreshOutboxFromStore,
} from './outbox';

export type SendCommentInput = Omit<AddCommentInput, 'clientId'> & { owner: string };

/** Hasil kirim. `reason` hanya bila `queued`: `offline` = server tak terjangkau; `ordered` = mengikuti entri antre task itu. */
export interface SendCommentResult {
  queued: boolean;
  dto?: HandoverDto;
  reason?: 'offline' | 'ordered';
}

export interface SendCommentDeps {
  /** Kirim online (di aplikasi: mutasi `useAddComment`, yang juga memasang hasil ke cache). */
  send: (input: AddCommentInput) => Promise<HandoverDto>;
  enqueue?: typeof enqueueOutbox;
  newId?: () => string;
  now?: () => number;
  /** Segarkan antrean pemilik dari toko (`null` = tidak diketahui). Bawaan: `refreshOutboxFromStore` dengan batas waktu. */
  refresh?: (owner: string) => Promise<OutboxEntry[] | null>;
  requestFlush?: () => void;
}

async function refreshWithinBudget(owner: string): Promise<OutboxEntry[] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), OUTBOX_IO_BUDGET_MS);
  });
  try {
    return await Promise.race([refreshOutboxFromStore(owner), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Task ini masih punya entri antre (komentar/centang)? Salinan memori yang belum pernah selaras dengan toko (hidrasi
 * boot gagal atau lewat batas waktu) tak bisa dipercaya, kosong maupun tidak: segarkan dari toko dulu (satu baca, batas
 * 1,5 dtk). Setelah selaras (kasus normal) cukup salinan memori yang dijaga siaran `changed`; celah sempit tersisa bila
 * tab lain baru menulis entri task ini dan siarannya belum diproses (penguras membaca toko tiap iterasi dan memulihkan
 * urutannya). Toko tak terbaca (`null`) = tidak diketahui; komentar tetap dicoba online (idempoten lewat `clientId`).
 */
async function taskHasQueuedEntries(
  owner: string,
  taskId: string,
  refresh: (owner: string) => Promise<OutboxEntry[] | null>,
): Promise<boolean> {
  if (!outboxSynced()) {
    const fresh = await refresh(owner);
    if (fresh === null) return false;
    return fresh.some((entry) => 'taskId' in entry && entry.taskId === taskId);
  }
  return hasEntriesForTask(owner, taskId);
}

/**
 * Mengirim komentar. `clientId` (kunci idempoten) dibuat SEKALI sebelum percobaan pertama dan dipakai ulang bila
 * entri diantrekan: kiriman pertama yang sudah tersimpan di server tetapi putus di jalan (dipetakan `UNAVAILABLE`)
 * tak menggandakan komentar saat dikirim ulang. Hanya `UNAVAILABLE` yang mengantre; galat lain dilempar apa adanya.
 * Antrean penuh/penulisan gagal melempar galat biasa supaya isi tidak dibuang dari komposer. Task yang masih punya entri
 * antre (komentar atau centang) menerima komentar baru LANGSUNG ke antrean, supaya urutan di server terjaga.
 */
export async function sendComment(
  input: SendCommentInput,
  deps: SendCommentDeps,
): Promise<SendCommentResult> {
  const { owner, ...fields } = input;
  const clientId = (deps.newId ?? newClientId)();
  const queueIt = async (reason: 'offline' | 'ordered'): Promise<SendCommentResult> => {
    const result = await (deps.enqueue ?? enqueueOutbox)(owner, {
      kind: 'comment',
      clientId,
      taskId: fields.id,
      locationId: fields.locationId,
      quote: fields.quote,
      before: fields.before,
      after: fields.after,
      body: fields.body,
      at: (deps.now ?? Date.now)(),
    });
    if (result === 'ok') return { queued: true, reason };
    throw new ApiError(
      'INTERNAL',
      result === 'full'
        ? 'Antrean di perangkat penuh. Tunggu komentar sebelumnya terkirim dulu.'
        : 'Komentar belum bisa disimpan di perangkat.',
      '-',
    );
  };
  // Urutan per task: task yang masih punya entri antre tidak boleh didahului kiriman langsung (seperti centang).
  if (await taskHasQueuedEntries(owner, fields.id, deps.refresh ?? refreshWithinBudget)) {
    const queued = await queueIt('ordered');
    (deps.requestFlush ?? requestOutboxFlush)();
    return queued;
  }
  try {
    const dto = await deps.send({ ...fields, clientId });
    return { queued: false, dto };
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'UNAVAILABLE') throw error;
    return queueIt('offline');
  }
}

/** Pengirim komentar untuk UI: online lewat mutasi, offline diantrekan dengan toast info (id tetap, tak menumpuk). */
export function useSendComment(owner: string) {
  const addComment = useAddComment();
  const send = addComment.mutateAsync;
  return async (input: Omit<SendCommentInput, 'owner'>): Promise<void> => {
    const result = await sendComment({ ...input, owner }, { send });
    if (result.queued) {
      toast.info(
        result.reason === 'ordered'
          ? 'Komentar masuk antrean dan dikirim berurutan setelah perubahan sebelumnya.'
          : 'Komentar disimpan di perangkat dan dikirim saat tersambung.',
        { id: 'comment-outbox-queued' },
      );
    }
  };
}
