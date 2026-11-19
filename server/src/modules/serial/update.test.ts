import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { restCall } from '@server-test/rest-call';
import { restClient } from '@server-test/rest-client';
import { SERIAL_USERS, seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;
const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

const W = SERIAL_USERS.writer;
const BASE = {
  serial: 'AB12',
  itemId: 'i-a1',
  testDate: '2026-11-12',
  sample: false,
  note: '',
  locationId: 'loc-sby',
};

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
  await seedSerialWorld(env);
  await env.DB.prepare(
    "INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES ('s1', 'loc-sby', 7, ''), ('s2', 'loc-sby', 3, '')",
  ).run();
  await seedSerial(env, {
    id: 'sn1',
    serial: 'AB12',
    stickers: [
      { stickerId: 's1', qty: 1 },
      { stickerId: 's2', qty: 2 },
    ],
  });
});

const update = (email: string, extra: Record<string, unknown> = {}, id = 'sn1', at?: string) =>
  call(email, 'serials.update', {
    id,
    expectedUpdatedAt: at ?? '2026-11-12T00:00:00.000Z',
    ...BASE,
    ...extra,
  });

async function counts() {
  const read = async (sql: string) =>
    Number((await env.DB.prepare(sql).first<{ n: number | string }>())?.n);
  return {
    entries: await read('SELECT COUNT(*) AS n FROM sticker_stock_entries'),
    stock: await read('SELECT SUM(qty) AS n FROM sticker_stock'),
    stickers: await read('SELECT SUM(qty) AS n FROM serial_stickers'),
    events: await read('SELECT COUNT(*) AS n FROM serial_events'),
  };
}

describe('serials.update', () => {
  test('mengubah serial: kejadian data_changed dengan changes; stok dan stiker tidak berubah', async () => {
    const before = await counts();
    const result = await update(W, { serial: 'ab13' });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ id: 'sn1', serial: 'AB13' });
    expect(result.data.updatedAt).not.toBe('2026-11-12T00:00:00.000Z');
    const event = await env.DB.prepare(
      "SELECT seq, type, changes_json, occurred_on FROM serial_events WHERE serial_id = 'sn1' AND type = 'data_changed'",
    ).first<{ seq: number; type: string; changes_json: string; occurred_on: string }>();
    expect(event).toMatchObject({ seq: 2, type: 'data_changed', occurred_on: '2026-11-12' });
    expect(JSON.parse(event?.changes_json ?? '[]')).toEqual([
      { field: 'serial', from: 'AB12', to: 'AB13' },
    ]);
    const after = await counts();
    expect(after.entries).toBe(before.entries);
    expect(after.stock).toBe(before.stock);
    expect(after.stickers).toBe(before.stickers);
  });

  test('mengganti item (BU sama), tanggal, sample, catatan, lokasi: changes berlabel terbaca; recorded_location tetap', async () => {
    const result = await update(W, {
      itemId: 'i-a2',
      testDate: '2026-11-10',
      sample: true,
      note: 'periksa lagi',
      locationId: 'loc-jkt',
    });
    expect(result.ok).toBe(true);
    const event = await env.DB.prepare(
      "SELECT changes_json FROM serial_events WHERE serial_id = 'sn1' AND type = 'data_changed'",
    ).first<{ changes_json: string }>();
    expect(JSON.parse(event?.changes_json ?? '[]')).toEqual([
      { field: 'item', from: 'Merk Alfa', to: 'Merk Beta' },
      { field: 'testDate', from: '2026-11-12', to: '2026-11-10' },
      { field: 'sample', from: 'Tidak', to: 'Ya' },
      { field: 'note', from: null, to: 'periksa lagi' },
      { field: 'location', from: 'Surabaya', to: 'Jakarta' },
    ]);
    const row = await env.DB.prepare(
      "SELECT location_id, recorded_location_id FROM serials WHERE id = 'sn1'",
    ).first<{ location_id: string; recorded_location_id: string }>();
    expect(row).toEqual({ location_id: 'loc-jkt', recorded_location_id: 'loc-sby' });
  });

  test('catatan memuat rujukan gambar qcfile: VALIDATION pada field note, tanpa efek', async () => {
    const before = await counts();
    const result = await update(W, { note: 'lihat ![x](qcfile:abc-123) ini' });
    expect(result.error?.code).toBe('VALIDATION');
    expect(result.error?.fields).toEqual({ note: 'Catatan tidak boleh memuat gambar.' });
    expect(await counts()).toEqual(before);
    const batch = await call(W, 'serials.updateBatch', {
      rows: [
        {
          id: 'sn1',
          expectedUpdatedAt: '2026-11-12T00:00:00.000Z',
          fields: { note: '![x](qcfile:abc-123)' },
        },
      ],
    });
    expect((batch.data as Json).results[0]).toMatchObject({ result: 'invalid' });
    expect(await counts()).toEqual(before);
  });

  test('item boleh bukan BU item selama terlihat bagi user dan BU serial aktif (butir N)', async () => {
    await seedSerial(env, { id: 'sn-b', serial: 'B-1', buId: 'bu-b', itemId: 'i-b' });
    // i-a1 hanya di BU A, serial ada di BU B; BOTH berhak menulis di keduanya.
    const result = await update(SERIAL_USERS.both, { serial: 'B-1', itemId: 'i-a1' }, 'sn-b');
    expect(result.ok).toBe(true);
    const row = await env.DB.prepare("SELECT item_id FROM serials WHERE id = 'sn-b'").first<{
      item_id: string;
    }>();
    expect(row?.item_id).toBe('i-a1');
    // BU nonaktif: perubahan item ditolak generik.
    await env.DB.prepare("UPDATE business_units SET status = 'inactive' WHERE id = 'bu-b'").run();
    const fresh = await env.DB.prepare("SELECT updated_at FROM serials WHERE id = 'sn-b'").first<{
      updated_at: string;
    }>();
    const blocked = await update(
      SERIAL_USERS.both,
      { serial: 'B-1', itemId: 'i-a2' },
      'sn-b',
      fresh?.updated_at,
    );
    expect(blocked.error?.code).toBe('VALIDATION');
  });

  test('item yang tidak memuat BU serial, nonaktif, atau lokasi tak dikenal: VALIDATION', async () => {
    for (const extra of [{ itemId: 'i-b' }, { itemId: 'i-off' }, { locationId: 'hilang' }]) {
      const result = await update(W, extra);
      expect(result.error?.code).toBe('VALIDATION');
    }
    expect((await counts()).events).toBe(1);
  });

  test('serial baru bentrok di BU yang sama: CONFLICT generik; di BU lain bukan bentrok', async () => {
    await seedSerial(env, { id: 'sn2', serial: 'XY99' });
    await seedSerial(env, { id: 'sn-b', serial: 'FREE-1', buId: 'bu-b', itemId: 'i-b' });
    const clash = await update(W, { serial: 'xy99' });
    expect(clash.error?.code).toBe('CONFLICT');
    expect(clash.error?.message).toBe('Serial sudah terdaftar');
    // serial yang sama dengan catatan di BU B boleh.
    await seedSerial(env, { id: 'sn3', serial: 'DUP-B', buId: 'bu-b', itemId: 'i-b' });
    const ok = await update(W, { serial: 'DUP-B' });
    expect(ok.ok).toBe(true);
  });

  test('If-Match usang lewat REST: 412; tanpa perubahan: tidak ada kejadian dan updatedAt tetap', async () => {
    const rest = restClient(env);
    const response = await rest.put('/serials/sn1', {
      email: W,
      headers: { 'if-match': '"2026-01-01T00:00:00.000Z"' },
      body: BASE,
    });
    expect(response.status).toBe(412);
    const same = await update(W);
    expect(same.ok).toBe(true);
    expect(same.data.updatedAt).toBe('2026-11-12T00:00:00.000Z');
    expect((await counts()).events).toBe(1);
  });

  test('dua pembaruan serentak pada serial yang sama: satu berhasil, satu stale', async () => {
    const outs = await Promise.all([update(W, { note: 'A' }), update(W, { note: 'B' })]);
    expect(outs.filter((o) => o.ok)).toHaveLength(1);
    const failed = outs.find((o) => !o.ok);
    expect(failed?.error?.code).toBe('CONFLICT');
    expect((await counts()).events).toBe(2);
  });

  test('hak: serial view saja FORBIDDEN; BU lain NOT_FOUND; tanggal masa depan VALIDATION', async () => {
    expect((await update(SERIAL_USERS.viewer)).error?.code).toBe('FORBIDDEN');
    await seedSerial(env, { id: 'sn-b', serial: 'B-1', buId: 'bu-b', itemId: 'i-b' });
    const other = await update(W, { itemId: 'i-b' }, 'sn-b');
    expect(other.error?.code).toBe('NOT_FOUND');
    const future = await update(W, { testDate: '2026-11-13' });
    expect(future.error?.code).toBe('VALIDATION');
  });
});

describe('lokasi dikunci selama bukan di QC (keputusan pemilik 2026-11-13)', () => {
  const seedAway = async (id: string, serial: string, custody: 'transit' | 'service') =>
    seedSerial(env, {
      id,
      serial,
      status: 'at_service',
      custody,
      openCase: { id: `c-${id}`, number: `LP/A/2611-${id}` },
      ...(custody === 'transit'
        ? {
            transitFromLocationId: 'loc-sby',
            transitToLocationId: 'loc-jkt',
            transitOn: '2026-11-10',
          }
        : {}),
    });
  const base = (serial: string) => ({ ...BASE, serial });

  test('update tunggal: ubah lokasi saat transit atau service = VALIDATION pada locationId; lokasi sama dan field lain lolos; custody qc lolos', async () => {
    await seedAway('t1', 'TR-1', 'transit');
    await seedAway('s1x', 'SV-1', 'service');
    for (const [id, serial] of [
      ['t1', 'TR-1'],
      ['s1x', 'SV-1'],
    ] as const) {
      const moved = await update(W, { ...base(serial), locationId: 'loc-jkt' }, id);
      expect(moved.error?.code).toBe('VALIDATION');
      expect(moved.error?.message).toBe(
        'Lokasi tidak bisa diubah selama Serial Number masih dalam pengiriman atau di servis',
      );
      expect(Object.keys(moved.error?.fields ?? {})).toContain('locationId');
      const same = await update(
        W,
        { ...base(serial), locationId: 'loc-sby', note: 'tetap bisa' },
        id,
      );
      expect(same.ok).toBe(true);
      expect(same.data.locationId).toBe('loc-sby');
      expect(same.data.note).toBe('tetap bisa');
    }
    const qc = await update(W, { locationId: 'loc-jkt' });
    expect(qc.ok).toBe(true);
    expect(qc.data.locationId).toBe('loc-jkt');
  });

  test('updateBatch: baris di transit/service yang mengubah lokasi = invalid dengan pesan, baris lain tetap diproses', async () => {
    await seedAway('t1', 'TR-1', 'transit');
    await seedSerial(env, { id: 'q1', serial: 'QC-1' });
    const out = await call(W, 'serials.updateBatch', {
      rows: [
        {
          id: 't1',
          expectedUpdatedAt: '2026-11-12T00:00:00.000Z',
          fields: { locationId: 'loc-jkt' },
        },
        {
          id: 't1',
          expectedUpdatedAt: '2026-11-12T00:00:00.000Z',
          fields: { locationId: 'loc-sby', note: 'x' },
        },
        {
          id: 'q1',
          expectedUpdatedAt: '2026-11-12T00:00:00.000Z',
          fields: { locationId: 'loc-jkt' },
        },
      ],
    });
    const results = (out.data as Json).results;
    expect(results.map((r: Json) => r.result)).toEqual(['invalid', 'updated', 'updated']);
    expect(results[0].message).toBe(
      'Lokasi tidak bisa diubah selama Serial Number masih dalam pengiriman atau di servis',
    );
  });
});

describe('serials.updateBatch', () => {
  test('parsial: satu stale, satu sah, satu duplikat, satu invalid; baris sah diproses', async () => {
    await seedSerial(env, { id: 'sn2', serial: 'SN-2' });
    await seedSerial(env, { id: 'sn3', serial: 'SN-3' });
    const out = await call(W, 'serials.updateBatch', {
      rows: [
        { id: 'sn1', expectedUpdatedAt: '2026-01-01T00:00:00.000Z', fields: { note: 'x' } },
        {
          id: 'sn2',
          expectedUpdatedAt: '2026-11-12T00:00:00.000Z',
          fields: { note: 'ok', sample: true },
        },
        { id: 'sn3', expectedUpdatedAt: '2026-11-12T00:00:00.000Z', fields: { serial: 'ab12' } },
        { id: 'sn1', expectedUpdatedAt: '2026-11-12T00:00:00.000Z', fields: { itemId: 'i-b' } },
        { id: 'hilang', expectedUpdatedAt: 'x', fields: {} },
      ],
    });
    expect(out.ok).toBe(true);
    const results = (out.data as Json).results;
    expect(results.map((r: Json) => r.result)).toEqual([
      'stale',
      'updated',
      'duplicate',
      'invalid',
      'invalid',
    ]);
    expect(results[1].updatedAt).toBeDefined();
    const note = await env.DB.prepare("SELECT note, sample FROM serials WHERE id = 'sn2'").first<{
      note: string;
      sample: number;
    }>();
    expect(note).toMatchObject({ note: 'ok' });
    expect(Number(note?.sample)).toBe(1);
  });

  test('201 baris: VALIDATION; serial view saja: FORBIDDEN', async () => {
    const rows = Array.from({ length: 201 }, () => ({
      id: 'sn1',
      expectedUpdatedAt: 'x',
      fields: {},
    }));
    expect((await call(W, 'serials.updateBatch', { rows })).error?.code).toBe('VALIDATION');
    expect(
      (await call(SERIAL_USERS.viewer, 'serials.updateBatch', { rows: rows.slice(0, 1) })).error
        ?.code,
    ).toBe('FORBIDDEN');
  });
});
