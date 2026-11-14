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

  test('pesan memuat pengatur arah teks Unicode ditolak (note dan recheck); Arab/Ibrani dan baris baru lolos', async () => {
    const codes = [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e];
    for (let code = 0x2066; code <= 0x2069; code++) codes.push(code);
    for (const code of codes) {
      const message = `abc${String.fromCharCode(code)}def`;
      const note = await act({ action: 'note', message });
      expect(note.error?.code).toBe('VALIDATION');
      expect(JSON.stringify(note.error)).toContain('message');
    }
    const recheck = await act({ action: 'recheck', message: 'ok‮evil' });
    expect(recheck.error?.code).toBe('VALIDATION');
    expect((await events()).length).toBe(1);
    const fine = await act({ action: 'note', message: 'baris satu\nمرحبا بالعالم\nשלום עולם' });
    expect(fine.ok).toBe(true);
  });

  test('pesan kosong: VALIDATION', async () => {
    expect((await act({ action: 'note', message: '  ' })).error?.code).toBe('VALIDATION');
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
