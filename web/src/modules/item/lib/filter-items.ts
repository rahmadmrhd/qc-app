import { normalizeKey } from '@shared/items';
import type { ItemSummaryDto } from '@shared/rpc';

export interface ItemFilter {
  q: string;
  status: 'all' | 'active' | 'inactive';
}

/**
 * Cocok bila semua kata kunci muncul di merk/tipe/nama lain (urutan bebas), atau seluruh kata kunci
 * tanpa spasi muncul di teks tanpa spasi ("es24" menemukan "ES 24"). Tidak peka huruf dan tanda baca.
 */
export function filterItems<T extends ItemSummaryDto>(
  items: readonly T[],
  filter: ItemFilter,
): T[] {
  const needle = normalizeKey(filter.q);
  const tokens = needle === '' ? [] : needle.split(' ');
  const compactNeedle = tokens.join('');
  return items.filter((item) => {
    if (filter.status !== 'all' && item.status !== filter.status) return false;
    if (tokens.length === 0) return true;
    const haystack = normalizeKey([item.brand, item.model, ...item.aliases].join(' '));
    const compact = haystack.split(' ').join('');
    return tokens.every((token) => haystack.includes(token)) || compact.includes(compactNeedle);
  });
}
