import { describe, expect, test } from 'bun:test';
import {
  compactKey,
  countBoundedMatches,
  type DetectableItem,
  detectItemsInNote,
  itemDisplayName,
  noteMentionsItem,
} from './item-detect';

const tenda: DetectableItem = { id: 'i1', brandName: 'Tenda', model: 'AX-300' };
const mercusys: DetectableItem = { id: 'i2', brandName: 'Mercusys', model: 'MR30G' };

describe('detectItemsInNote', () => {
  test('ejaan berbeda terdeteksi sama', () => {
    for (const text of ['Tenda AX-300', 'tenda ax 300', 'TENDA_AX300']) {
      const r = detectItemsInNote(`- [ ] ${text} 2 pcs`, [tenda]);
      expect(r.map((d) => d.itemId)).toEqual(['i1']);
    }
  });
  test('berbatas kata: AX300 tidak cocok di AX3000 atau MAX300', () => {
    const solo: DetectableItem = { id: 'x', brandName: '', model: 'AX300' };
    expect(detectItemsInNote('AX3000', [solo])).toEqual([]);
    expect(detectItemsInNote('MAX300', [solo])).toEqual([]);
    expect(detectItemsInNote('beli ax300 dua', [solo])).toHaveLength(1);
  });
  test('varian tipe saja dipakai bila unik', () => {
    const r = detectItemsInNote('AX-300 dua unit', [tenda, mercusys]);
    expect(r).toEqual([{ itemId: 'i1', lines: 1, by: 'model', ambiguous: false }]);
  });
  test('varian tipe tidak dipakai bila dua Item bertipe sama', () => {
    const lain: DetectableItem = { id: 'i3', brandName: 'Totolink', model: 'AX-300' };
    expect(detectItemsInNote('AX-300 dua unit', [tenda, lain])).toEqual([]);
    expect(detectItemsInNote('Tenda AX-300', [tenda, lain]).map((d) => d.itemId)).toEqual(['i1']);
  });
  test('nama rapat < 4 dilewati', () => {
    const pendek: DetectableItem = { id: 'p', brandName: '', model: 'A1' };
    expect(detectItemsInNote('A1 satu', [pendek])).toEqual([]);
  });
  test('dua Item bernama rapat sama keduanya ambiguous', () => {
    const a: DetectableItem = { id: 'a', brandName: 'Tenda', model: 'AX300' };
    const b: DetectableItem = { id: 'b', brandName: 'tenda', model: 'AX-300' };
    const r = detectItemsInNote('Tenda AX300', [a, b]);
    expect(r).toHaveLength(2);
    expect(r.every((d) => d.ambiguous)).toBe(true);
  });
  test('URL tautan dan gambar tidak menghasilkan kecocokan', () => {
    expect(detectItemsInNote('[lihat](http://x.com/tenda-ax300)', [tenda])).toEqual([]);
    expect(detectItemsInNote('![gambar](http://x.com/tenda-ax300.png)', [tenda])).toEqual([]);
  });
  test('lines menghitung baris, bukan kemunculan; urut lines menurun', () => {
    const note = 'Tenda AX300 Tenda AX300\nmr30g\nmercusys mr30g';
    const r = detectItemsInNote(note, [tenda, mercusys]);
    expect(r.map((d) => [d.itemId, d.lines])).toEqual([
      ['i2', 2],
      ['i1', 1],
    ]);
  });
  test('noteMentionsItem', () => {
    expect(noteMentionsItem('Tenda AX300', 'i1', [tenda, mercusys])).toBe(true);
    expect(noteMentionsItem('Tenda AX300', 'i2', [tenda, mercusys])).toBe(false);
  });
});

describe('pembantu', () => {
  test('nama tampilan dan kunci rapat', () => {
    expect(itemDisplayName({ brandName: 'Tenda', model: 'AX300' })).toBe('Tenda AX300');
    expect(itemDisplayName({ brandName: '', model: 'AX300' })).toBe('AX300');
    expect(compactKey('Tenda AX-300')).toBe('tendaax300');
  });
  test('countBoundedMatches', () => {
    expect(countBoundedMatches('ax 300 dan ax300', 'ax300')).toBe(2);
    expect(countBoundedMatches('ax 3000', 'ax300')).toBe(0);
  });
});
