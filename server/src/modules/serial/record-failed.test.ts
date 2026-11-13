// `serials.saveBatch` 5b: pencatatan langsung berstatus `failed` (membuka kasus LP) dan `source`.
import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { restCall } from '@server-test/rest-call';
import { SERIAL_USERS, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;
const W = SERIAL_USERS.writer;

const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
  await seedSerialWorld(env);
  await env.DB.prepare(
    "INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES ('s1', 'loc-sby', 10, ''), ('s2', 'loc-sby', 10, '')",
  ).run();
});

let counter = 0;
const cid = () => `client-${String(++counter).padStart(6, '0')}`;

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientId: cid(),
    serial: `SN-${counter + 1}`,
    itemId: 'i-a1',
    buId: 'bu-a',
    testDate: '2026-11-12',
    locationId: 'loc-sby',
    sample: false,
    note: '',
    status: 'failed',
    damage: 'Layar retak',
    ...over,
  };
}

const save = (email: string, rows: Record<string, unknown>[]) =>
  call(email, 'serials.saveBatch', { rows });

async function stock(stickerId: string): Promise<number> {
  const found = await env.DB.prepare(
    "SELECT qty FROM sticker_stock WHERE sticker_id = ? AND location_id = 'loc-sby'",
  )
    .bind(stickerId)
    .first<{ qty: number | string }>();
  return Number(found?.qty);
}

const casesOf = async () =>
  (
    await env.DB.prepare(
      'SELECT id, number, serial_id, opened_on, damage FROM serial_cases ORDER BY number',
    ).all<{
      id: string;
      number: string;
      serial_id: string;
      opened_on: string;
      damage: string;
    }>()
  ).results;

describe('baris failed', () => {
  test('created: serial failed, satu kasus LP, dua kejadian, stok dipotong', async () => {
    const out = await save(W, [row({ serial: 'FAIL-1' })]);
    expect(out.data.results[0]).toMatchObject({ result: 'created', serial: 'FAIL-1' });
    const id = out.data.results[0].id as string;
    const serial = await env.DB.prepare(
      'SELECT status, custody, open_case_id FROM serials WHERE id = ?',
    )
      .bind(id)
      .first<{ status: string; custody: string; open_case_id: string }>();
    expect(serial).toMatchObject({ status: 'failed', custody: 'qc' });
    const cases = await casesOf();
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      number: 'LP-20261112-001',
      serial_id: id,
      opened_on: '2026-11-12',
      damage: 'Layar retak',
    });
    expect(serial?.open_case_id).toBe(cases[0]?.id);
    const events = (
      await env.DB.prepare(
        'SELECT seq, case_id, type, occurred_on, data_json, changes_json FROM serial_events WHERE serial_id = ? ORDER BY seq',
      )
        .bind(id)
        .all<{
          seq: number;
          case_id: string;
          type: string;
          occurred_on: string;
          data_json: string;
          changes_json: string;
        }>()
    ).results;
    expect(events.map((e) => [Number(e.seq), e.type])).toEqual([
      [1, 'recorded'],
      [2, 'report_failure'],
    ]);
    expect(events[0]?.case_id).toBe('');
    expect(JSON.parse(events[0]?.data_json ?? '{}')).toMatchObject({
      status: 'failed',
      damage: 'Layar retak',
    });
    expect(events[1]?.case_id).toBe(cases[0]?.id);
    expect(events[1]?.occurred_on).toBe('2026-11-12');
    expect(JSON.parse(events[1]?.changes_json ?? '[]')).toEqual([
      { field: 'status', from: 'Lolos', to: 'Tidak lolos' },
      { field: 'damage', from: null, to: 'Layar retak' },
    ]);
    // Pemotongan stok tidak bergantung status (bawaan: semua stiker yang berlaku, jumlah 1).
    expect(await stock('s1')).toBe(9);
    expect(await stock('s2')).toBe(9);
    // Serial yang baru dicatat langsung terbaca dengan kasusnya.
    const detail = await call(W, 'serials.get', { id });
    expect(detail.data.serial).toMatchObject({
      status: 'failed',
      openCaseNumber: 'LP-20261112-001',
    });
  });

  test('tanpa damage, damage kosong, banyak baris, atau terlalu panjang: invalid, tanpa efek', async () => {
    const out = await save(W, [
      row({ serial: 'A1', damage: undefined }),
      row({ serial: 'A2', damage: '  ' }),
      row({ serial: 'A3', damage: 'a\nb' }),
      row({ serial: 'A4', damage: 'x'.repeat(201) }),
    ]);
    expect(out.data.results.map((r: Json) => r.result)).toEqual([
      'invalid',
      'invalid',
      'invalid',
      'invalid',
    ]);
    expect(out.data.results[0].message).toBe('Isi dulu kerusakannya');
    expect(await casesOf()).toEqual([]);
    expect(await stock('s1')).toBe(10);
  });

  test('damage pada baris good diabaikan; status lain ditolak', async () => {
    const out = await save(W, [
      row({ serial: 'G1', status: 'good', damage: 'abaikan' }),
      row({ serial: 'G2', status: 'broken' }),
    ]);
    expect(out.data.results.map((r: Json) => r.result)).toEqual(['created', 'invalid']);
    expect(await casesOf()).toEqual([]);
  });

  test('kirim ulang clientId yang sama: created dengan id lama, tetap satu kasus dan stok tidak dipotong dua kali', async () => {
    const same = row({ serial: 'RETRY-1' });
    const first = await save(W, [same]);
    const second = await save(W, [same]);
    expect(second.data.results[0]).toMatchObject({
      result: 'created',
      id: first.data.results[0].id,
    });
    expect(await casesOf()).toHaveLength(1);
    expect(await stock('s1')).toBe(9);
    const counterRow = await env.DB.prepare(
      "SELECT value FROM counters WHERE `key` = 'lp:20261112'",
    ).first<{
      value: number;
    }>();
    expect(Number(counterRow?.value)).toBe(1);
  });

  test('serial yang sama dicatat dua kali sebagai failed dengan clientId berbeda: duplicate, tanpa kasus kedua', async () => {
    await save(W, [row({ serial: 'DUP-1' })]);
    const out = await save(W, [row({ serial: 'DUP-1' })]);
    expect(out.data.results[0].result).toBe('duplicate');
    expect(await casesOf()).toHaveLength(1);
    expect(await stock('s1')).toBe(9);
  });

  test('lima baris failed serentak (permintaan terpisah): lima nomor unik berurutan', async () => {
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => save(W, [row({ serial: `PAR-${n}` })])),
    );
    expect(results.every((r) => r.data.results[0].result === 'created')).toBe(true);
    const numbers = (await casesOf()).map((c) => c.number);
    expect(numbers).toEqual([1, 2, 3, 4, 5].map((n) => `LP-20261112-00${n}`));
    expect(await stock('s1')).toBe(5);
  });

  test('campuran good dan failed dalam satu permintaan', async () => {
    const out = await save(W, [row({ serial: 'MIX-1', status: 'good' }), row({ serial: 'MIX-2' })]);
    expect(out.data.results.map((r: Json) => r.result)).toEqual(['created', 'created']);
    expect(await casesOf()).toHaveLength(1);
  });

  test('serialservice: edit tidak dapat mencatat: FORBIDDEN', async () => {
    const out = await save(SERIAL_USERS.svcEdit, [row({ serial: 'SVC-1' })]);
    expect(out.error?.code).toBe('FORBIDDEN');
    expect(await casesOf()).toEqual([]);
  });
});

describe('source', () => {
  test('countrylock dan manual tersimpan di data kejadian recorded; tanpa source tak ada kuncinya', async () => {
    const out = await save(W, [
      row({ serial: 'SRC-1', status: 'good', source: 'countrylock' }),
      row({ serial: 'SRC-2', status: 'good', source: 'manual' }),
      row({ serial: 'SRC-3', status: 'good' }),
    ]);
    const ids = out.data.results.map((r: Json) => r.id as string);
    const dataOf = async (id: string) =>
      JSON.parse(
        (
          await env.DB.prepare(
            "SELECT data_json FROM serial_events WHERE serial_id = ? AND type = 'recorded'",
          )
            .bind(id)
            .first<{ data_json: string }>()
        )?.data_json ?? '{}',
      );
    expect((await dataOf(ids[0])).source).toBe('countrylock');
    expect((await dataOf(ids[1])).source).toBe('manual');
    expect('source' in (await dataOf(ids[2]))).toBe(false);
  });

  test('source di luar enum: invalid', async () => {
    const out = await save(W, [row({ serial: 'SRC-9', status: 'good', source: 'lain' })]);
    expect(out.data.results[0].result).toBe('invalid');
  });
});
