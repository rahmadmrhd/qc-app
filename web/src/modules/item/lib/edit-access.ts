import type { ItemDto, MeDto } from '@shared/contract';
import { redirect } from '@tanstack/react-router';
import { canEditItem } from '@/modules/auth/permissions';

/**
 * Rute ubah item hanya dijaga `item: edit` global; hak sebenarnya per BU item (keputusan 13). User yang tidak berhak
 * mengubah item ini dialihkan ke detail alih-alih melihat form yang akan ditolak server (FORBIDDEN).
 */
export function assertCanEditItem(me: MeDto, item: Pick<ItemDto, 'id' | 'businessUnits'>): void {
  if (!canEditItem(me, item)) {
    throw redirect({ to: '/item/$itemId', params: { itemId: item.id } });
  }
}
