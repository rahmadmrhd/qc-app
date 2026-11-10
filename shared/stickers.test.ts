import { describe, expect, test } from 'bun:test';
import type { FileOwnerType } from './files';
import {
  GUIDE_LIMITS,
  GUIDE_SORTS,
  guideNameFromFile,
  INSTRUCTION_LIMITS,
  isLowStock,
  type MatchSticker,
  piecesOfCount,
  STICKER_LIMITS,
  STICKER_RULES,
  STOCK_ENTRY_KINDS,
  stickersForType,
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

  test("jenis pemilik berkas menerima 'sticker' dan 'stickerguide'", () => {
    const owner: FileOwnerType = 'sticker';
    const guide: FileOwnerType = 'stickerguide';
    expect(owner).toBe('sticker');
    expect(guide).toBe('stickerguide');
  });
});

describe('pustaka gambar stiker: konstanta', () => {
  test('nilai batas sesuai spek 3b-1', () => {
    expect(GUIDE_LIMITS).toEqual({
      libraryMax: 2000,
      nameMax: 120,
      batchMax: 20,
      pageDefault: 40,
      pageMax: 100,
      thumbMaxBytes: 40_960,
      thumbTargetBytes: 30_720,
      thumbSide: 320,
      thumbMaxSide: 400,
    });
  });

  test('urutan daftar gambar', () => {
    expect(GUIDE_SORTS).toEqual([
      'newest',
      'oldest',
      'nameAsc',
      'nameDesc',
      'sizeDesc',
      'usageDesc',
    ]);
  });
});

describe('pustaka gambar stiker: nama dari berkas', () => {
  test('ekstensi terakhir dibuang, huruf dipertahankan', () => {
    expect(guideNameFromFile('Foto Kardus.PNG')).toBe('Foto Kardus');
    expect(guideNameFromFile('a.b.c.jpg')).toBe('a.b.c');
    expect(guideNameFromFile('tanpa-ekstensi')).toBe('tanpa-ekstensi');
  });

  test('nama kosong setelah dirapikan menjadi Gambar', () => {
    expect(guideNameFromFile('  .png')).toBe('Gambar');
    expect(guideNameFromFile('.png')).toBe('Gambar');
    expect(guideNameFromFile('   .jpg')).toBe('Gambar');
  });

  test('spasi ganda dan spasi tepi dirapikan', () => {
    expect(guideNameFromFile('  Foto   Kardus  .jpg')).toBe('Foto Kardus');
  });

  test('dipotong maksimal nameMax karakter', () => {
    expect(guideNameFromFile(`${'x'.repeat(200)}.jpg`)).toBe('x'.repeat(GUIDE_LIMITS.nameMax));
  });

  test('pemotongan menghitung karakter (emoji = 1), bukan unit UTF-16', () => {
    const name = guideNameFromFile(`${'😀'.repeat(200)}.png`);
    expect([...name]).toHaveLength(GUIDE_LIMITS.nameMax);
  });
});

describe('instruksi stiker item: batas', () => {
  test('nilai batas', () => {
    expect(INSTRUCTION_LIMITS).toEqual({
      photos: 10,
      marks: 30,
      caption: 200,
      markNote: 120,
      coordMax: 1000,
    });
  });
});

describe('stickersForType', () => {
  const sticker = (
    id: string,
    typeId: string,
    buIds: string[],
    status: 'active' | 'inactive' = 'active',
  ): MatchSticker => ({ id, typeId, status, buIds });
  const all: MatchSticker[] = [
    sticker('s1', 't1', ['bu1']),
    sticker('s2', 't1', ['bu2']),
    sticker('s3', 't1', ['bu1', 'bu2']),
    sticker('s4', 't1', []),
    sticker('s5', 't1', ['bu1'], 'inactive'),
    sticker('s6', 't2', ['bu1']),
  ];
  const ids = (list: MatchSticker[]) => list.map((item) => item.id);

  test('aturan none: semua stiker aktif jenis itu; nonaktif dan jenis lain diabaikan', () => {
    expect(ids(stickersForType({ id: 't1', rule: 'none' }, all, ['bu1']))).toEqual([
      's1',
      's2',
      's3',
      's4',
    ]);
  });

  test('aturan bu: hanya stiker yang buIds-nya beririsan dengan BU item', () => {
    expect(ids(stickersForType({ id: 't1', rule: 'bu' }, all, ['bu1']))).toEqual(['s1', 's3']);
    expect(ids(stickersForType({ id: 't1', rule: 'bu' }, all, ['bu2']))).toEqual(['s2', 's3']);
  });

  test('item dua BU: stiker dari kedua BU, urutan masukan dipertahankan', () => {
    expect(ids(stickersForType({ id: 't1', rule: 'bu' }, all, ['bu2', 'bu1']))).toEqual([
      's1',
      's2',
      's3',
    ]);
  });

  test('aturan bu: stiker tanpa BU tidak pernah cocok, nonaktif diabaikan', () => {
    const result = ids(stickersForType({ id: 't1', rule: 'bu' }, all, ['bu1', 'bu2']));
    expect(result).not.toContain('s4');
    expect(result).not.toContain('s5');
  });

  test('itemBuIds kosong: bu menghasilkan kosong, none menghasilkan semua aktif', () => {
    expect(stickersForType({ id: 't1', rule: 'bu' }, all, [])).toEqual([]);
    expect(ids(stickersForType({ id: 't1', rule: 'none' }, all, []))).toEqual([
      's1',
      's2',
      's3',
      's4',
    ]);
  });
});
