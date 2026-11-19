// `serials.act` cek ulang lolos yang memindahkan BU (spek serial unik se-sistem §6): `recheck` (hasil lolos) dan
// `recheck_pass` menerima `buId`; `recheck_fail`/`recheck` gagal menolaknya.
import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { restCall } from '@server-test/rest-call';
import { SERIAL_USERS, seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;
const BOTH = SERIAL_USERS.both;
const AT = '2026-11-12T00:00:00.000Z';
const TODAY = '2026-11-12';

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
  await seedSerialWorld(env);
  await env.DB.prepare(
    "INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES ('s1', 'loc-sby', 10, ''), ('s2', 'loc-sby', 10, '')",
  ).run();
});

const act = async (
  action: string,
  extra: Record<string, unknown> = {},
  email: string = BOTH,
): Promise<CallOut> =>
  (await restCall(env, email, 'serials.act', {
    id: 'sn1',
    expectedUpdatedAt: AT,
    action,
    occurredOn: TODAY,
    message: '',
    ...extra,
  })) as CallOut;

const seedGood = (over: Record<string, unknown> = {}) =>
  seedSerial(env, { id: 'sn1', serial: 'AB12', itemId: 'i-a2', ...over });
const seedReported = (over: Record<string, unknown> = {}) =>
  seedGood({ status: 'reported', openCase: { id: 'case-1', number: 'LP/A/2611-0001' }, ...over });

const serialRow = () =>
  env.DB.prepare('SELECT bu_id, open_case_id, status FROM serials WHERE id = ?')
    .bind('sn1')
    .first<{ bu_id: string; open_case_id: string; status: string }>();
const history = async () =>
  (
    await env.DB.prepare(
      'SELECT bu_id, left_at FROM serial_business_units WHERE serial_id = ? ORDER BY bu_id',
    )
      .bind('sn1')
      .all<{ bu_id: string; left_at: string }>()
  ).results;
const lastEvent = async () => {
  const event = await env.DB.prepare(
    'SELECT type, case_id, data_json FROM serial_events WHERE serial_id = ? ORDER BY seq DESC LIMIT 1',
  )
    .bind('sn1')
    .first<{ type: string; case_id: string; data_json: string }>();
  return { ...event, data: JSON.parse(event?.data_json ?? '{}') as Json };
};

describe('serials.act: cek ulang lolos dengan buId', () => {
  test('recheck lolos dengan BU kandidat: serial pindah, kejadian membawa data.bu, riwayat BU tertulis', async () => {
    await seedGood();
    const out = await act('recheck', { result: 'pass', buId: 'bu-b' });
    expect(out.ok).toBe(true);
    expect(out.data).toMatchObject({ buId: 'bu-b', buCode: 'B', status: 'good' });
    expect((await serialRow())?.bu_id).toBe('bu-b');
    const rows = await history();
    expect(rows.find((r) => r.bu_id === 'bu-a')?.left_at).not.toBe('');
    expect(rows.find((r) => r.bu_id === 'bu-b')?.left_at).toBe('');
    const event = await lastEvent();
    expect(event.type).toBe('recheck');
    expect(event.data.bu).toEqual({ fromId: 'bu-a', fromCode: 'A', toId: 'bu-b', toCode: 'B' });
    expect(out.data.buHistory.map((h: Json) => h.buCode).sort()).toEqual(['A', 'B']);
  });

  test('recheck tanpa result (bawaan lolos) dengan buId juga memindahkan', async () => {
    await seedGood();
    expect((await act('recheck', { buId: 'bu-b' })).ok).toBe(true);
    expect((await serialRow())?.bu_id).toBe('bu-b');
  });

  test('buId sama dengan BU saat ini atau kosong: tanpa perpindahan dan tanpa data.bu', async () => {
    await seedGood();
    expect((await act('recheck', { buId: 'bu-a' })).ok).toBe(true);
    expect((await lastEvent()).data.bu).toBeUndefined();
    expect((await serialRow())?.bu_id).toBe('bu-a');
    const next = await restCall(env, BOTH, 'serials.act', {
      id: 'sn1',
      expectedUpdatedAt: (
        await env.DB.prepare('SELECT updated_at FROM serials').first<{
          updated_at: string;
        }>()
      )?.updated_at,
      action: 'recheck',
      occurredOn: TODAY,
      message: '',
      buId: '',
    });
    expect((next as CallOut).ok).toBe(true);
    expect((await serialRow())?.bu_id).toBe('bu-a');
    expect(await history()).toHaveLength(1);
  });

  test('recheck_pass pada laporan aktif: laporan ditutup, serial pindah BU, serial_cases.bu_id tetap BU saat dibuka', async () => {
    await seedReported();
    const out = await act('recheck_pass', { message: 'Normal', buId: 'bu-b' });
    expect(out.ok).toBe(true);
    expect(await serialRow()).toMatchObject({ bu_id: 'bu-b', open_case_id: '', status: 'good' });
    const kase = await env.DB.prepare('SELECT bu_id, outcome FROM serial_cases WHERE id = ?')
      .bind('case-1')
      .first<{ bu_id: string; outcome: string }>();
    expect(kase).toMatchObject({ bu_id: 'bu-a', outcome: 'good' });
    const event = await lastEvent();
    expect(event.type).toBe('recheck_pass');
    expect(event.data.bu).toMatchObject({ fromId: 'bu-a', toId: 'bu-b' });
  });

  test('BU yang pernah ditinggalkan tidak bisa dipilih lagi', async () => {
    await seedGood({ buId: 'bu-b' });
    await env.DB.prepare(
      "INSERT INTO serial_business_units (serial_id, bu_id, first_at, left_at) VALUES ('sn1', 'bu-a', '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z')",
    ).run();
    const out = await act('recheck', { buId: 'bu-a' });
    expect(out.error?.code).toBe('VALIDATION');
    expect(out.error?.fields?.buId ?? out.error?.message).toBeTruthy();
    expect((await serialRow())?.bu_id).toBe('bu-b');
  });

  test('pengguna tanpa hak tulis di BU tujuan ditolak (VALIDATION generik), tanpa efek', async () => {
    await seedGood();
    const out = await act('recheck', { buId: 'bu-b' }, SERIAL_USERS.mixed);
    expect(out.error?.code).toBe('VALIDATION');
    expect((await serialRow())?.bu_id).toBe('bu-a');
    expect(await history()).toHaveLength(1);
    const other = await act('recheck', { buId: 'bu-tak-ada' });
    expect(other.error?.code).toBe('VALIDATION');
  });

  test('BU tujuan nonaktif ditolak', async () => {
    await seedGood();
    await env.DB.prepare("UPDATE business_units SET status = 'inactive' WHERE id = 'bu-b'").run();
    expect((await act('recheck', { buId: 'bu-b' })).error?.code).toBe('VALIDATION');
    expect((await serialRow())?.bu_id).toBe('bu-a');
  });

  test('recheck_fail, recheck gagal, dan aksi lain menolak buId', async () => {
    await seedReported();
    const fail = await act('recheck_fail', { message: 'Masih rusak', buId: 'bu-b' });
    expect(fail.error?.code).toBe('VALIDATION');
    const failResult = await act('recheck', { result: 'fail', message: 'Rusak', buId: 'bu-b' });
    expect(failResult.error?.code).toBe('VALIDATION');
    const note = await act('note', { message: 'x', buId: 'bu-b' });
    expect(note.error?.code).toBe('VALIDATION');
    expect((await serialRow())?.bu_id).toBe('bu-a');
  });

  test('tanpa buId perilaku lama tetap (tanpa riwayat baru)', async () => {
    await seedReported();
    expect((await act('recheck_pass', { message: 'Normal' })).ok).toBe(true);
    expect((await serialRow())?.bu_id).toBe('bu-a');
    expect(await history()).toHaveLength(1);
    expect((await lastEvent()).data.bu).toBeUndefined();
  });

  test('serial yang usang saat berpindah: stale, BU tetap', async () => {
    await seedGood();
    const out = await act('recheck', { buId: 'bu-b' }, BOTH);
    expect(out.ok).toBe(true);
    const again = await act('recheck', { buId: 'bu-a' });
    expect(again.ok).toBe(false);
    expect((await serialRow())?.bu_id).toBe('bu-b');
  });
});
