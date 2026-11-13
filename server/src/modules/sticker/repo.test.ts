import { beforeEach, describe, expect, test } from 'bun:test';
import { seedItem } from '@server-test/item-fixtures';
import { seedManualBookVersion, seedSticker, seedStickerType } from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { manualBookDesignIdsOf } from '../item/repo';
import {
  insertManualBookVersionStmt,
  latestManualBookStickerIds,
  listManualBookVersions,
  listStickerTypeRecords,
  stickersFromResult,
  stickersStatement,
} from './repo';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});

describe('jenis stiker: kolom 4a', () => {
  test('systemKind dan defaultMinQty terbaca; aturan group dipertahankan', async () => {
    await seedStickerType(env, {
      id: 'mb',
      name: 'Manual Book',
      rule: 'group',
      systemKind: 'manual_book',
      defaultMinQty: 25,
    });
    await seedStickerType(env, { id: 'biasa', name: 'Biasa' });
    const types = await listStickerTypeRecords(env.DB);
    expect(types.find((type) => type.id === 'mb')).toMatchObject({
      rule: 'group',
      systemKind: 'manual_book',
      defaultMinQty: 25,
    });
    expect(types.find((type) => type.id === 'biasa')).toMatchObject({
      rule: 'bu',
      systemKind: '',
      defaultMinQty: 0,
    });
  });

  test('dua jenis system_kind sama ditolak pada indeks sticker_types_kind_unique; dua kosong boleh', async () => {
    await seedStickerType(env, { id: 'mb1', name: 'MB 1', systemKind: 'manual_book' });
    await expect(
      seedStickerType(env, { id: 'mb2', name: 'MB 2', systemKind: 'manual_book' }),
    ).rejects.toMatchObject({ kind: 'duplicate', key: 'sticker_types_kind_unique' });
    await seedStickerType(env, { id: 'k1', name: 'K 1' });
    await seedStickerType(env, { id: 'k2', name: 'K 2' });
    await seedStickerType(env, { id: 'pt', name: 'Postel', systemKind: 'postel' });
    expect(await listStickerTypeRecords(env.DB)).toHaveLength(4);
  });
});

describe('stiker: status deprecated', () => {
  test("toSticker mempertahankan 'deprecated'; nilai tak dikenal dibaca 'active'", async () => {
    await seedStickerType(env, { id: 't1' });
    await seedSticker(env, { id: 's1', typeId: 't1', status: 'deprecated', minQty: 7 });
    await seedSticker(env, { id: 's2', typeId: 't1', status: 'inactive' });
    await seedSticker(env, { id: 's3', typeId: 't1' });
    const stickers = stickersFromResult(await stickersStatement(env.DB).all());
    const byId = new Map(stickers.map((sticker) => [sticker.id, sticker]));
    expect(byId.get('s1')).toMatchObject({ status: 'deprecated', minQty: 7 });
    expect(byId.get('s2')?.status).toBe('inactive');
    expect(byId.get('s3')?.status).toBe('active');
  });
});

describe('versi Manual Book', () => {
  const record = (stickerId: string, version: number) => ({
    stickerId,
    designId: 'q1',
    version,
    contentHash: `h${version}`,
    contentSnapshot: '{"title":"A"}',
    reason: `alasan ${version}`,
    createdAt: '2026-11-10T00:00:00.000Z',
    createdBy: 'a@x.com',
  });

  test('(design_id, version) ganda ditolak pada indeks manual_book_versions_design_version', async () => {
    await env.DB.batch([insertManualBookVersionStmt(env.DB, record('s1', 1))]);
    await expect(
      env.DB.batch([insertManualBookVersionStmt(env.DB, record('s2', 1))]),
    ).rejects.toMatchObject({ kind: 'duplicate', key: 'manual_book_versions_design_version' });
    // Konfigurasi lain boleh memakai nomor versi yang sama.
    await env.DB.batch([
      insertManualBookVersionStmt(env.DB, { ...record('s3', 1), designId: 'q2' }),
    ]);
  });

  test('listManualBookVersions terurut versi menurun dan memuat seluruh kolom', async () => {
    await seedManualBookVersion(env, { stickerId: 's1', designId: 'q1', version: 1, reason: 'r1' });
    await seedManualBookVersion(env, { stickerId: 's3', designId: 'q1', version: 3 });
    await seedManualBookVersion(env, { stickerId: 's2', designId: 'q1', version: 2 });
    await seedManualBookVersion(env, { stickerId: 'x', designId: 'q2', version: 1 });
    const versions = await listManualBookVersions(env, 'q1');
    expect(versions.map((version) => version.version)).toEqual([3, 2, 1]);
    expect(versions[2]).toMatchObject({
      stickerId: 's1',
      designId: 'q1',
      reason: 'r1',
      createdBy: 'seed',
    });
    expect(await listManualBookVersions(env, 'tidak-ada')).toEqual([]);
  });

  test('latestManualBookStickerIds memberi stiker versi tertinggi per konfigurasi', async () => {
    await seedManualBookVersion(env, { stickerId: 's1', designId: 'q1', version: 1 });
    await seedManualBookVersion(env, { stickerId: 's2', designId: 'q1', version: 2 });
    await seedManualBookVersion(env, { stickerId: 's9', designId: 'q2', version: 1 });
    await seedManualBookVersion(env, { stickerId: 's5', designId: 'q3', version: 5 });
    const latest = await latestManualBookStickerIds(env.DB, ['q1', 'q2', 'kosong', '']);
    expect(Object.fromEntries(latest)).toEqual({ q1: 's2', q2: 's9' });
    expect((await latestManualBookStickerIds(env.DB, [])).size).toBe(0);
  });
});

describe('item: penunjuk Manual Book', () => {
  test('manualBookDesignIdsOf hanya memuat item yang sudah tergabung', async () => {
    await seedItem(env, { id: 'i1', brand: 'Acme', model: 'A', manualBookDesignId: 'q1' });
    await seedItem(env, { id: 'i2', brand: 'Acme', model: 'B' });
    const map = await manualBookDesignIdsOf(env.DB, ['i1', 'i2', 'i3']);
    expect(Object.fromEntries(map)).toEqual({ i1: 'q1' });
  });
});
