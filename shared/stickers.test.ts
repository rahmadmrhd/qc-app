import { describe, expect, test } from 'bun:test';
import type { FileOwnerType } from './files';
import {
  isLowStock,
  piecesOfCount,
  STICKER_LIMITS,
  STICKER_RULES,
  STOCK_ENTRY_KINDS,
} from './stickers';

describe('stiker: hitungan stok', () => {
  test('piecesOfCount menjumlahkan lembar × isi per lembar plus butir lepas', () => {
    expect(
      piecesOfCount({
        rows: [
          { sheets: 10, perSheet: 12 },
          { sheets: 3, perSheet: 10 },
        ],
        loose: 5,
      }),
    ).toBe(155);
    expect(piecesOfCount({ rows: [], loose: 7 })).toBe(7);
    expect(piecesOfCount({ rows: [], loose: 0 })).toBe(0);
  });
});

describe('stiker: stok menipis', () => {
  test('aktif, batas > 0, total <= batas → menipis', () => {
    expect(isLowStock({ status: 'active', minQty: 50, total: 50 })).toBe(true);
    expect(isLowStock({ status: 'active', minQty: 50, total: 20 })).toBe(true);
  });

  test('total di atas batas, batas 0, atau nonaktif → tidak menipis', () => {
    expect(isLowStock({ status: 'active', minQty: 50, total: 51 })).toBe(false);
    expect(isLowStock({ status: 'active', minQty: 0, total: 0 })).toBe(false);
    expect(isLowStock({ status: 'inactive', minQty: 50, total: 0 })).toBe(false);
  });
});

describe('stiker: konstanta', () => {
  test('nilai batas sesuai rencana', () => {
    expect(STICKER_LIMITS.nameMax).toBe(120);
    expect(STICKER_LIMITS.aliasMax).toBe(120);
    expect(STICKER_LIMITS.reasonMax).toBe(300);
    expect(STICKER_LIMITS.qtyMax).toBe(1_000_000);
    expect(STICKER_LIMITS.countRows).toBe(20);
    expect(STICKER_LIMITS.opnameRows).toBe(100);
  });

  test('aturan dan jenis entri stok', () => {
    expect(STICKER_RULES).toEqual(['bu', 'none']);
    expect(STOCK_ENTRY_KINDS).toEqual(['in', 'out', 'adjust', 'opname']);
  });

  test("jenis pemilik berkas menerima 'sticker'", () => {
    const owner: FileOwnerType = 'sticker';
    expect(owner).toBe('sticker');
  });
});
