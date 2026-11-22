// `serials.applyStickersBatch`: Tempel stiker massal (keputusan pemilik 2026-11-22 K1/K2): atomik, idempoten lewat
// `serial_events.client_id = <clientId>:<serialId>`, hak dan keadaan per baris, serta konkurensi.
import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { restCall } from '@server-test/rest-call';
import { SERIAL_USERS, seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;
const W = SERIAL_USERS.writer;
const TODAY = '2026-11-12';
const CLIENT = '0b9f6d3e-3c5a-4f4e-9d0e-5a1b2c3d4e5f';
const CLIENT_2 = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
  await seedSerialWorld(env);
  await env.DB.prepare(
    "INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES ('s1', 'loc-sby', 10, ''), ('s2', 'loc-sby', 10, ''), ('s1', 'loc-jkt', 10, ''), ('s2', 'loc-jkt', 10, '')",
  ).run();
});

const batch = async (
  rows: { id: string; stickerIds: string[] }[],
  over: Record<string, unknown> = {},
  email: string = W,
): Promise<CallOut> =>
  (await restCall(env, email, 'serials.applyStickersBatch', {
    clientId: CLIENT,
    occurredOn: TODAY,
    message: '',
    rows,
    ...over,
  })) as CallOut;

const seedMany = async () => {
  await seedSerial(env, {
    id: 'sn1',
    serial: 'AB01',
    stickers: [{ stickerId: 's1', qty: 1 }],
  });
  await seedSerial(env, {
    id: 'sn2',
    serial: 'AB02',
    locationId: 'loc-jkt',
    stickers: [
      { stickerId: 's1', qty: 2 },
      { stickerId: 's2', qty: 1 },
    ],
  });
};

async function stock(stickerId: string, locationId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT qty FROM sticker_stock WHERE sticker_id = ? AND location_id = ?',
  )
    .bind(stickerId, locationId)
    .first<{ qty: number | string }>();
  return Number(row?.qty);
}

const stickerQty = async (serialId: string, stickerId: string) =>
  Number(
    (
      await env.DB.prepare('SELECT qty FROM serial_stickers WHERE serial_id = ? AND sticker_id = ?')
        .bind(serialId, stickerId)
        .first<{ qty: number | string }>()
    )?.qty ?? 0,
  );

const appliedEvents = async (serialId?: string) =>
  (
    await env.DB.prepare(
      `SELECT serial_id, type, client_id, case_id, message, changes_json, data_json FROM serial_events WHERE type = 'stickers_applied'${serialId ? ' AND serial_id = ?' : ''} ORDER BY serial_id, seq`,
    )
      .bind(...(serialId ? [serialId] : []))
      .all<{
        serial_id: string;
        type: string;
        client_id: string;
        case_id: string;
        message: string;
        changes_json: string;
        data_json: string;
      }>()
  ).results;

const entryCount = async () =>
  Number(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM sticker_stock_entries WHERE kind = 'serial'",
      ).first<{ n: number | string }>()
    )?.n,
  );

describe('serials.applyStickersBatch: keberhasilan', () => {
  test('tiap serial +1 per stiker dan stok terpotong di lokasi serial itu sendiri', async () => {
    await seedMany();
    const out = await batch(
      [
        { id: 'sn1', stickerIds: ['s1', 's2'] },
        { id: 'sn2', stickerIds: ['s1'] },
      ],
      { message: 'Rapikan stiker' },
    );
    expect(out.ok).toBe(true);
    expect(out.data).toEqual({ ids: ['sn1', 'sn2'] });
    expect(await stickerQty('sn1', 's1')).toBe(2);
    expect(await stickerQty('sn1', 's2')).toBe(1);
    expect(await stickerQty('sn2', 's1')).toBe(3);
    expect(await stickerQty('sn2', 's2')).toBe(1);
    expect(await stock('s1', 'loc-sby')).toBe(9);
    expect(await stock('s2', 'loc-sby')).toBe(9);
    expect(await stock('s1', 'loc-jkt')).toBe(9);
    expect(await stock('s2', 'loc-jkt')).toBe(10);
    const events = await appliedEvents();
    expect(events.map((e) => [e.serial_id, e.client_id, e.message])).toEqual([
      ['sn1', `${CLIENT}:sn1`, 'Rapikan stiker'],
      ['sn2', `${CLIENT}:sn2`, 'Rapikan stiker'],
    ]);
    expect(JSON.parse(events[1]?.data_json ?? '{}')).toMatchObject({
      locationId: 'loc-jkt',
      stickers: [{ stickerId: 's1', qtyFrom: 2, qtyTo: 3 }],
    });
    // Status dan posisi tidak berubah; updated_at maju.
    const row = await env.DB.prepare(
      "SELECT status, custody, updated_at FROM serials WHERE id = 'sn1'",
    ).first<{ status: string; custody: string; updated_at: string }>();
    expect(row).toMatchObject({ status: 'good', custody: 'qc' });
    expect(row?.updated_at).not.toBe('2026-11-12T00:00:00.000Z');
  });

  test('serial Dilaporkan ikut: kejadian membawa case_id laporan terbuka', async () => {
    await seedSerial(env, {
      id: 'sn1',
      serial: 'AB01',
      status: 'reported',
      openCase: { id: 'case-1', number: 'LP/A/2611-0001' },
    });
    expect((await batch([{ id: 'sn1', stickerIds: ['s1'] }])).ok).toBe(true);
    expect((await appliedEvents('sn1'))[0]?.case_id).toBe('case-1');
  });
});

describe('serials.applyStickersBatch: idempotensi', () => {
  test('kirim ulang permintaan yang sama: ids sama, tanpa kejadian, qty, dan potongan stok baru', async () => {
    await seedMany();
    const rows = [
      { id: 'sn1', stickerIds: ['s1'] },
      { id: 'sn2', stickerIds: ['s2'] },
    ];
    const first = await batch(rows);
    expect(first.ok).toBe(true);
    const entries = await entryCount();
    const again = await batch(rows);
    expect(again.ok).toBe(true);
    expect(again.data).toEqual({ ids: ['sn1', 'sn2'] });
    expect(await stickerQty('sn1', 's1')).toBe(2);
    expect(await stickerQty('sn2', 's2')).toBe(2);
    expect(await stock('s1', 'loc-sby')).toBe(9);
    expect(await stock('s2', 'loc-jkt')).toBe(9);
    expect(await entryCount()).toBe(entries);
    expect(await appliedEvents()).toHaveLength(2);
  });

  test('kirim ulang tetap berhasil walau serialnya sudah berpindah keadaan (mis. kini Rusak)', async () => {
    await seedMany();
    const rows = [{ id: 'sn1', stickerIds: ['s1'] }];
    expect((await batch(rows)).ok).toBe(true);
    await env.DB.prepare("UPDATE serials SET status = 'broken' WHERE id = 'sn1'").run();
    const again = await batch(rows);
    expect(again.ok).toBe(true);
    expect(await stock('s1', 'loc-sby')).toBe(9);
  });

  test('clientId yang sudah dipakai pelaku lain = CONFLICT, tanpa efek', async () => {
    await seedMany();
    expect((await batch([{ id: 'sn1', stickerIds: ['s1'] }])).ok).toBe(true);
    const other = await batch([{ id: 'sn1', stickerIds: ['s1'] }], {}, SERIAL_USERS.both);
    expect(other.ok).toBe(false);
    expect(other.error?.code).toBe('CONFLICT');
    expect(await stock('s1', 'loc-sby')).toBe(9);
  });

  test('clientId berbeda untuk serial yang sama = penempelan baru', async () => {
    await seedMany();
    expect((await batch([{ id: 'sn1', stickerIds: ['s1'] }])).ok).toBe(true);
    expect((await batch([{ id: 'sn1', stickerIds: ['s1'] }], { clientId: CLIENT_2 })).ok).toBe(
      true,
    );
    expect(await stickerQty('sn1', 's1')).toBe(3);
    expect(await stock('s1', 'loc-sby')).toBe(8);
  });
});

describe('serials.applyStickersBatch: atomik dan galat menyebut serialnya', () => {
  test('satu baris tidak berlaku bagi itemnya: semua batal, pesan memuat nomor serial', async () => {
    await seedMany();
    const out = await batch([
      { id: 'sn1', stickerIds: ['s1'] },
      { id: 'sn2', stickerIds: ['tidak-ada'] },
    ]);
    expect(out.ok).toBe(false);
    expect(out.error?.code).toBe('VALIDATION');
    expect(out.error?.message).toContain('AB02');
    expect(await stickerQty('sn1', 's1')).toBe(1);
    expect(await stock('s1', 'loc-sby')).toBe(10);
    expect(await appliedEvents()).toHaveLength(0);
    expect(await entryCount()).toBe(0);
  });

  test('satu baris berstatus Rusak = CONFLICT dengan nomor serial; tidak ada yang tertulis', async () => {
    await seedMany();
    await seedSerial(env, { id: 'sn3', serial: 'AB03', status: 'broken' });
    const out = await batch([
      { id: 'sn1', stickerIds: ['s1'] },
      { id: 'sn3', stickerIds: ['s1'] },
    ]);
    expect(out.error?.code).toBe('CONFLICT');
    expect(out.error?.message).toContain('AB03');
    expect(await stickerQty('sn1', 's1')).toBe(1);
    expect(await stock('s1', 'loc-sby')).toBe(10);
  });

  test('stiker nonaktif pada salah satu baris membatalkan semuanya', async () => {
    await seedMany();
    await env.DB.prepare("UPDATE stickers SET status = 'inactive' WHERE id = 's2'").run();
    const out = await batch([
      { id: 'sn1', stickerIds: ['s1'] },
      { id: 'sn2', stickerIds: ['s2'] },
    ]);
    expect(out.error?.code).toBe('VALIDATION');
    expect(out.error?.message).toContain('AB02');
    expect(await stock('s1', 'loc-sby')).toBe(10);
  });

  test('serial dalam pengiriman atau terhapus: CONFLICT dan NOT_FOUND', async () => {
    await seedMany();
    await seedSerial(env, {
      id: 'sn3',
      serial: 'AB03',
      status: 'recheck',
      custody: 'transit',
      openCase: { id: 'case-3', number: 'LP/A/2611-0003' },
    });
    const transit = await batch([{ id: 'sn3', stickerIds: ['s1'] }]);
    expect(transit.error?.code).toBe('CONFLICT');
    await env.DB.prepare(
      "UPDATE serials SET deleted_at = '2026-11-12T01:00:00.000Z', deleted_by = 'x@y.z' WHERE id = 'sn2'",
    ).run();
    const deleted = await batch([
      { id: 'sn1', stickerIds: ['s1'] },
      { id: 'sn2', stickerIds: ['s1'] },
    ]);
    expect(deleted.error?.code).toBe('NOT_FOUND');
    expect(deleted.error?.message).not.toContain('AB02');
    expect(await stock('s1', 'loc-sby')).toBe(10);
  });
});

describe('serials.applyStickersBatch: hak', () => {
  test('BU di luar hak baca = NOT_FOUND tanpa membocorkan nomor; hanya pembaca = FORBIDDEN', async () => {
    await seedSerial(env, { id: 'sn-b', serial: 'BB01', buId: 'bu-b', itemId: 'i-b' });
    await seedSerial(env, { id: 'sn1', serial: 'AB01' });
    const hidden = await batch([
      { id: 'sn1', stickerIds: ['s1'] },
      { id: 'sn-b', stickerIds: ['s1'] },
    ]);
    expect(hidden.error?.code).toBe('NOT_FOUND');
    expect(hidden.error?.message).not.toContain('BB01');
    // edit di BU A, hanya lihat di BU B: serial BU B terlihat tetapi bukan miliknya untuk ditindak.
    const readOnly = await batch([{ id: 'sn-b', stickerIds: ['s1'] }], {}, SERIAL_USERS.mixed);
    expect(readOnly.error?.code).toBe('FORBIDDEN');
    expect(readOnly.error?.message).toContain('BB01');
    expect(await stock('s1', 'loc-sby')).toBe(10);
  });

  test('gerbang rute: hanya `serial: edit`', async () => {
    await seedSerial(env, { id: 'sn1', serial: 'AB01' });
    const rows = [{ id: 'sn1', stickerIds: ['s1'] }];
    expect((await batch(rows, {}, SERIAL_USERS.viewer)).error?.code).toBe('FORBIDDEN');
    expect((await batch(rows, {}, SERIAL_USERS.svcEdit)).error?.code).toBe('FORBIDDEN');
    expect((await batch(rows, {}, SERIAL_USERS.nobu)).ok).toBe(false);
    expect(await stock('s1', 'loc-sby')).toBe(10);
  });

  test('pemegang edit di dua BU menempeli serial di kedua BU dalam satu permintaan', async () => {
    await seedSerial(env, { id: 'sn1', serial: 'AB01' });
    await seedSerial(env, {
      id: 'sn-b',
      serial: 'BB01',
      buId: 'bu-b',
      itemId: 'i-a2',
      locationId: 'loc-jkt',
    });
    const out = await batch(
      [
        { id: 'sn1', stickerIds: ['s1'] },
        { id: 'sn-b', stickerIds: ['s2'] },
      ],
      {},
      SERIAL_USERS.both,
    );
    expect(out.ok).toBe(true);
    expect(await stock('s1', 'loc-sby')).toBe(9);
    expect(await stock('s2', 'loc-jkt')).toBe(9);
  });
});

describe('serials.applyStickersBatch: validasi bentuk', () => {
  const rows = [{ id: 'sn1', stickerIds: ['s1'] }];
  const code = async (over: Record<string, unknown>) => (await batch(rows, over)).error?.code;

  test('clientId, tanggal, dan catatan', async () => {
    await seedSerial(env, { id: 'sn1', serial: 'AB01' });
    expect(await code({ clientId: 'bukan-uuid' })).toBe('VALIDATION');
    expect(await code({ clientId: CLIENT.toUpperCase() })).toBe('VALIDATION');
    expect(await code({ occurredOn: 'kemarin' })).toBe('VALIDATION');
    expect(await code({ occurredOn: '2026-11-13' })).toBe('VALIDATION');
    expect(await code({ message: '![x](qcfile:abc)' })).toBe('VALIDATION');
    expect(await code({ message: 'x'.repeat(5001) })).toBe('VALIDATION');
    expect(await stock('s1', 'loc-sby')).toBe(10);
  });

  test('baris: kosong, kembar, tanpa stiker, stiker kembar, terlalu banyak', async () => {
    await seedSerial(env, { id: 'sn1', serial: 'AB01' });
    const bad = async (list: unknown) => (await batch(list as never)).error?.code;
    expect(await bad([])).toBe('VALIDATION');
    expect(await bad('x')).toBe('VALIDATION');
    expect(
      await bad([
        { id: 'sn1', stickerIds: ['s1'] },
        { id: 'sn1', stickerIds: ['s2'] },
      ]),
    ).toBe('VALIDATION');
    expect(await bad([{ id: 'sn1', stickerIds: [] }])).toBe('VALIDATION');
    expect(await bad([{ id: 'sn1' }])).toBe('VALIDATION');
    expect(await bad([{ id: 'sn1', stickerIds: ['s1', 's1'] }])).toBe('VALIDATION');
    expect(
      await bad([{ id: 'sn1', stickerIds: Array.from({ length: 21 }, (_, i) => `x${i}`) }]),
    ).toBe('VALIDATION');
    expect(await bad([{ id: 'x'.repeat(61), stickerIds: ['s1'] }])).toBe('VALIDATION');
    expect(
      await bad(Array.from({ length: 101 }, (_, i) => ({ id: `id${i}`, stickerIds: ['s1'] }))),
    ).toBe('VALIDATION');
  });
});

describe('serials.applyStickersBatch: konkurensi (Promise.all)', () => {
  const many = async (count: number) => {
    for (let i = 0; i < count; i++) {
      await seedSerial(env, {
        id: `sn${i}`,
        serial: `AB${String(i).padStart(2, '0')}`,
        stickers: [{ stickerId: 's1', qty: 1 }],
      });
    }
    return Array.from({ length: count }, (_, i) => ({ id: `sn${i}`, stickerIds: ['s1'] }));
  };

  test('permintaan SAMA (clientId sama) dikirim serentak: stok terpotong sekali per serial', async () => {
    const rows = await many(6);
    const results = await Promise.all([batch(rows), batch(rows), batch(rows)]);
    expect(results.every((result) => result.ok)).toBe(true);
    for (const result of results) {
      expect(result.data.ids).toEqual(rows.map((row) => row.id));
    }
    expect(await stock('s1', 'loc-sby')).toBe(10 - 6);
    expect(await appliedEvents()).toHaveLength(6);
    for (const row of rows) expect(await stickerQty(row.id, 's1')).toBe(2);
  });

  test('dua permintaan BERBEDA atas serial yang sama serentak: keduanya berhasil, stok terpotong dua kali', async () => {
    const rows = await many(5);
    const results = await Promise.all([
      batch(rows),
      batch([...rows].reverse(), { clientId: CLIENT_2 }),
    ]);
    expect(results.map((result) => result.ok)).toEqual([true, true]);
    expect(await stock('s1', 'loc-sby')).toBe(10 - 10);
    expect(await appliedEvents()).toHaveLength(10);
    for (const row of rows) expect(await stickerQty(row.id, 's1')).toBe(3);
  });

  test('penempelan serentak dengan penonaktifan stiker: tidak ada hasil setengah jadi', async () => {
    const rows = await many(4);
    const [applied] = await Promise.all([
      batch(rows),
      env.DB.prepare("UPDATE stickers SET status = 'inactive' WHERE id = 's1'").run(),
    ]);
    const done = (await appliedEvents()).length;
    if (applied.ok) expect(done).toBe(4);
    else expect(done).toBe(0);
    expect(await stock('s1', 'loc-sby')).toBe(10 - done);
  });
});
