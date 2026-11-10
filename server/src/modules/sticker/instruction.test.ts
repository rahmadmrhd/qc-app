import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { DbError } from '@server/core/db';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { ItemStickerPhotoInput } from '@shared/contract';
import {
  hasInstructionsOf,
  loadItemInstructions,
  replaceItemInstructionStmts,
} from './instruction-repo';

// Tabel dan repo instruksi stiker per item (3b-2, Task 2): ganti-semua, muat berurutan, kunci asing RESTRICT/CASCADE.

setDefaultTimeout(90_000);

let env: TestEnv;

const THUMB = Uint8Array.from([1, 2, 3]);

async function seedGuide(id: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO sticker_guide_images (id, name, thumb_mime, thumb, updated_at) VALUES (?, ?, 'image/webp', ?, '2026-11-10T00:00:00.000Z')",
  )
    .bind(id, id, THUMB)
    .run();
}

async function save(itemId: string, photos: ItemStickerPhotoInput[]): Promise<void> {
  await env.DB.batch(replaceItemInstructionStmts(env.DB, itemId, photos));
}

async function count(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{
    n: number | string;
  }>();
  return Number(row?.n ?? 0);
}

const PHOTOS: ItemStickerPhotoInput[] = [
  {
    guideId: 'g2',
    caption: 'Sisi depan',
    buId: 'bu1',
    marks: [
      { x: 100, y: 200, target: { kind: 'sticker', stickerId: 's1' }, note: 'kiri atas' },
      { x: 0, y: 1000, target: { kind: 'type', typeId: 't1' }, note: '' },
      { x: 500, y: 500, target: { kind: 'sticker', stickerId: 's2' }, note: 'tengah' },
    ],
  },
  { guideId: 'g1', caption: '', buId: null, marks: [] },
  {
    guideId: 'g3',
    caption: 'Samping',
    buId: null,
    marks: [{ x: 1, y: 2, target: { kind: 'type', typeId: 't2' }, note: 'x' }],
  },
];

beforeEach(async () => {
  env = await createTestEnv();
  for (const id of ['g1', 'g2', 'g3']) await seedGuide(id);
});

describe('instruksi stiker item: repo', () => {
  test('simpan lalu muat mengembalikan foto dan penanda berurutan persis', async () => {
    await save('i1', PHOTOS);
    const loaded = await loadItemInstructions(env.DB, ['i1']);
    expect(loaded.get('i1')).toEqual([
      { ...PHOTOS[0], position: 0 },
      { ...PHOTOS[1], position: 1 },
      { ...PHOTOS[2], position: 2 },
    ]);
  });

  test('muat banyak item sekaligus; item tanpa foto tidak ada di peta; daftar kosong = peta kosong', async () => {
    await save('i1', [PHOTOS[0] as ItemStickerPhotoInput]);
    await save('i2', [PHOTOS[2] as ItemStickerPhotoInput]);
    const loaded = await loadItemInstructions(env.DB, ['i1', 'i2', 'i3']);
    expect([...loaded.keys()].sort()).toEqual(['i1', 'i2']);
    expect(loaded.get('i2')?.[0]?.marks).toEqual(PHOTOS[2]?.marks ?? []);
    expect((await loadItemInstructions(env.DB, [])).size).toBe(0);
  });

  test('ganti-semua menghapus yang lama dan tidak menyentuh item lain', async () => {
    await save('i1', PHOTOS);
    await save('i2', [PHOTOS[2] as ItemStickerPhotoInput]);
    const replacement: ItemStickerPhotoInput[] = [
      {
        guideId: 'g3',
        caption: 'Baru',
        buId: 'bu2',
        marks: [{ x: 7, y: 8, target: { kind: 'sticker', stickerId: 's9' }, note: '' }],
      },
    ];
    await save('i1', replacement);
    const loaded = await loadItemInstructions(env.DB, ['i1', 'i2']);
    expect(loaded.get('i1')).toEqual([{ ...replacement[0], position: 0 }]);
    expect(loaded.get('i2')?.length).toBe(1);
    expect(await count('item_sticker_photos')).toBe(2);
    expect(await count('item_sticker_marks')).toBe(2);
    await save('i1', []);
    expect((await loadItemInstructions(env.DB, ['i1'])).has('i1')).toBe(false);
  });

  test('menghapus gambar pustaka yang dipakai GAGAL oleh kunci asing (tidak senyap)', async () => {
    await save('i1', PHOTOS);
    const failure = await env.DB.prepare('DELETE FROM sticker_guide_images WHERE id = ?')
      .bind('g1')
      .run()
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(failure).toBeInstanceOf(DbError);
    expect((failure as DbError).errno).toBe(1451);
    expect(await count('sticker_guide_images')).toBe(3);
  });

  test('foto ke gambar pustaka yang tidak ada ditolak kunci asing', async () => {
    const failure = await save('i1', [
      { guideId: 'hilang', caption: '', buId: null, marks: [] },
    ]).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(DbError);
    expect((failure as DbError).errno).toBe(1452);
    expect(await count('item_sticker_photos')).toBe(0);
  });

  test('foto kembar dalam satu item ditolak kunci utama', async () => {
    const failure = await save('i1', [
      { guideId: 'g1', caption: '', buId: null, marks: [] },
      { guideId: 'g1', caption: 'dua', buId: null, marks: [] },
    ]).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(DbError);
    expect((failure as DbError).kind).toBe('duplicate');
    expect(await count('item_sticker_photos')).toBe(0);
  });

  test('menghapus foto item ikut menghapus penandanya (CASCADE)', async () => {
    await save('i1', PHOTOS);
    expect(await count('item_sticker_marks')).toBe(4);
    await env.DB.prepare('DELETE FROM item_sticker_photos WHERE item_id = ? AND guide_id = ?')
      .bind('i1', 'g2')
      .run();
    expect(await count('item_sticker_marks')).toBe(1);
    expect(await count('item_sticker_photos')).toBe(2);
  });

  test('sasaran penanda tepat satu: kosong atau ganda ditolak oleh jaring pengaman basis data', async () => {
    await save('i1', [{ guideId: 'g1', caption: '', buId: null, marks: [] }]);
    for (const [stickerId, typeId] of [
      ['', ''],
      ['s1', 't1'],
    ] as const) {
      const failure = await env.DB.prepare(
        "INSERT INTO item_sticker_marks (item_id, guide_id, `position`, x, y, sticker_id, type_id, note) VALUES ('i1', 'g1', 0, 1, 1, ?, ?, '')",
      )
        .bind(stickerId, typeId)
        .run()
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(failure).toBeInstanceOf(DbError);
    }
    expect(await count('item_sticker_marks')).toBe(0);
  });

  test('hasInstructionsOf benar hanya bila ada penanda (foto tanpa penanda = tidak ada)', async () => {
    await save('i1', [PHOTOS[1] as ItemStickerPhotoInput]);
    await save('i2', [PHOTOS[2] as ItemStickerPhotoInput]);
    expect([...(await hasInstructionsOf(env.DB, ['i1', 'i2', 'i3']))]).toEqual(['i2']);
    expect((await hasInstructionsOf(env.DB, [])).size).toBe(0);
  });
});
