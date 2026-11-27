import { appError } from '@server/core/errors';
import type { UserContext } from '@server/modules/access/context';
import { buIdsWithLevel } from '@shared/business-units';

export type WhLevel = 'view' | 'edit';

/** BU yang memberi hak `serialwh` (termasuk BU terhapus: BU terhapus tetap memberi hak seperti BU nonaktif). */
export function whBuIds(user: UserContext, level: WhLevel): string[] {
  return buIdsWithLevel(user.businessUnits, 'serialwh', level);
}

/** Seperti `whBuIds` tetapi tanpa BU terhapus: dipakai untuk PILIHAN (item/SO baru), bukan untuk hak. */
export function whLiveBuIds(user: UserContext, level: WhLevel): string[] {
  const deleted = new Set(user.deletedBuIds);
  return whBuIds(user, level).filter((id) => !deleted.has(id));
}

export function canWh(user: UserContext, buId: string, level: WhLevel): boolean {
  return whBuIds(user, level).includes(buId);
}

/** BU di luar hak = `NOT_FOUND` seragam agar keberadaan catatan tidak bocor. */
export function assertWhBu(
  user: UserContext,
  buId: string,
  level: WhLevel,
  message = 'Catatan SO tidak ditemukan',
): void {
  if (!canWh(user, buId, level)) throw appError('NOT_FOUND', message);
}
