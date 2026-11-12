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
const AT = '2026-11-12T00:00:00.000Z';

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
  await seedSerialWorld(env);
  await env.DB.prepare(
    "INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES ('s1', 'loc-sby', 10, ''), ('s2', 'loc-sby', 10, ''), ('s1', 'loc-jkt', 10, ''), ('s2', 'loc-jkt', 10, '')",
  ).run();
  await seedSerial(env, {
    id: 'sn1',
    serial: 'AB12',
    stickers: [
      { stickerId: 's1', qty: 1 },
      { stickerId: 's2', qty: 1 },
    ],
  });
});

const act = (
  extra: Record<string, unknown>,
  options: { email?: string; id?: string; at?: string } = {},
) =>
  call(options.email ?? W, 'serials.act', {
    id: options.id ?? 'sn1',
    expectedUpdatedAt: options.at ?? AT,
    action: 'recheck',
    occurredOn: '2026-11-12',
    message: '',
    ...extra,
  });

async function stock(stickerId: string, locationId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT qty FROM sticker_stock WHERE sticker_id = ? AND location_id = ?',
  )
    .bind(stickerId, locationId)
    .first<{ qty: number | string }>();
  return Number(row?.qty);
}

const events = async () =>
  (
    await env.DB.prepare(
      'SELECT id, seq, type, message, changes_json, data_json, occurred_on FROM serial_events WHERE serial_id = ? ORDER BY seq',
    )
      .bind('sn1')
      .all<{
        id: string;
        seq: number;
        type: string;
        message: string;
        changes_json: string;
        data_json: string;
        occurred_on: string;
      }>()
  ).results;

describe('serials.act: note', () => {
  test('menambah kejadian note, menaikkan updatedAt, tidak mengubah stok atau status', async () => {
    const result = await act({ action: 'note', message: 'Sudah dikonfirmasi pelanggan' });
    expect(result.ok).toBe(true);
    expect(result.data.updatedAt).not.toBe(AT);
    expect(result.data.status).toBe('good');
    const list = await events();
    expect(list.map((e) => [e.seq, e.type])).toEqual([
      [1, 'recorded'],
      [2, 'note'],
    ]);
    expect(list[1]?.message).toBe('Sudah dikonfirmasi pelanggan');
    expect(await stock('s1', 'loc-sby')).toBe(10);
  });

  test('pesan kosong: VALIDATION', async () => {
    expect((await act({ action: 'note', message: '  ' })).error?.code).toBe('VALIDATION');
  });
});

describe('serials.act: recheck', () => {
  test('di lokasi lain: location_id berubah, recorded tetap, chip lokasi; kejadian recheck pass', async () => {
    const result = await act({ locationId: 'loc-jkt', message: 'cek di Jakarta' });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ locationId: 'loc-jkt', recordedLocationId: 'loc-sby' });
    const event = (await events())[1];
    expect(event?.type).toBe('recheck');
    expect(JSON.parse(event?.changes_json ?? '[]')).toEqual([
      { field: 'location', from: 'Surabaya', to: 'Jakarta' },
    ]);
    expect(JSON.parse(event?.data_json ?? '{}')).toEqual({
      result: 'pass',
      locationId: 'loc-jkt',
      locationName: 'Jakarta',
    });
    // tanpa kenaikan stiker: stok tidak dipotong
    expect(await stock('s1', 'loc-jkt')).toBe(10);
    expect(await stock('s1', 'loc-sby')).toBe(10);
  });

  test('menaikkan stiker 1 -> 2 memotong stok di lokasi cek ulang (bukan lokasi pencatatan)', async () => {
    const result = await act({
      locationId: 'loc-jkt',
      stickers: [
        { stickerId: 's1', qty: 2 },
        { stickerId: 's2', qty: 1 },
      ],
    });
    expect(result.ok).toBe(true);
    expect(await stock('s1', 'loc-jkt')).toBe(9);
    expect(await stock('s1', 'loc-sby')).toBe(10);
    expect(await stock('s2', 'loc-jkt')).toBe(10);
    const event = (await events())[1];
    const entry = await env.DB.prepare(
      'SELECT kind, delta, location_id, serial_id FROM sticker_stock_entries WHERE serial_event_id = ?',
    )
      .bind(event?.id)
      .first<{ kind: string; delta: number | string; location_id: string; serial_id: string }>();
    expect(entry).toMatchObject({ kind: 'serial', location_id: 'loc-jkt', serial_id: 'sn1' });
    expect(Number(entry?.delta)).toBe(-1);
    expect(JSON.parse(event?.changes_json ?? '[]')).toEqual([
      { field: 'location', from: 'Surabaya', to: 'Jakarta' },
      { field: 'stickers', from: 'Segel A ×1', to: 'Segel A ×2' },
    ]);
    expect(JSON.parse(event?.data_json ?? '{}').stickers).toEqual([
      { stickerId: 's1', name: 'Segel A', qtyFrom: 1, qtyTo: 2 },
    ]);
    expect(result.data.stickers.find((s: Json) => s.stickerId === 's1').qty).toBe(2);
  });

  test('stiker belum tercatat yang berlaku ditambahkan; tidak berlaku atau menurunkan jumlah: VALIDATION', async () => {
    await env.DB.prepare(
      "DELETE FROM serial_stickers WHERE serial_id = 'sn1' AND sticker_id = 's2'",
    ).run();
    const added = await act({ stickers: [{ stickerId: 's2', qty: 3 }] });
    expect(added.ok).toBe(true);
    expect(await stock('s2', 'loc-sby')).toBe(7);
    const down = await act(
      {
        stickers: [
          { stickerId: 's1', qty: 1 },
          { stickerId: 's2', qty: 2 },
        ],
      },
      { at: added.data.updatedAt },
    );
    expect(down.error?.code).toBe('VALIDATION');
    const foreign = await act(
      { stickers: [{ stickerId: 'tidak-ada', qty: 1 }] },
      { at: added.data.updatedAt },
    );
    expect(foreign.error?.code).toBe('VALIDATION');
  });

  test('lokasi serial sudah nonaktif: cek ulang tanpa mengganti lokasi tetap diterima (eksplisit maupun tidak)', async () => {
    await env.DB.prepare("UPDATE locations SET status = 'inactive' WHERE id = 'loc-sby'").run();
    const implicit = await act({ message: 'cek di tempat' });
    expect(implicit.ok).toBe(true);
    expect(implicit.data).toMatchObject({ locationId: 'loc-sby' });
    const updatedAt = (implicit.data as Json).updatedAt as string;
    const explicit = await act({ locationId: 'loc-sby' }, { at: updatedAt });
    expect(explicit.ok).toBe(true);
    // Memindahkan KE lokasi nonaktif tetap ditolak.
    await env.DB.prepare("UPDATE locations SET status = 'inactive' WHERE id = 'loc-jkt'").run();
    const moved = await act(
      { locationId: 'loc-jkt' },
      { at: (explicit.data as Json).updatedAt as string },
    );
    expect(moved.error?.code).toBe('VALIDATION');
  });

  test('status selain good atau di luar qc: CONFLICT; tanggal masa depan VALIDATION; lokasi tak dikenal VALIDATION', async () => {
    await env.DB.prepare("UPDATE serials SET status = 'failed' WHERE id = 'sn1'").run();
    const conflict = await act({});
    expect(conflict.error?.code).toBe('CONFLICT');
    await env.DB.prepare("UPDATE serials SET status = 'good' WHERE id = 'sn1'").run();
    expect((await act({ occurredOn: '2026-11-13' })).error?.code).toBe('VALIDATION');
    expect((await act({ locationId: 'hilang' })).error?.code).toBe('VALIDATION');
  });
});

describe('serials.act: hak dan versi', () => {
  test('expectedUpdatedAt usang: stale (409) dan 412 lewat If-Match', async () => {
    const stale = await act({}, { at: '2026-01-01T00:00:00.000Z' });
    expect(stale.error?.code).toBe('CONFLICT');
    const rest = restClient(env);
    const response = await rest.post('/serials/sn1/act', {
      email: W,
      headers: { 'if-match': '"2026-01-01T00:00:00.000Z"' },
      body: { action: 'recheck', occurredOn: '2026-11-12', message: '' },
    });
    expect(response.status).toBe(412);
  });

  test('serialservice saja: FORBIDDEN; BU lain: NOT_FOUND', async () => {
    expect((await act({}, { email: SERIAL_USERS.service })).error?.code).toBe('FORBIDDEN');
    await seedSerial(env, { id: 'sn-b', serial: 'B-1', buId: 'bu-b', itemId: 'i-b' });
    expect((await act({}, { id: 'sn-b' })).error?.code).toBe('NOT_FOUND');
  });
});
