// Mencatat serial yang sudah ada lewat Catat = cek ulang lolos pada catatan itu (spek serial unik se-sistem §5.1, §5.4).
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedBusinessUnit, seedUser } from '@server-test/access-fixtures';
import { restCall } from '@server-test/rest-call';
import { SERIAL_USERS, seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { moveBuStatements } from './bu-history';
import { loadSerialRowBySerial } from './repo';

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;
const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

const W = SERIAL_USERS.writer; // serial: edit di BU A
const BOTH = SERIAL_USERS.both; // serial: edit di BU A dan B
const B_ONLY = 'hanya-b@gmail.com'; // serial: edit di BU B

let counter = 0;
const cid = () => `cid${String(++counter).padStart(8, '0')}-0000-4000-8000-000000000000`;

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientId: cid(),
    serial: 'AB12',
    itemId: 'i-a1',
    buId: 'bu-a',
    testDate: '2026-11-13',
    locationId: 'loc-sby',
    sample: false,
    note: '',
    stickers: [],
    ...overrides,
  };
}
const save = (email: string, rows: Record<string, unknown>[]) =>
  call(email, 'serials.saveBatch', { rows });
const resultsOf = (out: CallOut): Json[] => (out.data as Json).results;

const stockOf = async (stickerId: string, location = 'loc-sby'): Promise<number> =>
  Number(
    (
      await env.DB.prepare('SELECT qty FROM sticker_stock WHERE sticker_id = ? AND location_id = ?')
        .bind(stickerId, location)
        .first<{ qty: number | string }>()
    )?.qty ?? 0,
  );
const count = async (table: string): Promise<number> =>
  Number(
    (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number | string }>())
      ?.n ?? 0,
  );
const serialRow = (id: string) =>
  env.DB.prepare('SELECT bu_id, location_id, test_date, note, status FROM serials WHERE id = ?')
    .bind(id)
    .first<{
      bu_id: string;
      location_id: string;
      test_date: string;
      note: string;
      status: string;
    }>();
const eventsOf = (id: string) =>
  env.DB.prepare(
    'SELECT seq, type, occurred_on, message, changes_json, data_json, client_id FROM serial_events WHERE serial_id = ? ORDER BY seq',
  )
    .bind(id)
    .all<{
      seq: number;
      type: string;
      occurred_on: string;
      message: string;
      changes_json: string;
      data_json: string;
      client_id: string | null;
    }>()
    .then((r) => r.results);

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-14T03:00:00.000Z'));
  await seedSerialWorld(env);
  await seedUser(env, {
    id: 'u-b-only',
    email: B_ONLY,
    buAssignments: [{ buId: 'bu-b', roleIds: ['r-edit'] }],
  });
  await env.DB.prepare(
    "INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES ('s1', 'loc-sby', 10, ''), ('s2', 'loc-sby', 5, ''), ('s1', 'loc-jkt', 10, '')",
  ).run();
  await seedSerial(env, {
    id: 'sn1',
    serial: 'AB12',
    buId: 'bu-a',
    itemId: 'i-a2',
    note: 'catatan lama',
    testDate: '2026-11-12',
  });
});

describe('serial baru', () => {
  test('serial yang belum ada tetap created', async () => {
    const out = await save(W, [row({ serial: 'BARU-1', itemId: 'i-a1' })]);
    expect(resultsOf(out)[0]).toMatchObject({ result: 'created', serial: 'BARU-1' });
    expect(await count('serials')).toBe(2);
  });
});

describe('serial yang sudah ada di BU yang sama', () => {
  test('rechecked: kejadian recheck, test_date tak berubah, lokasi pindah, hanya stiker tercentang memotong stok', async () => {
    const out = await save(W, [
      row({
        itemId: 'i-a2',
        serial: 'ab12',
        locationId: 'loc-jkt',
        note: 'cek lagi',
        sample: true,
        stickers: [{ stickerId: 's1', qty: 3 }],
      }),
    ]);
    expect(resultsOf(out)[0]).toMatchObject({ result: 'rechecked', id: 'sn1', serial: 'AB12' });
    const stored = await serialRow('sn1');
    expect(stored).toMatchObject({
      bu_id: 'bu-a',
      location_id: 'loc-jkt',
      test_date: '2026-11-12',
      note: 'catatan lama',
      status: 'good',
    });
    const events = await eventsOf('sn1');
    expect(events.map((e) => [e.seq, e.type])).toEqual([
      [1, 'recorded'],
      [2, 'recheck'],
    ]);
    expect(events[1]).toMatchObject({ occurred_on: '2026-11-13', message: 'cek lagi' });
    const data = JSON.parse(events[1]?.data_json ?? '{}');
    expect(data).toMatchObject({ result: 'pass', locationId: 'loc-jkt', locationName: 'Jakarta' });
    expect(data.bu).toBeUndefined();
    expect(data.stickers).toEqual([{ stickerId: 's1', name: 'Segel A', qtyFrom: 0, qtyTo: 1 }]);
    const fields = JSON.parse(events[1]?.changes_json ?? '[]').map((c: Json) => c.field);
    expect(fields).toEqual(['location', 'stickers']);
    // Tiap stiker tercentang bertambah SATU (bukan qty baris) dan memotong stok satu di lokasi cek ulang.
    expect(await stockOf('s1', 'loc-jkt')).toBe(9);
    expect(await stockOf('s1')).toBe(10);
    expect(await stockOf('s2', 'loc-jkt')).toBe(0);
    expect(await count('serials')).toBe(1);
  });

  test('stiker tidak dikirim (klien lama, impor) = tidak ada yang tercentang', async () => {
    const out = await save(W, [row({ itemId: 'i-a2', stickers: undefined })]);
    expect(resultsOf(out)[0]).toMatchObject({ result: 'rechecked' });
    expect(await stockOf('s1')).toBe(10);
    expect(await count('serial_stickers')).toBe(0);
  });

  test('kirim ulang baris yang sama (clientId sama): rechecked dengan id sama, tanpa kejadian dan stok ganda', async () => {
    const same = row({ itemId: 'i-a2', stickers: [{ stickerId: 's1', qty: 1 }] });
    const first = resultsOf(await save(W, [same]))[0];
    const again = resultsOf(await save(W, [same]))[0];
    expect(first).toMatchObject({ result: 'rechecked', id: 'sn1' });
    expect(again).toMatchObject({ result: 'rechecked', id: 'sn1' });
    expect((await eventsOf('sn1')).length).toBe(2);
    expect(await stockOf('s1')).toBe(9);
  });

  test('dua pengiriman serentak untuk serial yang sama: keduanya rechecked, tiap stok dipotong sekali', async () => {
    const outs = await Promise.all([
      save(W, [row({ itemId: 'i-a2', stickers: [{ stickerId: 's1', qty: 1 }] })]),
      save(W, [row({ itemId: 'i-a2', stickers: [{ stickerId: 's1', qty: 1 }] })]),
    ]);
    expect(outs.flatMap(resultsOf).map((r) => r.result)).toEqual(['rechecked', 'rechecked']);
    expect((await eventsOf('sn1')).map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(await stockOf('s1')).toBe(8);
  });
});

describe('pindah BU lewat cek ulang', () => {
  test('BU yang belum pernah terlibat: rechecked dan pindah (baris penghubung, left_at, data.bu)', async () => {
    const out = await save(BOTH, [
      row({
        itemId: 'i-a2',
        buId: 'bu-b',
        stickers: [{ stickerId: 's1', qty: 1 }],
      }),
    ]);
    expect(resultsOf(out)[0]).toMatchObject({ result: 'rechecked', id: 'sn1' });
    expect((await serialRow('sn1'))?.bu_id).toBe('bu-b');
    const history = await env.DB.prepare(
      'SELECT bu_id, left_at FROM serial_business_units WHERE serial_id = ? ORDER BY bu_id',
    )
      .bind('sn1')
      .all<{ bu_id: string; left_at: string }>();
    expect(history.results.map((r) => [r.bu_id, r.left_at !== ''])).toEqual([
      ['bu-a', true],
      ['bu-b', false],
    ]);
    const data = JSON.parse((await eventsOf('sn1'))[1]?.data_json ?? '{}');
    expect(data.bu).toEqual({ fromId: 'bu-a', fromCode: 'A', toId: 'bu-b', toCode: 'B' });
    // Pencatat tidak harus berhak di BU asal.
    const other = await save(B_ONLY, [row({ serial: 'ab12', itemId: 'i-a2', buId: 'bu-b' })]);
    expect(resultsOf(other)[0]).toMatchObject({ result: 'rechecked', id: 'sn1' });
  });

  test('pencatat hanya berhak di BU B boleh memindahkan serial BU A ke B (hak BU asal tidak perlu)', async () => {
    const out = await save(B_ONLY, [row({ itemId: 'i-a2', buId: 'bu-b' })]);
    expect(resultsOf(out)[0]).toMatchObject({ result: 'rechecked' });
    expect((await serialRow('sn1'))?.bu_id).toBe('bu-b');
  });

  test('kiriman ulang baris Catat (clientId sama) tetap dikenali setelah serialnya dipindah BU oleh orang lain', async () => {
    // Baris baru (serial belum ada) tercatat di BU A; respons hilang; orang lain memindahkannya ke BU B; kiriman ulang.
    const fresh = row({ serial: 'NEW-REPLAY', itemId: 'i-a2' });
    const first = resultsOf(await save(W, [fresh]))[0];
    expect(first).toMatchObject({ result: 'created' });
    await env.DB.batch(
      moveBuStatements(env, {
        serialId: first.id,
        fromBuId: 'bu-a',
        toBuId: 'bu-b',
        now: '2026-11-13T00:00:00.000Z',
      }),
    );
    const events = await count('serial_events');
    const again = resultsOf(await save(W, [fresh]))[0];
    expect(again).toMatchObject({ result: 'created', id: first.id });
    expect(await count('serial_events')).toBe(events);
    // clientId sama dengan nomor serial berbeda tetap ditolak.
    const other = resultsOf(await save(W, [{ ...fresh, serial: 'LAIN-123' }]))[0];
    expect(other).toMatchObject({ result: 'invalid' });
  });

  test('BU yang pernah ditinggalkan (A lalu B lalu A) ditolak tanpa mengubah apa pun', async () => {
    await env.DB.batch(
      moveBuStatements(env, {
        serialId: 'sn1',
        fromBuId: 'bu-a',
        toBuId: 'bu-b',
        now: '2026-11-13T00:00:00.000Z',
      }),
    );
    const before = await count('serial_events');
    const out = await save(BOTH, [row({ itemId: 'i-a2', buId: 'bu-a' })]);
    expect(resultsOf(out)[0]).toMatchObject({ result: 'invalid' });
    expect((await serialRow('sn1'))?.bu_id).toBe('bu-b');
    expect(await count('serial_events')).toBe(before);
    // BU saat ini (B) tetap boleh.
    const stay = await save(BOTH, [row({ itemId: 'i-a2', buId: 'bu-b' })]);
    expect(resultsOf(stay)[0]).toMatchObject({ result: 'rechecked' });
  });

  test('stiker pada cek ulang berlaku menurut BU target dan memotong stok di lokasi baris', async () => {
    // Penanda jenis (bukan stiker tertentu) pada i-a2: jenis berkaidah `bu`, stiker s1 hanya tertaut ke BU A.
    await env.DB.prepare("DELETE FROM item_sticker_marks WHERE item_id = 'i-a2'").run();
    await env.DB.prepare(
      "INSERT INTO item_sticker_marks (item_id, guide_id, `position`, x, y, sticker_id, type_id, note) VALUES ('i-a2', 'g1', 0, 1, 1, '', 't1', '')",
    ).run();
    await env.DB.prepare("UPDATE sticker_types SET rule = 'bu' WHERE id = 't1'").run();
    await env.DB.prepare(
      "INSERT INTO sticker_business_units (sticker_id, bu_id) VALUES ('s1', 'bu-a')",
    ).run();
    const bad = await save(BOTH, [
      row({ itemId: 'i-a2', buId: 'bu-b', stickers: [{ stickerId: 's1', qty: 1 }] }),
    ]);
    expect(resultsOf(bad)[0]).toMatchObject({ result: 'invalid' });
    expect((await serialRow('sn1'))?.bu_id).toBe('bu-a');
    expect(await stockOf('s1')).toBe(10);
    const good = await save(BOTH, [
      row({ itemId: 'i-a2', buId: 'bu-a', stickers: [{ stickerId: 's1', qty: 1 }] }),
    ]);
    expect(resultsOf(good)[0]).toMatchObject({ result: 'rechecked' });
    expect(await stockOf('s1')).toBe(9);
  });

  test('BU target nonaktif ditolak', async () => {
    await env.DB.prepare("UPDATE business_units SET status = 'inactive' WHERE id = 'bu-b'").run();
    const out = await save(BOTH, [row({ itemId: 'i-a2', buId: 'bu-b' })]);
    // Pesan khusus BU (bukan "Item tidak ditemukan..."): BU yang nonaktif tidak bisa dipilih.
    expect(resultsOf(out)[0]).toMatchObject({
      result: 'invalid',
      message: 'BU ini tidak bisa dipilih untuk Serial Number yang sudah ada',
    });
    expect((await serialRow('sn1'))?.bu_id).toBe('bu-a');
  });
});

describe('penolakan', () => {
  test('laporan aktif ditolak di BU saat ini maupun BU lain', async () => {
    await env.DB.prepare('DELETE FROM serial_events').run();
    await env.DB.prepare('DELETE FROM serials').run();
    await seedSerial(env, {
      id: 'sn1',
      serial: 'AB12',
      status: 'reported',
      itemId: 'i-a2',
      openCase: { id: 'c1', number: 'LP/A/2611-0001' },
    });
    for (const [email, buId] of [
      [W, 'bu-a'],
      [BOTH, 'bu-b'],
    ] as const) {
      const out = await save(email, [row({ itemId: 'i-a2', buId })]);
      expect(resultsOf(out)[0]).toMatchObject({
        result: 'invalid',
        message: 'Serial ini sedang ada laporan aktif; selesaikan lewat halaman laporannya.',
      });
    }
    expect(await count('serial_events')).toBe(1);
  });

  test('serial Rusak ditolak di semua BU', async () => {
    await env.DB.prepare("UPDATE serials SET status = 'broken' WHERE id = 'sn1'").run();
    for (const [email, buId] of [
      [W, 'bu-a'],
      [BOTH, 'bu-b'],
    ] as const) {
      const out = await save(email, [row({ itemId: 'i-a2', buId })]);
      expect(resultsOf(out)[0]).toMatchObject({
        result: 'invalid',
        message: 'Unit ini sudah dinyatakan rusak.',
      });
    }
    expect(await count('serial_events')).toBe(1);
  });

  test('item beda ditolak dengan menyebut item catatan; item tidak diubah', async () => {
    const out = await save(W, [row({ itemId: 'i-a1' })]);
    expect(resultsOf(out)[0].result).toBe('invalid');
    expect(resultsOf(out)[0].message).toContain('Merk Beta');
    expect(
      (await env.DB.prepare('SELECT item_id FROM serials').first<{ item_id: string }>())?.item_id,
    ).toBe('i-a2');
  });

  test('syarat item aktif/terlihat TIDAK berlaku: item catatan nonaktif tetap dapat dicek ulang', async () => {
    await env.DB.prepare("UPDATE items SET status = 'inactive' WHERE id = 'i-a2'").run();
    const out = await save(W, [row({ itemId: 'i-a2' })]);
    expect(resultsOf(out)[0]).toMatchObject({ result: 'rechecked' });
  });

  test('item wajib foto tanpa foto cukup: invalid', async () => {
    await env.DB.prepare(
      "UPDATE items SET proof_required = 1, proof_min = 2 WHERE id = 'i-a2'",
    ).run();
    const out = await save(W, [row({ itemId: 'i-a2' })]);
    expect(resultsOf(out)[0]).toMatchObject({
      result: 'invalid',
      message: 'Item ini wajib foto bukti minimal 2',
    });
    expect(await count('serial_events')).toBe(1);
  });

  test('pengguna tanpa hak di BU target: invalid generik, tanpa efek', async () => {
    const out = await save(W, [row({ itemId: 'i-a2', buId: 'bu-b' })]);
    expect(resultsOf(out)[0]).toMatchObject({
      result: 'invalid',
      message: 'Item tidak ditemukan atau tidak bisa dipakai',
    });
    expect(await count('serial_events')).toBe(1);
  });

  test('lokasi tak aktif/tak dikenal ditolak', async () => {
    const out = await save(W, [row({ itemId: 'i-a2', locationId: 'tidak-ada' })]);
    expect(resultsOf(out)[0]).toMatchObject({
      result: 'invalid',
      message: 'Lokasi tidak ditemukan',
    });
  });
});

describe('serial baru yang sama dicatat serentak dari dua BU', () => {
  test('tepat satu created, yang lain rechecked; tiap entri memotong stok satu kali', async () => {
    const outs = await Promise.all([
      save(W, [row({ serial: 'RACE-1', itemId: 'i-a2', stickers: [{ stickerId: 's1', qty: 1 }] })]),
      save(BOTH, [
        row({
          serial: 'RACE-1',
          itemId: 'i-a2',
          buId: 'bu-b',
          stickers: [{ stickerId: 's1', qty: 1 }],
        }),
      ]),
    ]);
    const results = outs.flatMap(resultsOf).map((r) => r.result);
    expect(results.filter((r) => r === 'created')).toHaveLength(1);
    expect(results.filter((r) => r === 'rechecked' || r === 'duplicate')).toHaveLength(1);
    const serial = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM serials WHERE serial = 'RACE-1'",
    ).first<{
      n: number | string;
    }>();
    expect(Number(serial?.n)).toBe(1);
    // Stok: created memotong 1; rechecked (bila terjadi) memotong 1.
    const rechecked = results.includes('rechecked');
    expect(await stockOf('s1')).toBe(10 - (rechecked ? 2 : 1));
  });
});

describe('serials.lookupMany', () => {
  test('mengembalikan hanya item, BU saat ini, status, laporan aktif, aturan foto, dan BU kandidat', async () => {
    await env.DB.prepare(
      "UPDATE items SET proof_required = 1, proof_min = 3 WHERE id = 'i-a2'",
    ).run();
    const out = await call(BOTH, 'serials.lookupMany', { serials: ['ab12', 'TIDAK-ADA', 'AB12'] });
    expect(out.ok).toBe(true);
    expect(out.data.found).toEqual([
      {
        serial: 'AB12',
        id: 'sn1',
        itemId: 'i-a2',
        itemLabel: 'Merk Beta',
        buId: 'bu-a',
        buCode: 'A',
        status: 'good',
        hasOpenCase: false,
        proofRequired: true,
        proofMin: 3,
        recheckBuIds: ['bu-a', 'bu-b'],
      },
    ]);
  });

  test('kandidat BU memperhitungkan riwayat dan hak tulis pengguna', async () => {
    await env.DB.batch(
      moveBuStatements(env, {
        serialId: 'sn1',
        fromBuId: 'bu-a',
        toBuId: 'bu-b',
        now: '2026-11-13T00:00:00.000Z',
      }),
    );
    const both = await call(BOTH, 'serials.lookupMany', { serials: ['AB12'] });
    expect(both.data.found[0]).toMatchObject({ buId: 'bu-b', recheckBuIds: ['bu-b'] });
    // BU A pernah ditinggalkan: pencatat hanya-A tidak punya kandidat, tetapi tetap mengetahui keberadaannya.
    const writer = await call(W, 'serials.lookupMany', { serials: ['AB12'] });
    expect(writer.data.found[0]).toMatchObject({ buCode: 'B', recheckBuIds: [] });
    const bOnly = await call(B_ONLY, 'serials.lookupMany', { serials: ['AB12'] });
    expect(bOnly.data.found[0].recheckBuIds).toEqual(['bu-b']);
  });

  test('BU nonaktif tidak termasuk recheckBuIds; BU saat ini tetap termasuk walau nonaktif', async () => {
    await env.DB.prepare("UPDATE business_units SET status = 'inactive' WHERE id = 'bu-b'").run();
    const out = await call(BOTH, 'serials.lookupMany', { serials: ['AB12'] });
    expect(out.data.found[0].recheckBuIds).toEqual(['bu-a']);
    await env.DB.prepare("UPDATE business_units SET status = 'inactive' WHERE id = 'bu-a'").run();
    await env.DB.prepare("UPDATE business_units SET status = 'active' WHERE id = 'bu-b'").run();
    const again = await call(BOTH, 'serials.lookupMany', { serials: ['AB12'] });
    expect([...again.data.found[0].recheckBuIds].sort()).toEqual(['bu-a', 'bu-b']);
  });

  test('laporan aktif ditandai hasOpenCase; pembaca saja (serial: view) ditolak FORBIDDEN', async () => {
    await env.DB.prepare('DELETE FROM serial_events').run();
    await env.DB.prepare('DELETE FROM serials').run();
    await seedSerial(env, {
      id: 'sn1',
      serial: 'AB12',
      status: 'reported',
      itemId: 'i-a2',
      openCase: { id: 'c1', number: 'LP/A/2611-0001' },
    });
    const out = await call(W, 'serials.lookupMany', { serials: ['AB12'] });
    expect(out.data.found[0]).toMatchObject({ status: 'reported', hasOpenCase: true });
    const viewer = await call(SERIAL_USERS.viewer, 'serials.lookupMany', { serials: ['AB12'] });
    expect(viewer.error?.code).toBe('FORBIDDEN');
  });

  test('daftar kosong, lebih dari batas, atau bukan larik: kosong/VALIDATION', async () => {
    expect((await call(W, 'serials.lookupMany', { serials: [] })).data.found).toEqual([]);
    const tooMany = await call(W, 'serials.lookupMany', {
      serials: Array.from({ length: 201 }, (_, i) => `S${i}`),
    });
    expect(tooMany.error?.code).toBe('VALIDATION');
    expect((await call(W, 'serials.lookupMany', { serials: 'AB12' })).error?.code).toBe(
      'VALIDATION',
    );
  });
});

describe('serial ganda lama (indeks serials_serial belum terpasang): pilihan catatan deterministik', () => {
  beforeEach(async () => {
    await env.DB.prepare('DROP INDEX IF EXISTS serials_serial ON serials').run();
    await env.DB.prepare('DROP INDEX IF EXISTS serials_serial_live ON serials').run();
    await seedBusinessUnit(env, { id: 'bu-c', code: 'C' });
  });
  afterEach(async () => {
    // Skema dipakai bersama tes lain dalam proses ini: kembalikan indeks unik.
    await env.DB.prepare('DELETE FROM serials').run();
    await env.DB.prepare(
      'CREATE UNIQUE INDEX IF NOT EXISTS serials_serial_live ON serials (serial, deleted_at)',
    ).run();
  });

  const picked = async (): Promise<string | undefined> =>
    (await loadSerialRowBySerial(env.DB, 'AB12'))?.id.trim();

  test('laporan aktif, lalu Rusak, lalu terbaru (sama dengan pemenang skrip penyatuan), apa pun urutan penyisipan', async () => {
    // sn1 (BU A, baik, 2026-11-12) sudah ada. Sisipkan yang lebih baru lebih dulu dan yang lama belakangan.
    await seedSerial(env, {
      id: 'z-new',
      serial: 'AB12',
      buId: 'bu-b',
      itemId: 'i-b',
      testDate: '2026-11-20',
    });
    expect(await picked()).toBe('z-new');
    await seedSerial(env, {
      id: 'a-broken',
      serial: 'AB12',
      buId: 'bu-c',
      itemId: 'i-b',
      testDate: '2026-10-01',
      status: 'broken',
    });
    expect(await picked()).toBe('a-broken');
    await env.DB.prepare(
      "UPDATE serials SET status = 'reported', open_case_id = 'case-x' WHERE id = 'sn1'",
    ).run();
    expect(await picked()).toBe('sn1');
  });

  test('serials.lookupMany menjawab satu entri per serial: catatan yang sama dengan pilihan jalur tulis', async () => {
    await seedSerial(env, {
      id: 'z-new',
      serial: 'AB12',
      buId: 'bu-b',
      itemId: 'i-b',
      testDate: '2026-11-20',
    });
    const out = await call(BOTH, 'serials.lookupMany', { serials: ['AB12'] });
    expect(out.data.found).toHaveLength(1);
    expect(out.data.found[0].id).toBe(await picked());
  });
});
