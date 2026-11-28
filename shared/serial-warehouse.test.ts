import { describe, expect, test } from 'bun:test';
import {
  assignBoxes,
  boxKindOf,
  chunkCountOf,
  chunkRowsOf,
  clipboardText,
  normalizeOrderNumber,
  orderKey,
  orderNumberProblem,
  pickByOrder,
  readyStockClipboard,
  WAREHOUSE_LIMITS,
  warehouseRecordedNote,
} from './serial-warehouse';
import { SERIAL_LIMITS } from './serials';

describe('No SO', () => {
  test('normalisasi hanya memangkas spasi pinggir', () => {
    expect(normalizeOrderNumber('  so-12 ')).toBe('so-12');
  });
  test('kunci tak peka huruf besar/kecil', () => {
    expect(orderKey('SO-12')).toBe(orderKey('so-12'));
  });
  test('masalah: kosong, terlalu panjang, karakter kontrol, pengatur arah', () => {
    expect(orderNumberProblem('')).toBe('empty');
    expect(orderNumberProblem('a'.repeat(41))).toBe('too_long');
    expect(orderNumberProblem('a'.repeat(40))).toBeNull();
    expect(orderNumberProblem('SO\n1')).toBe('control_chars');
    expect(orderNumberProblem('SO‮1')).toBe('control_chars');
    expect(orderNumberProblem('SO-1')).toBeNull();
  });
});

describe('potongan', () => {
  test('jumlah dan ukuran per potongan', () => {
    expect(chunkCountOf(401, 200)).toBe(3);
    expect(chunkCountOf(400, 200)).toBe(2);
    expect(chunkCountOf(0, 200)).toBe(0);
    expect(chunkRowsOf(401, 200, 0)).toBe(200);
    expect(chunkRowsOf(401, 200, 2)).toBe(1);
    expect(chunkRowsOf(401, 200, 3)).toBe(0);
    expect(chunkRowsOf(5, 2, 1)).toBe(2);
  });
});

describe('teks', () => {
  test('clipboard satu SN per baris tanpa baris kosong di akhir', () => {
    expect(clipboardText(['A', 'B'])).toBe('A\nB');
    expect(clipboardText([])).toBe('');
  });
  test('catatan kejadian', () => {
    expect(warehouseRecordedNote('SO-1')).toBe('Dicatat Gudang · SO SO-1');
  });
  test('paritas ukuran potongan dengan batch serial', () => {
    expect(WAREHOUSE_LIMITS.chunkMax).toBe(SERIAL_LIMITS.batchRows);
  });
});

describe('kardus ready', () => {
  test('assignBoxes membagi serial ke kardus bernomor naik', () => {
    expect(assignBoxes({ startNumber: 12, size: 10, count: 25 })).toEqual([
      { number: 12, take: 10 },
      { number: 13, take: 10 },
      { number: 14, take: 5 },
    ]);
  });

  test('assignBoxes melanjutkan kardus terbuka dulu', () => {
    expect(
      assignBoxes({ startNumber: 12, size: 10, carry: { number: 11, used: 4 }, count: 8 }),
    ).toEqual([
      { number: 11, take: 6 },
      { number: 12, take: 2 },
    ]);
  });

  test('assignBoxes tanpa serial = kosong', () => {
    expect(assignBoxes({ startNumber: 1, size: 10, count: 0 })).toEqual([]);
  });

  test('boxKindOf', () => {
    expect(boxKindOf(10, 10)).toBe('full');
    expect(boxKindOf(5, 10)).toBe('loose');
  });

  test('pickByOrder: kardus penuh dulu menurut nomor, lalu ecer', () => {
    const ids = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p}${i}`);
    const boxes = [
      { id: 'b4', number: 4, kind: 'loose' as const, serialIds: ids(5, 'd') },
      { id: 'b1', number: 1, kind: 'full' as const, serialIds: ids(10, 'a') },
      { id: 'b5', number: 5, kind: 'full' as const, serialIds: ids(10, 'e') },
      { id: 'b2', number: 2, kind: 'full' as const, serialIds: ids(10, 'b') },
      { id: 'b3', number: 3, kind: 'full' as const, serialIds: ids(10, 'c') },
    ];
    const picked = pickByOrder(boxes, 35);
    expect(picked).toHaveLength(35);
    expect(picked.slice(0, 10)).toEqual(ids(10, 'a'));
    expect(picked.slice(30)).toEqual(ids(5, 'e'));
    const all = pickByOrder(boxes, 45);
    expect(all.slice(40)).toEqual(ids(5, 'd'));
    expect(pickByOrder(boxes, 0)).toEqual([]);
  });

  test('readyStockClipboard memberi awalan apostrof pada serial berawalan rumus', () => {
    const text = readyStockClipboard([
      { box: 1, serial: '=SUM(A1)' },
      { box: 2, serial: '+1' },
      { box: 3, serial: '-2' },
      { box: 4, serial: '@x' },
      { box: 5, serial: 'AB-1' },
    ]);
    expect(text.split('\n').slice(1)).toEqual([
      "1\t'=SUM(A1)",
      "2\t'+1",
      "3\t'-2",
      "4\t'@x",
      '5\tAB-1',
    ]);
  });

  test('readyStockClipboard', () => {
    expect(readyStockClipboard([{ box: 3, serial: 'A' }])).toBe('Kardus\tSerial\n3\tA');
  });
});
