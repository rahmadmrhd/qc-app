import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { loadUserContext, type UserContext } from '@server/modules/access/context';
import { setStickerStatus } from '@server/modules/sticker/service';
import { validateSetStickerStatus } from '@server/modules/sticker/validate';
import { captureAppErrorAsync } from '@server-test/errors';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { seedPostel } from '@server-test/postel-fixtures';
import { restCall } from '@server-test/rest-call';
import { seedSticker, seedStickerType } from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { backfillPostelStickers } from './stickers';

// Stiker per catatan Postel (keputusan pemilik 2026-11-12): lahir bersama catatan, bernama `Postel - <nama>`, ikut nama
// turunan, dipensiunkan saat catatan dihapus, dan diisi untuk catatan lama oleh `backfillPostelStickers`.

setDefaultTimeout(60_000);

let env: TestEnv;
let admin: UserContext;

const ADMIN = 'admin@gmail.com';

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

async function call(id: string, input: unknown): Promise<CallOut> {
  return (await restCall(env, ADMIN, id, input)) as CallOut;
}

const body = (itemIds: string[], numbers: string[]) => ({
  note: '',
  itemIds,
  numbers: numbers.map((number) => ({ number, expiresOn: '2027-03-01', link: '' })),
  attachmentIds: [],
});

async function rows(sql: string, ...binds: unknown[]): Promise<Json[]> {
  return (
    await env.DB.prepare(sql)
      .bind(...binds)
      .all<Json>()
  ).results;
}

const stickerOf = async (postelId: string): Promise<Json> =>
  (
    await rows(
      'SELECT s.id, s.name, s.status, s.min_qty, t.system_kind FROM postels p JOIN stickers s ON s.id = p.sticker_id JOIN sticker_types t ON t.id = s.type_id WHERE p.id = ?',
      postelId,
    )
  )[0];

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
  const ctx = await loadUserContext(env, ADMIN);
  if (!ctx) throw new Error('admin hilang');
  admin = ctx;
  await seedBrand(env, 'PBE');
  await seedBrand(env, 'UBI');
  await seedItem(env, { id: 'i1', brand: 'PBE', model: 'M5-400' });
  await seedItem(env, { id: 'i2', brand: 'PBE', model: 'M5-200' });
  await seedItem(env, { id: 'i3', brand: 'PBE', model: 'AC-100' });
  await seedItem(env, { id: 'i4', brand: 'UBI', model: 'AC-100' });
});

describe('stiker lahir bersama catatan', () => {
  test('catatan baru: satu stiker jenis postel bernama Postel - <nama turunan>, aktif, tertaut di postels.sticker_id', async () => {
    const saved = (await call('postels.save', body(['i1', 'i2'], ['A-1']))).data as Json;
    const sticker = await stickerOf(saved.id);
    expect(sticker).toMatchObject({
      name: 'Postel - M5-200/400',
      status: 'active',
      system_kind: 'postel',
    });
    expect(await rows('SELECT id FROM stickers')).toHaveLength(1);
  });

  test('dua catatan = dua stiker pada satu jenis, masing-masing miliknya', async () => {
    const a = (await call('postels.save', body(['i1'], ['A-1']))).data as Json;
    const b = (await call('postels.save', body(['i3'], ['B-1']))).data as Json;
    const [stickerA, stickerB] = [await stickerOf(a.id), await stickerOf(b.id)];
    expect(stickerA.id).not.toBe(stickerB.id);
    expect(stickerA.name).toBe('Postel - M5-400');
    expect(stickerB.name).toBe('Postel - AC-100');
    expect(await rows("SELECT id FROM sticker_types WHERE system_kind = 'postel'")).toHaveLength(1);
  });

  test('simpan gagal (item direbut catatan lain): tidak meninggalkan stiker yatim', async () => {
    await call('postels.save', body(['i1'], ['A-1']));
    const failed = await call('postels.save', body(['i1'], ['B-1']));
    expect(failed.ok).toBe(false);
    expect(await rows('SELECT id FROM stickers')).toHaveLength(1);
  });

  test('nama bentrok (model sama, merk beda): yang kedua dibedakan dengan nomor Aktif', async () => {
    const a = (await call('postels.save', body(['i3'], ['AC-A']))).data as Json;
    const b = (await call('postels.save', body(['i4'], ['AC-B']))).data as Json;
    expect((await stickerOf(a.id)).name).toBe('Postel - AC-100');
    expect((await stickerOf(b.id)).name).toBe('Postel - AC-100 (AC-B)');
  });
});

describe('nama stiker mengikuti nama Postel', () => {
  test('menambah item mengganti nama stiker di katalog (id sama, stok tetap)', async () => {
    const created = (await call('postels.save', body(['i1'], ['A-1']))).data as Json;
    const before = await stickerOf(created.id);
    env.clock.advance(1000);
    const saved = await call('postels.save', {
      ...body(['i1', 'i2'], ['A-1']),
      id: created.id,
      expectedUpdatedAt: created.updatedAt,
      numbers: [{ id: created.numbers[0].id, number: 'A-1', expiresOn: '2027-03-01', link: '' }],
    });
    expect(saved.ok).toBe(true);
    const after = await stickerOf(created.id);
    expect(after.id).toBe(before.id);
    expect(after.name).toBe('Postel - M5-200/400');
  });
});

describe('catatan dihapus', () => {
  test('stok 0: stiker inactive; tidak dapat diaktifkan kembali', async () => {
    const created = (await call('postels.save', body(['i1'], ['A-1']))).data as Json;
    const sticker = await stickerOf(created.id);
    expect((await call('postels.remove', { id: created.id })).ok).toBe(true);
    const [after] = await rows('SELECT status FROM stickers WHERE id = ?', sticker.id);
    expect(after.status).toBe('inactive');
    const error = await captureAppErrorAsync(() =>
      setStickerStatus(env, validateSetStickerStatus({ id: sticker.id, status: 'active' }), admin),
    );
    expect(error.code).toBe('VALIDATION');
    expect(error.message).toContain('sudah dihapus');
  });

  test('masih berstok: stiker deprecated dan stoknya tetap', async () => {
    const created = (await call('postels.save', body(['i1'], ['A-1']))).data as Json;
    const sticker = await stickerOf(created.id);
    await env.DB.prepare(
      "INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES (?, 'loc', 5, ?)",
    )
      .bind(sticker.id, '2026-11-12T00:00:00.000Z')
      .run();
    expect((await call('postels.remove', { id: created.id })).ok).toBe(true);
    const [after] = await rows('SELECT status FROM stickers WHERE id = ?', sticker.id);
    expect(after.status).toBe('deprecated');
    const [stock] = await rows('SELECT qty FROM sticker_stock WHERE sticker_id = ?', sticker.id);
    expect(Number(stock.qty)).toBe(5);
  });
});

describe('backfillPostelStickers', () => {
  async function seedLegacy() {
    await seedStickerType(env, {
      id: 't-pos',
      name: 'Postel',
      rule: 'group',
      systemKind: 'postel',
    });
    await seedSticker(env, { id: 's-legacy', typeId: 't-pos', name: 'Postel' });
    await env.DB.prepare(
      "INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES ('s-legacy', 'loc', 9, ?)",
    )
      .bind('2026-11-12T00:00:00.000Z')
      .run();
    await seedPostel(env, {
      id: 'p-old',
      itemIds: ['i1'],
      numbers: [{ number: 'OLD-1', expiresOn: '2027-01-01' }],
    });
    await seedPostel(env, {
      id: 'p-new',
      itemIds: ['i3'],
      numbers: [{ number: 'NEW-1', expiresOn: '2027-01-01' }],
    });
    await env.DB.prepare(
      "UPDATE postels SET created_at = '2026-11-10T00:00:00.000Z' WHERE id = 'p-old'",
    ).run();
    await env.DB.prepare(
      "UPDATE postels SET created_at = '2026-11-11T00:00:00.000Z' WHERE id = 'p-new'",
    ).run();
  }

  test('stiker bersama lama diadopsi catatan tertua beserta stok; catatan lain mendapat stiker baru berstok 0', async () => {
    await seedLegacy();
    await backfillPostelStickers(env);
    const old = await stickerOf('p-old');
    const fresh = await stickerOf('p-new');
    expect(old.id).toBe('s-legacy');
    expect(old.name).toBe('Postel - M5-400');
    expect(fresh.id).not.toBe('s-legacy');
    expect(fresh.name).toBe('Postel - AC-100');
    const stock = await rows('SELECT sticker_id, qty FROM sticker_stock');
    expect(stock).toHaveLength(1);
    expect(stock[0].sticker_id).toBe('s-legacy');
  });

  test('idempoten: pemanggilan kedua tidak mengubah apa pun', async () => {
    await seedLegacy();
    await backfillPostelStickers(env);
    const first = await rows('SELECT id, name, updated_at FROM stickers ORDER BY id');
    env.clock.advance(60_000);
    await backfillPostelStickers(env);
    expect(await rows('SELECT id, name, updated_at FROM stickers ORDER BY id')).toEqual(first);
  });

  test('tanpa catatan: tidak membuat jenis atau stiker', async () => {
    await backfillPostelStickers(env);
    expect(await rows('SELECT id FROM sticker_types')).toHaveLength(0);
  });

  test('menyamakan nama stiker yang sudah tertaut dengan nama turunan terkini', async () => {
    await seedStickerType(env, {
      id: 't-pos',
      name: 'Postel',
      rule: 'group',
      systemKind: 'postel',
    });
    await seedSticker(env, { id: 's-1', typeId: 't-pos', name: 'Postel - nama lama' });
    await seedPostel(env, {
      id: 'p-1',
      stickerId: 's-1',
      itemIds: ['i1', 'i2'],
      numbers: [{ number: 'X-1', expiresOn: '2027-01-01' }],
    });
    await backfillPostelStickers(env);
    expect((await stickerOf('p-1')).name).toBe('Postel - M5-200/400');
  });
});
