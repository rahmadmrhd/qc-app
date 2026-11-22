import type { Env } from '@server/core/env';
import { appError } from '@server/core/errors';
import type { UserContext } from '@server/modules/access/context';
import { canManageSerial, canReadSerial } from './access';
import { involvedBuIds } from './bu-history';
import { loadSerialRowAny, type SerialRow } from './repo';

const NOT_FOUND_MESSAGE = 'Serial Number tidak ditemukan';

/**
 * Serial yang boleh DIBACA pengguna, hidup atau terhapus: BU saat ini atau BU di riwayat harus terbaca; serial TERHAPUS
 * hanya terbaca pemegang hak Pulihkan (`serial: manage` pada semua BU riwayat; soft delete §4.2). Selain itu seragam
 * `NOT_FOUND`, tanpa membedakan "tak ada", "di luar hak", dan "terhapus".
 */
export async function loadReadableSerialRow(
  env: Env,
  user: UserContext,
  id: string,
): Promise<SerialRow> {
  const row = await loadSerialRowAny(env.DB, id);
  if (!row) throw appError('NOT_FOUND', NOT_FOUND_MESSAGE);
  if (!(await canReadSerial(env.DB, user, row.id.trim(), row.bu_id.trim()))) {
    throw appError('NOT_FOUND', NOT_FOUND_MESSAGE);
  }
  if (row.deleted_at !== '' && !canManageSerial(user, await involvedBuIds(env.DB, row.id.trim()))) {
    throw appError('NOT_FOUND', NOT_FOUND_MESSAGE);
  }
  return row;
}
