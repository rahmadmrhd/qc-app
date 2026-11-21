import { readObject } from '@server/core/validate';
import { PAGE_MAX_LIMIT, parseAuditCursor } from '@server/modules/access/validate';
import { ACTIVITY_KINDS } from '@shared/audit';
import type { ListActivityInput } from '@shared/contract';

/** Panjang maksimum id record (sama dengan modul lain). */
const MAX_ID_LENGTH = 100;

/** Halaman bawaan panel aktivitas (10 terbaru); maksimum = `PAGE_MAX_LIMIT` (50). */
export const ACTIVITY_DEFAULT_LIMIT = 10;

/**
 * `kind` harus salah satu `ACTIVITY_KINDS` (Serial dan jenis tak dikenal = `VALIDATION`), `id` wajib, `cursor` =
 * kursor audit (`<ts>~<id>`), `limit` 1..50 (bawaan di servis).
 */
export function validateListActivity(raw: unknown): ListActivityInput {
  const reader = readObject(raw);
  const kind = reader.oneOf('kind', ACTIVITY_KINDS);
  const id = reader.str('id', { required: true, max: MAX_ID_LENGTH });
  const cursor = reader.raw('cursor');
  if (
    cursor !== undefined &&
    cursor !== null &&
    (typeof cursor !== 'string' || !parseAuditCursor(cursor))
  ) {
    reader.fail('cursor', 'Kursor tidak valid');
  }
  const limit = reader.raw('limit');
  if (
    limit !== undefined &&
    limit !== null &&
    (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > PAGE_MAX_LIMIT)
  ) {
    reader.fail('limit', `Batas halaman harus 1-${PAGE_MAX_LIMIT}`);
  }
  reader.done();
  return {
    kind,
    id,
    ...(typeof cursor === 'string' ? { cursor } : {}),
    ...(typeof limit === 'number' ? { limit } : {}),
  };
}
