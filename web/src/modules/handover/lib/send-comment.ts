import type { AddCommentInput, HandoverDto } from '@shared/contract';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api/api-error';
import { useAddComment } from '../queries';
import { enqueueOutbox, newClientId } from './outbox';

export type SendCommentInput = Omit<AddCommentInput, 'clientId'> & { owner: string };

export interface SendCommentDeps {
  /** Kirim online (di aplikasi: mutasi `useAddComment`, yang juga memasang hasil ke cache). */
  send: (input: AddCommentInput) => Promise<HandoverDto>;
  enqueue?: typeof enqueueOutbox;
  newId?: () => string;
  now?: () => number;
}

/**
 * Mengirim komentar. `clientId` (kunci idempoten) dibuat SEKALI sebelum percobaan pertama dan dipakai ulang bila
 * entri diantrekan: kiriman pertama yang sudah tersimpan di server tetapi putus di jalan (dipetakan `UNAVAILABLE`)
 * tak menggandakan komentar saat dikirim ulang. Hanya `UNAVAILABLE` yang mengantre; galat lain dilempar apa adanya.
 * Antrean penuh/penulisan gagal melempar galat biasa supaya isi tidak dibuang dari komposer.
 */
export async function sendComment(
  input: SendCommentInput,
  deps: SendCommentDeps,
): Promise<{ queued: boolean; dto?: HandoverDto }> {
  const { owner, ...fields } = input;
  const clientId = (deps.newId ?? newClientId)();
  try {
    const dto = await deps.send({ ...fields, clientId });
    return { queued: false, dto };
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'UNAVAILABLE') throw error;
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
    if (result === 'ok') return { queued: true };
    throw new ApiError(
      'INTERNAL',
      result === 'full'
        ? 'Antrean di perangkat penuh. Tunggu komentar sebelumnya terkirim dulu.'
        : 'Komentar belum bisa disimpan di perangkat.',
      '-',
    );
  }
}

/** Pengirim komentar untuk UI: online lewat mutasi, offline diantrekan dengan toast info (id tetap, tak menumpuk). */
export function useSendComment(owner: string) {
  const addComment = useAddComment();
  const send = addComment.mutateAsync;
  return async (input: Omit<SendCommentInput, 'owner'>): Promise<void> => {
    const result = await sendComment({ ...input, owner }, { send });
    if (result.queued) {
      toast.info('Komentar disimpan di perangkat dan dikirim saat tersambung.', {
        id: 'comment-outbox-queued',
      });
    }
  };
}
