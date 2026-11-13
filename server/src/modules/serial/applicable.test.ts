import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedBusinessUnit } from '@server-test/access-fixtures';
import { seedItem } from '@server-test/item-fixtures';
import { seedPostel } from '@server-test/postel-fixtures';
import { seedGuideImage, seedSticker, seedStickerType } from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { applicableStickersOf } from './applicable';

setDefaultTimeout(60_000);

let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
  await seedBusinessUnit(env, { id: 'bu-a', code: 'A' });
  await seedBusinessUnit(env, { id: 'bu-b', code: 'B' });
  await seedGuideImage(env, { id: 'g1' });
});

async function mark(
  itemId: string,
  target: { stickerId: string } | { typeId: string },
  position: number,
  guideId = 'g1',
) {
  await env.DB.prepare(
    "INSERT IGNORE INTO item_sticker_photos (item_id, guide_id, caption, bu_id, `position`) VALUES (?, ?, '', '', 0)",
  )
    .bind(itemId, guideId)
    .run();
  await env.DB.prepare(
    "INSERT INTO item_sticker_marks (item_id, guide_id, `position`, x, y, sticker_id, type_id, note) VALUES (?, ?, ?, 10, 10, ?, ?, '')",
  )
    .bind(
      itemId,
      guideId,
      position,
      'stickerId' in target ? target.stickerId : '',
      'typeId' in target ? target.typeId : '',
    )
    .run();
}

describe('stiker yang berlaku', () => {
  test('penanda ke stiker tertentu menghasilkan stiker itu dengan nama jenis dan defaultQty 1', async () => {
    await seedStickerType(env, { id: 't1', name: 'Jenis Satu', rule: 'none' });
    await seedSticker(env, { id: 's1', typeId: 't1', name: 'Zeta' });
    await seedSticker(env, { id: 's2', typeId: 't1', name: 'Alfa' });
    await seedItem(env, { id: 'i1', brand: 'M', model: 'X', businessUnitIds: ['bu-a'] });
    await mark('i1', { stickerId: 's1' }, 0);
    await mark('i1', { stickerId: 's2' }, 1);
    const result = await applicableStickersOf(env, 'i1', 'bu-a');
    expect(result.map((s) => s.id)).toEqual(['s2', 's1']);
    expect(result[0]).toEqual({
      id: 's2',
      name: 'Alfa',
      alias: '',
      typeName: 'Jenis Satu',
      defaultQty: 1,
    });
  });

  test('penanda jenis aturan bu: hanya stiker yang tertaut ke BU argumen (item di dua BU)', async () => {
    await seedStickerType(env, { id: 't1', rule: 'bu' });
    await seedSticker(env, { id: 'sa', typeId: 't1', name: 'Untuk A', buIds: ['bu-a'] });
    await seedSticker(env, { id: 'sb', typeId: 't1', name: 'Untuk B', buIds: ['bu-b'] });
    await seedItem(env, { id: 'i1', brand: 'M', model: 'X', businessUnitIds: ['bu-a', 'bu-b'] });
    await mark('i1', { typeId: 't1' }, 0);
    expect((await applicableStickersOf(env, 'i1', 'bu-a')).map((s) => s.id)).toEqual(['sa']);
    expect((await applicableStickersOf(env, 'i1', 'bu-b')).map((s) => s.id)).toEqual(['sb']);
  });

  test('stiker nonaktif dibuang dan hasil tanpa duplikat', async () => {
    await seedStickerType(env, { id: 't1', rule: 'none' });
    await seedSticker(env, { id: 's1', typeId: 't1', name: 'Aktif' });
    await seedSticker(env, { id: 's2', typeId: 't1', name: 'Mati', status: 'inactive' });
    await seedItem(env, { id: 'i1', brand: 'M', model: 'X', businessUnitIds: ['bu-a'] });
    await mark('i1', { stickerId: 's1' }, 0);
    await mark('i1', { stickerId: 's2' }, 1);
    await mark('i1', { typeId: 't1' }, 2); // jenis none: s1 lagi (duplikat), s2 nonaktif
    expect((await applicableStickersOf(env, 'i1', 'bu-a')).map((s) => s.id)).toEqual(['s1']);
  });

  test('jenis group Postel hanya stiker MILIK catatan Postel item (stiker per catatan)', async () => {
    await seedStickerType(env, { id: 'tp', rule: 'group', systemKind: 'postel' });
    await seedSticker(env, { id: 'sp', typeId: 'tp', name: 'Postel - A' });
    await seedSticker(env, { id: 'sq', typeId: 'tp', name: 'Postel - B' });
    await seedItem(env, { id: 'linked', brand: 'M', model: 'L', businessUnitIds: ['bu-a'] });
    await seedItem(env, { id: 'other', brand: 'M', model: 'O', businessUnitIds: ['bu-a'] });
    await seedItem(env, { id: 'free', brand: 'M', model: 'F', businessUnitIds: ['bu-a'] });
    await seedPostel(env, {
      id: 'p1',
      stickerId: 'sp',
      itemIds: ['linked'],
      numbers: [{ number: 'PA-1', expiresOn: '2027-01-01' }],
    });
    await seedPostel(env, {
      id: 'p2',
      stickerId: 'sq',
      itemIds: ['other'],
      numbers: [{ number: 'PB-1', expiresOn: '2027-01-01' }],
    });
    await mark('linked', { typeId: 'tp' }, 0);
    await mark('other', { typeId: 'tp' }, 0);
    await mark('free', { typeId: 'tp' }, 0);
    // Hanya stiker catatan item sendiri (sp), bukan stiker Postel lain (sq) walau satu jenis.
    expect((await applicableStickersOf(env, 'linked', 'bu-a')).map((s) => s.id)).toEqual(['sp']);
    expect((await applicableStickersOf(env, 'other', 'bu-a')).map((s) => s.id)).toEqual(['sq']);
    expect(await applicableStickersOf(env, 'free', 'bu-a')).toEqual([]);
  });

  test('item tanpa instruksi: kosong', async () => {
    await seedItem(env, { id: 'i1', brand: 'M', model: 'X', businessUnitIds: ['bu-a'] });
    expect(await applicableStickersOf(env, 'i1', 'bu-a')).toEqual([]);
  });
});
