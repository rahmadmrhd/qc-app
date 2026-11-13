import { appError } from '@server/core/errors';
import { readObject } from '@server/core/validate';
import type { ListNotificationsInput, MarkNotificationReadInput } from '@shared/contract';

/** Bawaan dan maksimum jumlah notifikasi per halaman lonceng. */
export const NOTIFICATION_PAGE_DEFAULT = 30;
export const NOTIFICATION_PAGE_MAX = 100;

const MAX_ID_LENGTH = 100;
/** `createdAt|id`: ISO 30 karakter + pemisah + id. */
const MAX_CURSOR_LENGTH = 200;

/** `limit` di atas maksimum dibatasi (bukan galat); nol atau negatif ditolak. */
export function validateListNotifications(raw: unknown): ListNotificationsInput {
  const reader = readObject(raw ?? {});
  const limit = reader.raw('limit');
  const before = reader.raw('before');
  let limitValue: number | undefined;
  if (limit !== undefined && limit !== null) {
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) {
      reader.fail('limit', 'Batas halaman harus bilangan bulat positif');
    } else {
      limitValue = Math.min(limit, NOTIFICATION_PAGE_MAX);
    }
  }
  let beforeValue: string | undefined;
  if (before !== undefined && before !== null && before !== '') {
    if (typeof before !== 'string' || before.length > MAX_CURSOR_LENGTH) {
      reader.fail('before', 'Kursor tidak valid');
    } else {
      beforeValue = before;
    }
  }
  reader.done();
  return {
    ...(limitValue !== undefined ? { limit: limitValue } : {}),
    ...(beforeValue !== undefined ? { before: beforeValue } : {}),
  };
}

export function validateMarkNotificationRead(raw: unknown): MarkNotificationReadInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: MAX_ID_LENGTH });
  reader.done();
  return { id };
}

/** Rute tanpa masukan bermakna (POST tanpa badan): boleh kosong, `null`, atau objek kosong. */
export function validateEmptyInput(raw: unknown): Record<string, never> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 0) return {};
  throw appError('VALIDATION', 'Method ini tidak menerima input');
}
