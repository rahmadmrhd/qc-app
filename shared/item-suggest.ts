// Saran nama Item saat mengetik baris checklist (Keluar Gudang 5.15). Murni.

import { compactKey, type DetectableItem, itemDisplayName } from './item-detect';

export const ITEM_SUGGEST = { minChars: 3, maxWords: 3, limit: 6 } as const;

export interface ItemSuggestRange {
  /** Indeks di teks sebelum kursor. */
  start: number;
  end: number;
  query: string;
}

/**
 * Kandidat rentang: 3, 2, lalu 1 kata terakhir (urutan itu); rentang yang bentuk rapatnya kurang dari
 * `minChars` dibuang. Kursor tepat setelah spasi = pengetikan kata sudah selesai, jadi tidak ada saran.
 */
export function itemSuggestRanges(textBeforeCursor: string): ItemSuggestRange[] {
  if (textBeforeCursor === '' || /\s$/.test(textBeforeCursor)) return [];
  const starts: number[] = [];
  const re = /\S+/g;
  for (let m = re.exec(textBeforeCursor); m !== null; m = re.exec(textBeforeCursor)) {
    starts.push(m.index);
  }
  const ranges: ItemSuggestRange[] = [];
  for (let words = Math.min(ITEM_SUGGEST.maxWords, starts.length); words >= 1; words--) {
    const start = starts[starts.length - words] as number;
    const query = textBeforeCursor.slice(start);
    if (compactKey(query).length < ITEM_SUGGEST.minChars) continue;
    ranges.push({ start, end: textBeforeCursor.length, query });
  }
  return ranges;
}

/** Rentang terpanjang yang punya >= 1 kecocokan (nama tampilan atau tipe) menang. */
export function suggestItemsFor<T extends DetectableItem>(
  items: readonly T[],
  textBeforeCursor: string,
  limit: number = ITEM_SUGGEST.limit,
): { range: ItemSuggestRange; items: T[] } | null {
  const prepared = items.map((item) => ({
    item,
    name: compactKey(itemDisplayName(item)),
    model: compactKey(item.model),
    label: itemDisplayName(item),
  }));
  for (const range of itemSuggestRanges(textBeforeCursor)) {
    const needle = compactKey(range.query);
    const hits = prepared.filter((p) => p.name.includes(needle) || p.model.includes(needle));
    if (hits.length === 0) continue;
    hits.sort((a, b) => {
      const aStarts = a.name.startsWith(needle) || a.model.startsWith(needle) ? 0 : 1;
      const bStarts = b.name.startsWith(needle) || b.model.startsWith(needle) ? 0 : 1;
      return aStarts - bStarts || a.label.localeCompare(b.label);
    });
    return { range, items: hits.slice(0, limit).map((h) => h.item) };
  }
  return null;
}
