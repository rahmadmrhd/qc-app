import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { brandIdOf, seedBrand, seedItem } from '@server-test/item-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { seedGuideImage, seedSticker, seedStickerType } from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { ItemDto, ItemStickerPhotoInput } from '@shared/contract';
import { planItemWrite } from './service';

// Instruksi stiker per item (3b-2, Task 4): simpan dan baca bersama item, penerjemahan jenis -> stiker menurut BU,
// versi item, item dev lama, hak BU, dan audit.

setDefaultTimeout(90_000);

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

const baseInput = {
  brandId: brandIdOf('Sony'),
  businessUnitIds: ['bu-a'],
  model: 'Satu',
  isCountryLock: false,
  aliases: [] as string[],
  accessories: [],
  attachments: [],
  detail: '',
};

const photo = (over: Partial<ItemStickerPhotoInput> = {}): ItemStickerPhotoInput => ({
  guideId: 'g1',
  caption: '',
  buId: null,
  marks: [],
  ...over,
});

async function create(
  stickerPhotos: ItemStickerPhotoInput[],
  over: Record<string, unknown> = {},
): Promise<ItemDto> {
  const response = await rest.post('/items', { body: { ...baseInput, stickerPhotos, ...over } });
  expect(response.status).toBe(201);
  return (await response.json()) as ItemDto;
}

async function get(id: string, email?: string): Promise<ItemDto> {
  const response = await rest.get(`/items/${id}`, email === undefined ? {} : { email });
  expect(response.status).toBe(200);
  return (await response.json()) as ItemDto;
}

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-10T00:00:00.000Z'));
  rest = restClient(env);
  await seedBusinessUnit(env, { id: 'bu-a', code: 'A', name: 'BU A' });
  await seedBusinessUnit(env, { id: 'bu-b', code: 'B', name: 'BU B' });
  await seedBrand(env, 'Sony');
  await seedGuideImage(env, { id: 'g1', name: 'Kardus', width: 800, height: 600 });
  await seedGuideImage(env, { id: 'g2', name: 'Samping', width: 640, height: 480 });
  await seedStickerType(env, { id: 't-bu', name: 'Segel', rule: 'bu' });
  await seedStickerType(env, { id: 't-none', name: 'Manual', rule: 'none' });
  await seedStickerType(env, { id: 't-kosong', name: 'Garansi', rule: 'bu' });
  await seedSticker(env, {
    id: 's-a',
    typeId: 't-bu',
    name: 'Segel Umum',
    alias: 'Segel A',
    fileId: 'f-segel-a',
    buIds: ['bu-a'],
  });
  await seedSticker(env, { id: 's-b', typeId: 't-bu', name: 'Segel B', buIds: ['bu-b'] });
  await seedSticker(env, { id: 's-ab', typeId: 't-bu', name: 'Segel AB', buIds: ['bu-a', 'bu-b'] });
  await seedSticker(env, { id: 's-nobu', typeId: 't-bu', name: 'Segel Tanpa BU' });
  await seedSticker(env, { id: 's-n1', typeId: 't-none', name: 'Manual Book' });
  await seedSticker(env, { id: 's-n2', typeId: 't-none', name: 'Postel' });
  await seedSticker(env, { id: 's-g-b', typeId: 't-kosong', name: 'Garansi B', buIds: ['bu-b'] });
  await seedRole(env, { id: 'r-edit', name: 'Ubah', permissions: { item: 'edit' } });
  await seedUser(env, {
    id: 'u-a',
    email: 'a@gmail.com',
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-edit'] }],
  });
});

describe('simpan dan baca instruksi', () => {
  test('item baru dengan dua foto dan penanda campuran: get mengembalikan persis (urutan, koordinat, catatan, nama)', async () => {
    const photos: ItemStickerPhotoInput[] = [
      photo({
        guideId: 'g2',
        caption: 'Sisi samping',
        buId: 'bu-a',
        marks: [
          { x: 100, y: 200, target: { kind: 'sticker', stickerId: 's-a' }, note: 'kiri atas' },
          { x: 0, y: 1000, target: { kind: 'type', typeId: 't-none' }, note: '' },
          { x: 500, y: 500, target: { kind: 'sticker', stickerId: 's-b' }, note: 'tengah' },
        ],
      }),
      photo({ guideId: 'g1', caption: '', marks: [] }),
    ];
    const saved = await create(photos);
    const loaded = await get(saved.id);
    expect(loaded.stickerPhotos).toEqual(saved.stickerPhotos);
    expect(loaded.hasInstructions).toBe(true);
    expect(loaded.stickerPhotos.map((p) => [p.guideId, p.guideName, p.width, p.height])).toEqual([
      ['g2', 'Samping', 640, 480],
      ['g1', 'Kardus', 800, 600],
    ]);
    const first = loaded.stickerPhotos[0];
    expect(first?.caption).toBe('Sisi samping');
    expect(first?.buId).toBe('bu-a');
    expect(first?.marks.map((m) => [m.x, m.y, m.note, m.target])).toEqual([
      [100, 200, 'kiri atas', { kind: 'sticker', stickerId: 's-a' }],
      [0, 1000, '', { kind: 'type', typeId: 't-none' }],
      [500, 500, 'tengah', { kind: 'sticker', stickerId: 's-b' }],
    ]);
    expect(first?.marks[0]).toMatchObject({
      targetName: 'Segel A',
      unresolved: false,
      resolved: [
        {
          id: 's-a',
          name: 'Segel Umum',
          alias: 'Segel A',
          fileId: 'f-segel-a',
          buCodes: ['A'],
          inactive: false,
        },
      ],
    });
    // Penanda ke stiker tertentu tidak disaring BU item: s-b (BU B) pada item BU A tetap tampil, buCodes kosong.
    expect(first?.marks[2]).toMatchObject({
      targetName: 'Segel B',
      unresolved: false,
      resolved: [{ id: 's-b', alias: '', fileId: null, buCodes: [], inactive: false }],
    });
    expect(loaded.stickerPhotos[1]?.marks).toEqual([]);
  });

  test('ubah mengganti seluruh instruksi; daftar kosong menghapus semuanya dan hasInstructions false', async () => {
    const saved = await create([
      photo({ marks: [{ x: 1, y: 1, target: { kind: 'sticker', stickerId: 's-a' }, note: '' }] }),
      photo({ guideId: 'g2', caption: 'lama' }),
    ]);
    env.clock.advance(1000);
    const replaced = await rest.put(`/items/${saved.id}`, {
      body: {
        ...baseInput,
        stickerPhotos: [
          photo({
            guideId: 'g2',
            caption: 'baru',
            marks: [{ x: 9, y: 9, target: { kind: 'type', typeId: 't-none' }, note: 'x' }],
          }),
        ],
      },
    });
    expect(replaced.status).toBe(200);
    const after = await get(saved.id);
    expect(after.stickerPhotos.map((p) => [p.guideId, p.caption, p.marks.length])).toEqual([
      ['g2', 'baru', 1],
    ]);
    env.clock.advance(1000);
    await rest.put(`/items/${saved.id}`, { body: { ...baseInput, stickerPhotos: [] } });
    const empty = await get(saved.id);
    expect(empty.stickerPhotos).toEqual([]);
    expect(empty.hasInstructions).toBe(false);
  });

  test('hasInstructions: foto tanpa penanda = false (hasil simpan dan get)', async () => {
    const saved = await create([photo()]);
    expect(saved.hasInstructions).toBe(false);
    expect((await get(saved.id)).hasInstructions).toBe(false);
  });

  test('perubahan yang hanya menyentuh instruksi menaikkan updatedAt; expectedUpdatedAt usang = 412 lewat If-Match', async () => {
    const saved = await create([]);
    env.clock.advance(1000);
    const first = await rest.put(`/items/${saved.id}`, {
      headers: { 'if-match': `"${saved.updatedAt}"` },
      body: { ...baseInput, stickerPhotos: [photo({ caption: 'satu' })] },
    });
    expect(first.status).toBe(200);
    const firstItem = await jsonOf(first);
    expect(firstItem.updatedAt).not.toBe(saved.updatedAt);
    env.clock.advance(1000);
    const stale = await rest.put(`/items/${saved.id}`, {
      headers: { 'if-match': `"${saved.updatedAt}"` },
      body: { ...baseInput, stickerPhotos: [photo({ caption: 'dua' })] },
    });
    expect(stale.status).toBe(412);
    expect((await get(saved.id)).stickerPhotos[0]?.caption).toBe('satu');
  });

  test('rujukan tidak sah ditolak 422 pada field stickerPhotos dan tidak ada yang tersimpan', async () => {
    const response = await rest.post('/items', {
      body: { ...baseInput, stickerPhotos: [photo({ guideId: 'hilang' })] },
    });
    expect(response.status).toBe(422);
    expect(await jsonOf(response)).toMatchObject({
      code: 'VALIDATION',
      fields: { stickerPhotos: 'Foto 1: gambar tidak ditemukan' },
    });
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM items').first<{ n: number }>();
    expect(Number(count?.n)).toBe(0);
  });

  test('gambar pustaka terhapus tepat sebelum penulisan: kunci asing menjadi VALIDATION, tidak ada yang tersimpan', async () => {
    const { batchItemWrite } = await import('./service');
    const { loadUserContext } = await import('@server/modules/access/context');
    const actor = await loadUserContext(env, 'a@gmail.com');
    if (!actor) throw new Error('konteks tidak ada');
    const plan = await planItemWrite(
      env,
      { ...baseInput, stickerPhotos: [photo({ guideId: 'g2' })] },
      { id: 'item-balapan', actor },
    );
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sticker_guide_images WHERE id = ?').bind('g2'),
      env.DB.prepare("DELETE FROM files WHERE id = 'g2'"),
    ]);
    const failure = await batchItemWrite(env.DB, plan.statements).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({
      code: 'VALIDATION',
      fields: { stickerPhotos: expect.stringContaining('Gambar instruksi tidak ditemukan') },
    });
    const items = await env.DB.prepare('SELECT COUNT(*) AS n FROM items').first<{ n: number }>();
    expect(Number(items?.n)).toBe(0);
  });
});

describe('galat kunci asing 1452 pada penulisan item', () => {
  test('FK lain (bukan gambar pustaka) dilempar apa adanya, tidak dilabeli "gambar tidak ditemukan"', async () => {
    const { batchItemWrite } = await import('./service');
    // penanda yatim: melanggar FK item_sticker_marks_photo_fk (bukan item_sticker_photos_guide_fk)
    const failure = await batchItemWrite(env.DB, [
      env.DB.prepare(
        "INSERT INTO item_sticker_marks (item_id, guide_id, `position`, x, y, sticker_id, type_id, note) VALUES ('x', 'g1', 0, 1, 1, 's-a', '', '')",
      ),
    ]).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({ name: 'DbError', errno: 1452 });
    expect(JSON.stringify(failure)).not.toContain('Gambar instruksi tidak ditemukan');
    expect((failure as Error).message).toContain('item_sticker_marks_photo_fk');
  });
});

describe('penerjemahan jenis ke stiker menurut BU item', () => {
  const typeMark = (typeId: string) => ({
    x: 1,
    y: 1,
    target: { kind: 'type' as const, typeId },
    note: '',
  });
  const resolvedOf = async (businessUnitIds: string[], typeId: string) => {
    const saved = await create([photo({ marks: [typeMark(typeId)] })], { businessUnitIds });
    const mark = (await get(saved.id)).stickerPhotos[0]?.marks[0];
    return {
      name: mark?.targetName,
      unresolved: mark?.unresolved,
      resolved: mark?.resolved.map((r) => [r.id, r.buCodes]),
    };
  };

  test('jenis aturan bu pada item satu BU: hanya stiker BU itu; stiker tanpa BU tidak pernah cocok', async () => {
    expect(await resolvedOf(['bu-a'], 't-bu')).toEqual({
      name: 'Segel',
      unresolved: false,
      // Urut menurut nama stiker lalu id.
      resolved: [
        ['s-ab', ['A']],
        ['s-a', ['A']],
      ],
    });
  });

  test('item dua BU: stiker dari kedua BU, berlabel kode BU penyebabnya', async () => {
    const result = await resolvedOf(['bu-a', 'bu-b'], 't-bu');
    expect(result.unresolved).toBe(false);
    expect(new Map(result.resolved as [string, string[]][])).toEqual(
      new Map([
        ['s-a', ['A']],
        ['s-b', ['B']],
        ['s-ab', ['A', 'B']],
      ]),
    );
  });

  test('tanpa kecocokan: unresolved true dan resolved kosong (simpan tetap berhasil)', async () => {
    expect(await resolvedOf(['bu-a'], 't-kosong')).toEqual({
      name: 'Garansi',
      unresolved: true,
      resolved: [],
    });
  });

  test('jenis aturan none: semua stiker aktif jenis itu, apa pun BU item', async () => {
    const result = await resolvedOf(['bu-a'], 't-none');
    expect(result.unresolved).toBe(false);
    expect(result.resolved?.map(([id]) => id).sort()).toEqual(['s-n1', 's-n2']);
  });

  test('stiker nonaktif setelah ditandai tampil inactive; jenis nonaktif tetap diterjemahkan', async () => {
    const saved = await create([
      photo({
        marks: [
          { x: 1, y: 1, target: { kind: 'sticker', stickerId: 's-a' }, note: '' },
          { x: 2, y: 2, target: { kind: 'type', typeId: 't-none' }, note: '' },
        ],
      }),
    ]);
    await env.DB.prepare(
      "UPDATE stickers SET status = 'inactive' WHERE id IN ('s-a', 's-n2')",
    ).run();
    await env.DB.prepare("UPDATE sticker_types SET status = 'inactive' WHERE id = 't-none'").run();
    const marks = (await get(saved.id)).stickerPhotos[0]?.marks ?? [];
    expect(marks[0]?.resolved).toMatchObject([{ id: 's-a', inactive: true }]);
    expect(marks[0]?.unresolved).toBe(false);
    // Jenis nonaktif tetap diterjemahkan; stiker nonaktif jenis itu tidak ikut (hanya yang aktif).
    expect(marks[1]?.resolved.map((r) => r.id)).toEqual(['s-n1']);
    // Menyimpan ulang item dengan penanda nonaktif yang sudah tersimpan tetap lolos.
    env.clock.advance(1000);
    const resave = await rest.put(`/items/${saved.id}`, {
      body: {
        ...baseInput,
        stickerPhotos: [
          photo({ marks: marks.map(({ x, y, target, note }) => ({ x, y, target, note })) }),
        ],
      },
    });
    expect(resave.status).toBe(200);
  });
});

describe('item dev lama dan hak BU', () => {
  test('item dengan kolom stickers terisi (lama) dapat di-get (instruksi kosong), muncul di daftar, dan disimpan ulang', async () => {
    await seedItem(env, { id: 'lama', brand: 'Sony', model: 'Lama', businessUnitIds: ['bu-a'] });
    await env.DB.prepare('UPDATE items SET stickers = ? WHERE id = ?')
      .bind('[{"name":"Label SNI","note":"Belakang","fileId":null}]', 'lama')
      .run();
    const old = await get('lama');
    expect(old.stickerPhotos).toEqual([]);
    expect(old.hasInstructions).toBe(false);
    expect('stickers' in old).toBe(false);
    const list = (await (await rest.get('/items')).json()) as {
      items: Array<{ id: string; hasInstructions: boolean }>;
    };
    expect(list.items.find((item) => item.id === 'lama')?.hasInstructions).toBe(false);
    env.clock.advance(1000);
    const resave = await rest.put(`/items/${'lama'}`, {
      body: {
        ...baseInput,
        model: 'Lama',
        stickerPhotos: [
          photo({
            marks: [{ x: 1, y: 1, target: { kind: 'sticker', stickerId: 's-a' }, note: '' }],
          }),
        ],
      },
    });
    expect(resave.status).toBe(200);
    expect((await get('lama')).hasInstructions).toBe(true);
  });

  test('item di luar hak BU NOT_FOUND di get; item BU terlihat tampil', async () => {
    const hidden = await create([photo({ marks: [] })], { businessUnitIds: ['bu-b'] });
    const response = await rest.get(`/items/${hidden.id}`, { email: 'a@gmail.com' });
    expect(response.status).toBe(404);
    expect(await jsonOf(response)).toMatchObject({ code: 'NOT_FOUND' });
    const visible = await create([photo({ marks: [] })], { model: 'Dua' });
    expect((await get(visible.id, 'a@gmail.com')).id).toBe(visible.id);
  });

  test('audit item.update memuat ringkasan instruksi (jumlah foto dan penanda) sebelum dan sesudah', async () => {
    const saved = await create([photo()]);
    env.clock.advance(1000);
    await rest.put(`/items/${saved.id}`, {
      body: {
        ...baseInput,
        stickerPhotos: [
          photo({
            marks: [
              { x: 1, y: 1, target: { kind: 'sticker', stickerId: 's-a' }, note: '' },
              { x: 2, y: 2, target: { kind: 'type', typeId: 't-none' }, note: '' },
            ],
          }),
          photo({ guideId: 'g2' }),
        ],
      },
    });
    const audit = await env.DB.prepare(
      "SELECT `before`, `after` FROM audit_log WHERE action = 'item.update'",
    ).first<{ before: string; after: string }>();
    expect(JSON.parse(audit?.before ?? '{}').stickerPhotos).toBe('1 foto, 0 penanda');
    expect(JSON.parse(audit?.after ?? '{}').stickerPhotos).toBe('2 foto, 2 penanda');
    expect('stickers' in JSON.parse(audit?.after ?? '{}')).toBe(false);
  });
});
