import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import type { MailMessage } from '@server/core/mail';
import { putSetting } from '@server/core/settings';
import { loadUserContext } from '@server/modules/access/context';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { captureAppErrorAsync } from '@server-test/errors';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { seedPostel } from '@server-test/postel-fixtures';
import { restCall } from '@server-test/rest-call';
import { withoutOldIndex } from '@server-test/soft-delete';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { SETTING_POSTEL_ALERT } from './alert';
import { checkPostelExpiryDigest } from './digest';
import { removePostelBatch, restorePostelBatch } from './soft-delete';
import { backfillPostelStickers, pickPostelStickerName } from './stickers';

setDefaultTimeout(60_000);

// Hapus lunak dan pulihkan Postel (fase 4b; rancangan soft delete §4.3, putusan 13, 15a, T2, T5): keadaan baris dan
// nomor, penunjuk item, stiker, hak baca, keunikan nomor dan nama stiker, surel peringatan, dan pengisi stiker.

let env: TestEnv;
const realError = console.error;
let sent: MailMessage[];

const ADMIN = 'admin@gmail.com';
const EDITOR = 'stickeredit@gmail.com';
const VIEWER = 'stickerview@gmail.com';

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

beforeEach(async () => {
  sent = [];
  env = await createTestEnv({
    APP_ORIGIN: 'https://qc.test',
    MAILER: {
      async send(message) {
        sent.push(message);
      },
    },
  });
  // 10:00 WIB, 2026-11-11.
  env.clock.set(Date.parse('2026-11-11T03:00:00.000Z'));
  await seedBusinessUnit(env, { id: 'bu-umum', code: 'UMUM' });
  await seedRole(env, { id: 'r-sv', name: 'Sticker view', permissions: { sticker: 'view' } });
  await seedRole(env, {
    id: 'r-se',
    name: 'Sticker edit',
    permissions: { sticker: 'edit', item: 'view' },
  });
  await seedUser(env, { id: 'u-sv', email: VIEWER, roleIds: ['r-sv'] });
  await seedUser(env, {
    id: 'u-se',
    email: EDITOR,
    assignments: [{ locationId: null, roleIds: ['r-se'] }],
    buAssignments: [{ buId: 'bu-umum', roleIds: ['r-se'] }],
  });
  await seedBrand(env, 'PBE');
  await seedItem(env, { id: 'i1', brand: 'PBE', model: 'M5-400' });
  await seedItem(env, { id: 'i2', brand: 'PBE', model: 'M5-200' });
  await seedItem(env, { id: 'i3', brand: 'PBE', model: 'M2-300' });
  console.error = () => undefined;
});

afterEach(() => {
  console.error = realError;
});

async function call(email: string, id: string, input: unknown): Promise<CallOut> {
  return (await restCall(env, email, id, input)) as CallOut;
}

const body = (extra: Record<string, unknown> = {}) => ({
  note: 'catatan',
  itemIds: ['i1'],
  numbers: [{ number: 'SN-001', expiresOn: '2027-03-01', link: '' }],
  attachmentIds: [],
  ...extra,
});

async function create(extra: Record<string, unknown> = {}, email = EDITOR): Promise<Json> {
  const result = await call(email, 'postels.save', body(extra));
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  // Jam maju: kunci unik `_live` memuat `deleted_at`, dan versi simpanan berikutnya harus berbeda.
  env.clock.advance(1000);
  return result.data as Json;
}

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
      'SELECT s.id, s.name, s.status FROM postels p JOIN stickers s ON s.id = p.sticker_id WHERE p.id = ?',
      postelId,
    )
  )[0];

const auditCount = async (action: string): Promise<number> =>
  Number((await rows('SELECT COUNT(*) AS n FROM audit_log WHERE action = ?', action))[0]?.n);

const remove = (id: string, email = EDITOR) => call(email, 'postels.remove', { id });
const restore = (id: string, email = EDITOR) => call(email, 'postels.restore', { id });

describe('postels.remove (hapus lunak)', () => {
  test('catatan dan nomornya bertanda sama; item tetap menunjuk tetapi dihitung belum ber-Postel', async () => {
    const postel = await create({ itemIds: ['i1', 'i2'] });
    expect((await remove(postel.id)).ok).toBe(true);
    const [row] = await rows('SELECT deleted_at, deleted_by FROM postels WHERE id = ?', postel.id);
    expect(row.deleted_at).toBe('2026-11-11T03:00:01.000Z');
    expect(row.deleted_by).toBe(EDITOR);
    const numbers = await rows('SELECT deleted_at, deleted_by FROM postel_numbers');
    expect(numbers).toHaveLength(1);
    expect(numbers[0]).toEqual(row);
    expect(await rows('SELECT id FROM items WHERE postel_id = ?', postel.id)).toHaveLength(2);
    const missing = await call(ADMIN, 'items.list', { postel: 'missing', status: 'active' });
    expect(missing.data.items.map((i: Json) => i.id).sort()).toEqual(['i1', 'i2', 'i3']);
    expect(await auditCount('postel.delete')).toBe(1);
  });

  test('hanya sticker edit; hapus ulang idempoten tanpa audit baru; id tak dikenal NOT_FOUND', async () => {
    const postel = await create();
    expect((await remove(postel.id, VIEWER)).error?.code).toBe('FORBIDDEN');
    expect((await remove(postel.id)).ok).toBe(true);
    const first = (await rows('SELECT deleted_at FROM postels WHERE id = ?', postel.id))[0];
    env.clock.advance(60_000);
    expect((await remove(postel.id)).ok).toBe(true);
    expect((await rows('SELECT deleted_at FROM postels WHERE id = ?', postel.id))[0]).toEqual(
      first,
    );
    expect(await auditCount('postel.delete')).toBe(1);
    expect((await remove('tidak-ada')).error?.code).toBe('NOT_FOUND');
  });

  test('stiker catatan: stok > 0 usang, stok <= 0 tidak aktif; stok tetap', async () => {
    const withStock = await create({ itemIds: ['i1'] });
    const noStock = await create({
      itemIds: ['i2'],
      numbers: [{ number: 'SN-002', expiresOn: '2027-03-01', link: '' }],
    });
    const negative = await create({
      itemIds: ['i3'],
      numbers: [{ number: 'SN-003', expiresOn: '2027-03-01', link: '' }],
    });
    const stock = async (postelId: string, qty: number) =>
      env.DB.prepare(
        "INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES (?, 'loc', ?, '')",
      )
        .bind((await stickerOf(postelId)).id, qty)
        .run();
    await stock(withStock.id, 5);
    await stock(negative.id, -2);
    for (const postel of [withStock, noStock, negative]) {
      expect((await remove(postel.id)).ok).toBe(true);
    }
    expect((await stickerOf(withStock.id)).status).toBe('deprecated');
    expect((await stickerOf(noStock.id)).status).toBe('inactive');
    expect((await stickerOf(negative.id)).status).toBe('inactive');
    expect(Number((await rows('SELECT qty FROM sticker_stock WHERE qty > 0'))[0]?.qty)).toBe(5);
  });

  test('batch: banyak catatan dalam satu transaksi; id tak dikenal menggagalkan seluruhnya', async () => {
    const a = await create();
    const b = await create({
      itemIds: ['i2'],
      numbers: [{ number: 'SN-002', expiresOn: '2027-03-01', link: '' }],
    });
    const failed = await call(EDITOR, 'postels.removeBatch', { ids: [a.id, 'tidak-ada'] });
    expect(failed.ok).toBe(false);
    expect(await rows("SELECT id FROM postels WHERE deleted_at <> ''")).toHaveLength(0);
    const out = await call(EDITOR, 'postels.removeBatch', { ids: [b.id, a.id] });
    expect(out.data.ids).toEqual([b.id, a.id]);
    expect(await rows("SELECT id FROM postels WHERE deleted_at <> ''")).toHaveLength(2);
    expect((await call(VIEWER, 'postels.removeBatch', { ids: [a.id] })).error?.code).toBe(
      'FORBIDDEN',
    );
  });

  test('dua hapus serentak: keduanya sukses, satu audit', async () => {
    const postel = await create();
    const [x, y] = await Promise.all([remove(postel.id), remove(postel.id)]);
    expect([x.ok, y.ok]).toEqual([true, true]);
    expect(await auditCount('postel.delete')).toBe(1);
  });
});

describe('daftar dan baca catatan terhapus', () => {
  test('status=deleted hanya bagi sticker edit; daftar hidup tidak memuatnya', async () => {
    const postel = await create();
    await remove(postel.id);
    expect((await call(VIEWER, 'postels.list', { status: 'deleted' })).error?.code).toBe(
      'FORBIDDEN',
    );
    expect((await call(VIEWER, 'postels.list', null)).data.postels).toEqual([]);
    const deleted = await call(EDITOR, 'postels.list', { status: 'deleted' });
    expect(deleted.data.postels).toHaveLength(1);
    expect(deleted.data.postels[0]).toMatchObject({
      id: postel.id,
      activeNumber: 'SN-001',
      deleted: { deletedBy: EDITOR },
    });
    expect((await call(EDITOR, 'postels.list', {})).data.postels).toEqual([]);
  });

  test('get dan riwayat: terhapus hanya terbaca sticker edit, selain itu NOT_FOUND', async () => {
    const postel = await create();
    await remove(postel.id);
    expect((await call(VIEWER, 'postels.get', { id: postel.id })).error?.code).toBe('NOT_FOUND');
    expect((await call(VIEWER, 'postels.history', { id: postel.id })).error?.code).toBe(
      'NOT_FOUND',
    );
    const got = await call(EDITOR, 'postels.get', { id: postel.id });
    expect(got.data.deleted).toBeDefined();
    expect(got.data.numbers.map((n: Json) => n.number)).toEqual(['SN-001']);
    expect(got.data.items.map((i: Json) => i.id)).toEqual(['i1']);
    expect((await call(EDITOR, 'postels.history', { id: postel.id })).ok).toBe(true);
  });

  test('simpan catatan terhapus ditolak (NOT_FOUND)', async () => {
    const postel = await create();
    await remove(postel.id);
    const saved = await call(
      EDITOR,
      'postels.save',
      body({ id: postel.id, expectedUpdatedAt: postel.updatedAt }),
    );
    expect(saved.error?.code).toBe('NOT_FOUND');
  });

  test('pilihan item: item yang menunjuk catatan terhapus tampil bebas (tanpa nomor pemilik)', async () => {
    const postel = await create();
    await remove(postel.id);
    const options = await call(EDITOR, 'postels.itemOptions', {});
    const i1 = options.data.items.find((i: Json) => i.id === 'i1');
    expect(i1.postelNumber).toBe('');
  });
});

describe('postels.restore / postels.restoreBatch', () => {
  test('pulihkan: catatan dan nomor hidup lagi, item tersambung kembali, stiker menjadi tidak aktif, audit', async () => {
    const postel = await create({ itemIds: ['i1', 'i2'] });
    const sticker = await stickerOf(postel.id);
    await env.DB.prepare(
      "INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES (?, 'loc', 3, '')",
    )
      .bind(sticker.id)
      .run();
    await remove(postel.id);
    expect((await stickerOf(postel.id)).status).toBe('deprecated');
    expect((await restore(postel.id, VIEWER)).error?.code).toBe('FORBIDDEN');
    const restored = await restore(postel.id);
    expect(restored.ok).toBe(true);
    expect(restored.data).toMatchObject({ id: postel.id, itemCount: 2 });
    expect(restored.data.deleted).toBeUndefined();
    expect(restored.data.numbers.map((n: Json) => n.number)).toEqual(['SN-001']);
    expect(await rows("SELECT id FROM postels WHERE deleted_at <> ''")).toHaveLength(0);
    expect(await rows("SELECT id FROM postel_numbers WHERE deleted_at <> ''")).toHaveLength(0);
    expect((await stickerOf(postel.id)).status).toBe('inactive');
    const present = await call(ADMIN, 'items.list', { postel: 'has', status: 'active' });
    expect(present.data.items.map((i: Json) => i.id).sort()).toEqual(['i1', 'i2']);
    expect(await auditCount('postel.restore')).toBe(1);
  });

  test('pulihkan yang sudah hidup idempoten tanpa audit; id tak dikenal NOT_FOUND', async () => {
    const postel = await create();
    expect((await restore(postel.id)).ok).toBe(true);
    expect(await auditCount('postel.restore')).toBe(0);
    expect((await restore('tidak-ada')).error?.code).toBe('NOT_FOUND');
  });

  test('item yang sudah dipasang ke catatan lain tidak ikut kembali', async () => {
    const old = await create({ itemIds: ['i1', 'i2'] });
    await remove(old.id);
    // i1 dipasang ke catatan baru bernama lain (himpunan item berbeda)
    const fresh = await create({
      itemIds: ['i1', 'i3'],
      numbers: [{ number: 'SN-009', expiresOn: '2027-03-01', link: '' }],
    });
    expect((await restore(old.id)).ok).toBe(true);
    expect((await rows('SELECT postel_id FROM items WHERE id = ?', 'i1'))[0].postel_id).toBe(
      fresh.id,
    );
    expect((await rows('SELECT postel_id FROM items WHERE id = ?', 'i2'))[0].postel_id).toBe(
      old.id,
    );
  });

  test('nomor kini dipakai catatan hidup lain: CONFLICT generik; setelah dilepas dapat dipulihkan', async () => {
    const old = await create();
    await remove(old.id);
    await withoutOldIndex(env, 'postel_numbers', 'postel_numbers_key', 'number_key', async () => {
      // Nomor catatan terhapus bebas dipakai catatan baru (item i3, nama stiker berbeda).
      const taken = await call(
        EDITOR,
        'postels.save',
        body({
          itemIds: ['i3'],
          numbers: [{ number: 'SN-001', expiresOn: '2028-01-01', link: '' }],
        }),
      );
      expect(taken.error).toBeUndefined();
      expect(taken.ok).toBe(true);
      const blocked = await restore(old.id);
      expect(blocked.ok).toBe(false);
      expect(blocked.error?.code).toBe('CONFLICT');
      expect(blocked.error?.fields?.number).toBe('Nomor sertifikat sudah dipakai');
      expect(await rows("SELECT id FROM postels WHERE deleted_at <> ''")).toHaveLength(1);
      env.clock.advance(1000);
      expect((await remove(taken.data.id)).ok).toBe(true);
    });
  });

  test('pulihkan serentak dua catatan terhapus yang berbagi nomor: CONFLICT, tak ada yang berubah', async () => {
    const a = await create();
    await remove(a.id);
    await withoutOldIndex(env, 'postel_numbers', 'postel_numbers_key', 'number_key', async () => {
      const b = await call(
        EDITOR,
        'postels.save',
        body({
          itemIds: ['i3'],
          numbers: [{ number: 'SN-001', expiresOn: '2028-01-01', link: '' }],
        }),
      );
      expect(b.ok).toBe(true);
      env.clock.advance(1000);
      await remove(b.data.id);
      const out = await call(EDITOR, 'postels.restoreBatch', { ids: [a.id, b.data.id] });
      expect(out.error?.code).toBe('CONFLICT');
      expect(await rows("SELECT id FROM postels WHERE deleted_at <> ''")).toHaveLength(2);
    });
  });

  test('batch hapus dan pulihkan lewat layanan: hasil urut menurut masukan', async () => {
    const a = await create();
    const b = await create({
      itemIds: ['i2'],
      numbers: [{ number: 'SN-002', expiresOn: '2027-03-01', link: '' }],
    });
    const user = await loadUserContext(env, EDITOR);
    if (!user) throw new Error('konteks tidak ada');
    const removed = await removePostelBatch(env, { ids: [b.id, a.id] }, user);
    expect(removed.ids).toEqual([b.id, a.id]);
    const restored = await restorePostelBatch(env, { ids: [b.id, a.id] }, user);
    expect(restored.items.map((x) => x.id)).toEqual([b.id, a.id]);
  });
});

describe('nama stiker dan nomor pada catatan baru', () => {
  test('catatan baru bernama sama dengan yang masih di Terhapus: CONFLICT yang menyarankan memulihkan; yang lama dapat dipulihkan', async () => {
    const old = await create({ itemIds: ['i1'] });
    await remove(old.id);
    const again = await call(
      EDITOR,
      'postels.save',
      body({ itemIds: ['i1'], numbers: [{ number: 'SN-777', expiresOn: '2027-03-01', link: '' }] }),
    );
    expect(again.ok).toBe(false);
    expect(again.error?.code).toBe('CONFLICT');
    expect(again.error?.fields?.itemIds).toContain('pulihkan');
    expect(await rows('SELECT id FROM postels')).toHaveLength(1);
    expect((await restore(old.id)).ok).toBe(true);
  });

  test('pemilih nama tanpa hak memulihkan menjawab generik; pemegang nama hidup tetap dibedakan nomor', async () => {
    const old = await create({ itemIds: ['i1'] });
    const type = (await rows("SELECT id FROM sticker_types WHERE system_kind = 'postel'"))[0];
    await remove(old.id);
    const generic = await captureAppErrorAsync(() =>
      pickPostelStickerName(env.DB, type.id, 'M5-400', 'SN-X', '', { canRestore: false }),
    );
    expect(generic.code).toBe('CONFLICT');
    expect(generic.message).not.toContain('pulihkan');
    // tanpa kebijakan (pengisi saat start), nama itu dilewati lalu dibedakan dengan nomor Aktif
    expect(await pickPostelStickerName(env.DB, type.id, 'M5-400', 'SN-X', '')).toBe(
      'Postel - M5-400 (SN-X)',
    );
  });

  test('nomor catatan terhapus dapat dipakai catatan baru', async () => {
    const old = await create();
    await remove(old.id);
    await withoutOldIndex(env, 'postel_numbers', 'postel_numbers_key', 'number_key', async () => {
      const fresh = await call(
        EDITOR,
        'postels.save',
        body({
          itemIds: ['i3'],
          numbers: [{ number: 'SN-001', expiresOn: '2028-01-01', link: '' }],
        }),
      );
      expect(fresh.error).toBeUndefined();
      expect(fresh.ok).toBe(true);
      env.clock.advance(1000);
      await remove(fresh.data.id);
    });
  });
});

describe('surel peringatan dan pengisi stiker', () => {
  test('checkPostelExpiryDigest mengabaikan Postel terhapus', async () => {
    await putSetting(
      env,
      SETTING_POSTEL_ALERT,
      JSON.stringify({
        enabled: true,
        recipients: ['a@x.test'],
        sendHour: 8,
        thresholds: [90, 60, 30],
        repeatEveryDays: 7,
        updatedAt: '',
      }),
    );
    env.clock.set(Date.parse('2026-11-11T02:00:00.000Z'));
    const near = await create({
      numbers: [{ number: 'SN-NEAR', expiresOn: '2026-11-20', link: '' }],
    });
    await remove(near.id);
    expect(await checkPostelExpiryDigest(env)).toBe('skipped');
    expect(sent).toHaveLength(0);
    await restore(near.id);
    env.clock.advance(60_000);
    expect(await checkPostelExpiryDigest(env)).toBe('sent');
    expect(sent[0]?.text).toContain('SN-NEAR');
  });

  test('backfillPostelStickers tidak mengadopsi stiker milik Postel terhapus dan melewati catatan terhapus', async () => {
    const deleted = await create({ itemIds: ['i1'] });
    const deletedSticker = (await stickerOf(deleted.id)).id as string;
    await remove(deleted.id);
    await seedPostel(env, {
      id: 'p-legacy',
      itemIds: ['i2'],
      numbers: [{ number: 'OLD-1', expiresOn: '2027-01-01' }],
    });
    await backfillPostelStickers(env);
    const legacy = await stickerOf('p-legacy');
    expect(legacy.id).not.toBe(deletedSticker);
    // stiker milik catatan terhapus tetap miliknya, dan namanya tak diselaraskan ulang
    expect((await stickerOf(deleted.id)).id).toBe(deletedSticker);
  });

  test('catatan terhapus tanpa stiker tidak mendapat stiker dari pengisi', async () => {
    await seedPostel(env, {
      id: 'p-gone',
      itemIds: ['i3'],
      numbers: [{ number: 'GONE-1', expiresOn: '2027-01-01' }],
    });
    await env.DB.prepare(
      "UPDATE postels SET deleted_at = '2026-11-10T00:00:00.000Z', deleted_by = 'x' WHERE id = 'p-gone'",
    ).run();
    await backfillPostelStickers(env);
    expect(
      (await rows('SELECT sticker_id FROM postels WHERE id = ?', 'p-gone'))[0].sticker_id,
    ).toBe(null);
  });
});
