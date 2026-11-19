// `serials.stickerOptions` dengan `serialId` (cek ulang serial yang sudah ada): syarat item aktif/terlihat dilewati hanya
// bila serial bertipe item yang diminta dan BU yang diminta sah sebagai tujuan cek ulang (spek serial unik se-sistem §5.1).
import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { restCall } from '@server-test/rest-call';
import { SERIAL_USERS, seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;
const W = SERIAL_USERS.writer; // serial: edit di BU A saja
const BOTH = SERIAL_USERS.both; // serial: edit di BU A dan B

const options = async (email: string, input: Record<string, unknown>): Promise<CallOut> =>
  (await restCall(env, email, 'serials.stickerOptions', input)) as CallOut;

beforeEach(async () => {
  env = await createTestEnv();
  await seedSerialWorld(env);
});

describe('jalur cek ulang melewati syarat item aktif/terlihat', () => {
  test('item nonaktif: tanpa serialId NOT_FOUND, dengan serial bertipe item itu di BU saat ini berhasil', async () => {
    await seedSerial(env, { id: 'sn-off', serial: 'OFF-1', itemId: 'i-off' });
    // Item nonaktif ini punya instruksi stiker (dunia uji hanya memberinya ke i-a1/i-a2).
    await env.DB.prepare(
      "INSERT INTO item_sticker_photos (item_id, guide_id, caption, bu_id, `position`) VALUES ('i-off', 'g1', '', '', 0)",
    ).run();
    await env.DB.prepare(
      "INSERT INTO item_sticker_marks (item_id, guide_id, `position`, x, y, sticker_id, type_id, note) VALUES ('i-off', 'g1', 0, 1, 1, 's1', '', '')",
    ).run();
    const plain = await options(W, { itemId: 'i-off', buId: 'bu-a' });
    expect(plain.error?.code).toBe('NOT_FOUND');
    const viaSerial = await options(W, { itemId: 'i-off', buId: 'bu-a', serialId: 'sn-off' });
    expect(viaSerial.ok).toBe(true);
    expect(viaSerial.data.stickers.map((s: Json) => s.id)).toEqual(['s1']);
  });

  test('item di luar cakupan item pengguna dan BU tujuan yang belum pernah terlibat: berhasil', async () => {
    // i-b hanya di BU B: tak terlihat bagi pencatat BU A. Serial itu kini di BU B; BU A belum pernah terlibat.
    await seedSerial(env, { id: 'sn-b', serial: 'BB-1', buId: 'bu-b', itemId: 'i-b' });
    expect((await options(W, { itemId: 'i-b', buId: 'bu-a' })).error?.code).toBe('NOT_FOUND');
    const viaSerial = await options(W, { itemId: 'i-b', buId: 'bu-a', serialId: 'sn-b' });
    expect(viaSerial.ok).toBe(true);
  });
});

describe('penolakan: perilaku lama (NOT_FOUND) dengan jawaban seragam', () => {
  const NOT_FOUND = { code: 'NOT_FOUND', message: 'Item tidak ditemukan' };
  const expectRejected = (out: CallOut) => {
    expect(out.ok).toBe(false);
    expect({ code: out.error?.code, message: out.error?.message }).toEqual(NOT_FOUND);
  };

  beforeEach(async () => {
    await seedSerial(env, { id: 'sn-off', serial: 'OFF-1', itemId: 'i-off' });
    await seedSerial(env, { id: 'sn-b', serial: 'BB-1', buId: 'bu-b', itemId: 'i-b' });
  });

  test('serial milik item lain', async () => {
    expectRejected(await options(W, { itemId: 'i-off', buId: 'bu-a', serialId: 'sn-b' }));
    // item yang diminta tidak sama dengan item catatan walau keduanya nonaktif/tak terlihat
    expectRejected(await options(W, { itemId: 'i-b', buId: 'bu-a', serialId: 'sn-off' }));
  });

  test('serial tidak ada', async () => {
    expectRejected(await options(W, { itemId: 'i-off', buId: 'bu-a', serialId: 'tidak-ada' }));
  });

  test('BU tanpa hak tulis (hanya baca atau tak ditugaskan)', async () => {
    // WRITER tidak punya hak di BU B; MIXED hanya membaca BU B.
    expectRejected(await options(W, { itemId: 'i-b', buId: 'bu-b', serialId: 'sn-b' }));
    expectRejected(
      await options(SERIAL_USERS.mixed, { itemId: 'i-b', buId: 'bu-b', serialId: 'sn-b' }),
    );
  });

  test('BU yang pernah ditinggalkan', async () => {
    // sn-b kini di BU B dan pernah di BU A (ditinggalkan): BU A tidak boleh dimasuki lagi.
    await env.DB.prepare(
      "INSERT INTO serial_business_units (serial_id, bu_id, first_at, left_at) VALUES ('sn-b', 'bu-a', '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z')",
    ).run();
    expectRejected(await options(W, { itemId: 'i-b', buId: 'bu-a', serialId: 'sn-b' }));
  });

  test('BU tujuan nonaktif (bukan BU saat ini); BU saat ini nonaktif tetap diizinkan', async () => {
    await env.DB.prepare("UPDATE business_units SET status = 'inactive' WHERE id = 'bu-b'").run();
    // tujuan = BU B (nonaktif) untuk serial BU A: ditolak
    expectRejected(await options(BOTH, { itemId: 'i-off', buId: 'bu-b', serialId: 'sn-off' }));
    // BU saat ini serial (BU B) nonaktif: cek ulang di BU saat ini tetap diizinkan server
    const current = await options(BOTH, { itemId: 'i-b', buId: 'bu-b', serialId: 'sn-b' });
    expect(current.ok).toBe(true);
  });

  test('tanpa serialId, perilaku lama tidak berubah; serialId kosong dianggap tidak ada', async () => {
    expectRejected(await options(W, { itemId: 'i-off', buId: 'bu-a' }));
    expectRejected(await options(W, { itemId: 'i-off', buId: 'bu-a', serialId: '' }));
  });
});
