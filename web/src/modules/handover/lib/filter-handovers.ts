import type { HandoverStatus } from '@shared/handover';
import { normalizeKey } from '@shared/items';
import type { HandoverSummaryDto } from '@shared/rpc';

export interface HandoverFilter {
  q: string;
  /** `active` = Baru + Dikerjakan. */
  status: 'all' | 'active' | HandoverStatus;
}

/** Cocok bila semua kata kunci muncul di nomor, customer, atau catatan (urutan bebas, tanpa tanda baca/huruf). */
export function filterHandovers<T extends HandoverSummaryDto>(
  handovers: readonly T[],
  filter: HandoverFilter,
): T[] {
  const tokens = normalizeKey(filter.q)
    .split(' ')
    .filter((token) => token !== '');
  return handovers.filter((handover) => {
    if (filter.status === 'active') {
      if (handover.status !== 'new' && handover.status !== 'in_progress') return false;
    } else if (filter.status !== 'all' && handover.status !== filter.status) {
      return false;
    }
    if (tokens.length === 0) return true;
    const haystack = normalizeKey(`${handover.number} ${handover.customerName} ${handover.note}`);
    return tokens.every((token) => haystack.includes(token));
  });
}
