import { appError } from '@server/core/errors';
import type { UserContext } from '@server/modules/access/context';
import { buIdsWithLevel, canActOnAllBus } from '@shared/business-units';
import type { Level } from '@shared/permissions';
import type { BusinessUnitBrief } from './repo';

/**
 * BU yang boleh dilihat user untuk item (level `item` >= `view` pada BU itu). Himpunan kosong = tidak melihat item
 * apa pun (user tanpa penugasan BU, atau penugasannya basi). Dipakai jalur baca item, berkas item, dan aturan tulis.
 */
export function visibleBuIds(user: UserContext): string[] {
  return buIdsWithLevel(user.businessUnits, 'item', 'view');
}

/**
 * Item hanya ada bagi user yang melihat salah satu BU-nya; selain itu `NOT_FOUND` (bukan `FORBIDDEN`, agar
 * keberadaan item di BU lain tidak bocor).
 */
export function assertItemVisible(user: UserContext, itemBuIds: readonly string[]): void {
  const visible = new Set(visibleBuIds(user));
  if (!itemBuIds.some((id) => visible.has(id))) throw appError('NOT_FOUND', 'Item tidak ditemukan');
}

/** Mengubah/menonaktifkan item multi-BU butuh `level` pada SEMUA BU item itu (keputusan pemilik 2026-11-08). */
export function assertCanActOnItem(
  user: UserContext,
  itemBuIds: readonly string[],
  level: Level,
  message: string,
): void {
  if (!canActOnAllBus(user.businessUnits, 'item', level, itemBuIds, user.deletedBuIds)) {
    throw appError('FORBIDDEN', message);
  }
}

/**
 * Himpunan BU yang diminta untuk item yang disimpan. `current` = BU item saat ini (`null` = item baru).
 * - Item baru: sistem harus punya minimal satu BU aktif ("buat BU dulu" bila belum).
 * - BU yang DITAMBAH (tidak ada di `current`) harus ada dan aktif (`VALIDATION`) dan user harus berhak `edit`
 *   (`FORBIDDEN`). BU lama boleh dipertahankan (termasuk nonaktif) atau dilepas.
 */
export function assertRequestedBusinessUnits(
  user: UserContext,
  all: readonly BusinessUnitBrief[],
  current: readonly string[] | null,
  requested: readonly string[],
): void {
  if (current === null && !all.some((bu) => bu.status === 'active')) {
    throw appError('VALIDATION', 'Belum ada BU aktif; buat BU dulu', {
      businessUnitIds: 'Belum ada BU aktif; buat BU dulu',
    });
  }
  const known = new Map(all.map((bu) => [bu.id, bu]));
  const added = requested.filter((id) => !(current ?? []).includes(id));
  for (const id of added) {
    const bu = known.get(id);
    if (bu?.status !== 'active') {
      throw appError('VALIDATION', 'BU tidak dikenal atau tidak aktif', {
        businessUnitIds: 'BU tidak dikenal atau tidak aktif',
      });
    }
  }
  if (added.length > 0 && !canActOnAllBus(user.businessUnits, 'item', 'edit', added)) {
    throw appError('FORBIDDEN', 'Anda tidak berhak menambah item ke BU ini');
  }
}
