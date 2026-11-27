import { describe, expect, test } from 'bun:test';
import type { DetectableItem } from './item-detect';
import { ITEM_SUGGEST, itemSuggestRanges, suggestItemsFor } from './item-suggest';

const items: DetectableItem[] = [
  { id: '1', brandName: 'Tenda', model: 'AX300' },
  { id: '2', brandName: 'Tenda', model: 'AX1500' },
  { id: '3', brandName: 'Mercusys', model: 'MR30G' },
];

describe('itemSuggestRanges', () => {
  test('3, 2, lalu 1 kata terakhir; rentang pendek dibuang', () => {
    expect(itemSuggestRanges('beli 2 tenda ax').map((r) => r.query)).toEqual([
      '2 tenda ax',
      'tenda ax',
    ]);
    expect(itemSuggestRanges('tenda').map((r) => r.query)).toEqual(['tenda']);
  });
  test('kurang dari 3 karakter rapat = kosong; setelah spasi = kosong', () => {
    expect(itemSuggestRanges('ab')).toEqual([]);
    expect(itemSuggestRanges('tenda ')).toEqual([]);
  });
  test('start menunjuk awal kata pertama rentang', () => {
    const r = itemSuggestRanges('beli tenda ax');
    expect(r[0]).toEqual({ start: 0, end: 13, query: 'beli tenda ax' });
    expect(r[1]?.start).toBe(5);
  });
});

describe('suggestItemsFor', () => {
  test('tenda ax-3 menyarankan Tenda AX300', () => {
    const r = suggestItemsFor(items, 'tenda ax-3');
    expect(r?.items.map((i) => i.id)).toEqual(['1']);
  });
  test('kurang dari 3 karakter = null', () => {
    expect(suggestItemsFor(items, 'te')).toBeNull();
  });
  test('hanya sampai 3 kata terakhir; rentang terpanjang yang cocok menang', () => {
    const r = suggestItemsFor(items, 'beli 2 tenda ax');
    expect(r?.range.query).toBe('tenda ax');
    expect(r?.range.start).toBe(7);
    expect(r?.items.map((i) => i.id).sort()).toEqual(['1', '2']);
  });
  test('tanda baca diabaikan dan limit berlaku', () => {
    expect(suggestItemsFor(items, 'MR-30G')?.items[0]?.id).toBe('3');
    expect(suggestItemsFor(items, 'tenda', 1)?.items).toHaveLength(1);
    expect(ITEM_SUGGEST.limit).toBe(6);
  });
  test('tak ada kecocokan = null', () => {
    expect(suggestItemsFor(items, 'zzzzz')).toBeNull();
  });
});
