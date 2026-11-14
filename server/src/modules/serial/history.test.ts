// `serials.history`, kasus dan posisi pada `serials.get`, dan filter posisi pada `serials.list` (5b).
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
const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

beforeEach(async () => {
  env = await createTestEnv();
  await seedSerialWorld(env);
});

/** Menyisipkan kejadian (seq, jenis, kasus) langsung ke tabel; `seq` 1 sudah ada dari `seedSerial` (recorded). */
async function addEvents(
  serialId: string,
  list: [seq: number, type: string, caseId?: string][],
): Promise<void> {
  for (const [seq, type, caseId] of list) {
    await env.DB.prepare(
      "INSERT INTO serial_events (id, serial_id, case_id, seq, type, occurred_on, created_at, actor_id, actor_name, actor_team, message, changes_json, data_json) VALUES (?, ?, ?, ?, ?, '2026-11-12', 't', 'u', 'U', 'qc', '', '[]', '{}')",
    )
      .bind(`${serialId}-e${seq}`, serialId, caseId ?? '', seq, type)
      .run();
  }
}

/** Serial dengan 7 kejadian: 1 recorded, 2 recheck, 3 report_failure (c1), 4 note (c1), 5 data_changed, 6 recheck_fail (c1), 7 note. */
async function seedHistory(): Promise<void> {
  await seedSerial(env, {
    id: 'sn1',
    serial: 'AB12',
    status: 'reported',
    openCase: { id: 'c1', number: 'LP-20261110-001' },
  });
  await addEvents('sn1', [
    [2, 'recheck'],
    [3, 'report_failure', 'c1'],
    [4, 'note', 'c1'],
    [5, 'data_changed'],
    [6, 'recheck_fail', 'c1'],
    [7, 'note'],
  ]);
}

describe('serials.history', () => {
  test('3 halaman ukuran 2 menurun tanpa celah atau ganda; kursor = seq terakhir', async () => {
    await seedHistory();
    const seen: number[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const out = await call(W, 'serials.history', {
        id: 'sn1',
        limit: 3,
        ...(cursor ? { cursor } : {}),
      });
      expect(out.ok).toBe(true);
      pages++;
      seen.push(...out.data.events.map((e: Json) => e.seq));
      if (out.data.nextCursor === null) break;
      cursor = out.data.nextCursor;
    }
    expect(seen).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(pages).toBe(3);
  });

  test('ukuran halaman 2: halaman pertama [7, 6] dengan kursor "6"', async () => {
    await seedHistory();
    const out = await call(W, 'serials.history', { id: 'sn1', limit: 2 });
    expect(out.data.events.map((e: Json) => e.seq)).toEqual([7, 6]);
    expect(out.data.nextCursor).toBe('6');
    const next = await call(W, 'serials.history', { id: 'sn1', limit: 2, cursor: '6' });
    expect(next.data.events.map((e: Json) => e.seq)).toEqual([5, 4]);
  });

  test('group=checks hanya recorded/recheck/recheck_pass/recheck_fail; group=changes hanya data_changed', async () => {
    await seedHistory();
    const checks = await call(W, 'serials.history', { id: 'sn1', group: 'checks' });
    expect(checks.data.events.map((e: Json) => e.type)).toEqual([
      'recheck_fail',
      'recheck',
      'recorded',
    ]);
    const changes = await call(W, 'serials.history', { id: 'sn1', group: 'changes' });
    expect(changes.data.events.map((e: Json) => e.type)).toEqual(['data_changed']);
    const all = await call(W, 'serials.history', { id: 'sn1', group: 'all' });
    expect(all.data.events).toHaveLength(7);
  });

  test('caseId menyaring kejadian kasus itu; kasus serial lain atau tak ada: hasil kosong, bukan galat', async () => {
    await seedHistory();
    await seedSerial(env, {
      id: 'sn2',
      serial: 'ZZ99',
      status: 'reported',
      openCase: { id: 'c2', number: 'LP-20261110-002' },
    });
    const own = await call(W, 'serials.history', { id: 'sn1', caseId: 'c1' });
    expect(own.data.events.map((e: Json) => e.seq)).toEqual([6, 4, 3]);
    expect(own.data.events.every((e: Json) => e.caseId === 'c1')).toBe(true);
    const other = await call(W, 'serials.history', { id: 'sn1', caseId: 'c2' });
    expect(other.ok).toBe(true);
    expect(other.data.events).toEqual([]);
    expect(
      (await call(W, 'serials.history', { id: 'sn1', caseId: 'tak-ada' })).data.events,
    ).toEqual([]);
  });

  test('counts tidak terpengaruh filter: semua, tab pemeriksaan, tab perubahan, per kasus', async () => {
    await seedHistory();
    const out = await call(W, 'serials.history', { id: 'sn1', group: 'changes', limit: 1 });
    expect(out.data.counts).toEqual({ all: 7, checks: 3, changes: 1, byCase: { c1: 3 } });
  });

  test('BU lain atau tanpa penugasan: NOT_FOUND; serial tak ada: NOT_FOUND', async () => {
    await seedHistory();
    await seedSerial(env, { id: 'sn-b', serial: 'BB1', buId: 'bu-b', itemId: 'i-b' });
    expect((await call(W, 'serials.history', { id: 'sn-b' })).error?.code).toBe('NOT_FOUND');
    expect((await call(W, 'serials.history', { id: 'tak-ada' })).error?.code).toBe('NOT_FOUND');
    expect((await call(SERIAL_USERS.nobu, 'serials.history', { id: 'sn1' })).error?.code).toBe(
      'FORBIDDEN',
    );
  });

  test('serialservice: view dan serial: view boleh membaca', async () => {
    await seedHistory();
    expect((await call(SERIAL_USERS.service, 'serials.history', { id: 'sn1' })).ok).toBe(true);
    expect((await call(SERIAL_USERS.viewer, 'serials.history', { id: 'sn1' })).ok).toBe(true);
  });

  test('limit 101, 0, atau bukan bilangan, group atau kursor tak valid: VALIDATION', async () => {
    await seedHistory();
    for (const bad of [
      { limit: 101 },
      { limit: 0 },
      { limit: 'x' },
      { group: 'lain' },
      { cursor: 'abc' },
    ]) {
      const out = await call(W, 'serials.history', { id: 'sn1', ...bad });
      expect([bad, out.error?.code]).toEqual([bad, 'VALIDATION']);
    }
    const max = await call(W, 'serials.history', { id: 'sn1', limit: 100 });
    expect(max.ok).toBe(true);
  });
});

describe('serials.get: kasus dan posisi', () => {
  test('memuat openCase, cases (terbaru dulu), transit*, dan caseId kejadian', async () => {
    await seedSerial(env, {
      id: 'sn1',
      serial: 'AB12',
      status: 'at_service',
      custody: 'transit',
      transitFromLocationId: 'loc-sby',
      transitToLocationId: 'loc-jkt',
      transitOn: '2026-11-10',
      openCase: { id: 'c-new', number: 'LP-20261110-002' },
    });
    await env.DB.prepare(
      "INSERT INTO serial_cases (id, number, serial_id, bu_id, opened_on, closed_on, outcome, created_at, created_by, updated_at) VALUES ('c-old', 'LP-20261001-001', 'sn1', 'bu-a', '2026-10-01', '2026-10-03', 'good', '2026-10-01T00:00:00.000Z', 's', 't')",
    ).run();
    await addEvents('sn1', [[2, 'report_failure', 'c-new']]);
    const out = await call(W, 'serials.get', { id: 'sn1' });
    expect(out.data.serial).toMatchObject({
      status: 'at_service',
      custody: 'transit',
      transitFromLocationId: 'loc-sby',
      transitFromLocationName: 'Surabaya',
      transitToLocationId: 'loc-jkt',
      transitToLocationName: 'Jakarta',
      transitOn: '2026-11-10',
      openCaseNumber: 'LP-20261110-002',
    });
    expect(out.data.serial.openCase).toMatchObject({
      id: 'c-new',
      closedOn: null,
      outcome: null,
    });
    expect(out.data.serial.cases.map((c: Json) => c.id)).toEqual(['c-new', 'c-old']);
    expect(out.data.serial.cases[1]).toMatchObject({ closedOn: '2026-10-03', outcome: 'good' });
    expect(out.data.events[0]).toMatchObject({ seq: 2, caseId: 'c-new' });
    expect(out.data.events[1]).toMatchObject({ seq: 1, caseId: null });
  });

  test('serial tanpa kasus: openCase null, cases kosong, transit null', async () => {
    await seedSerial(env, { id: 'sn1', serial: 'AB12' });
    const out = await call(W, 'serials.get', { id: 'sn1' });
    expect(out.data.serial).toMatchObject({
      openCase: null,
      cases: [],
      transitFromLocationId: null,
      transitToLocationId: null,
      transitOn: null,
      openCaseNumber: null,
    });
  });
});

describe('serials.list: posisi', () => {
  test('custody=transit hanya serial dalam pengiriman, dengan tujuan dan tanggal kirim; custody tak valid: VALIDATION', async () => {
    await seedSerial(env, { id: 'a', serial: 'A1', createdAt: '2026-11-12T01:00:00.000Z' });
    await seedSerial(env, {
      id: 'b',
      serial: 'B1',
      createdAt: '2026-11-12T02:00:00.000Z',
      status: 'at_service',
      custody: 'transit',
      transitToLocationId: 'loc-jkt',
      transitOn: '2026-11-11',
      openCase: { id: 'cb', number: 'LP-20261111-001' },
    });
    await seedSerial(env, {
      id: 'c',
      serial: 'C1',
      createdAt: '2026-11-12T03:00:00.000Z',
      status: 'at_service',
      custody: 'service',
    });
    const transit = await call(W, 'serials.list', { custody: 'transit' });
    expect(transit.data.items.map((s: Json) => s.serial)).toEqual(['B1']);
    expect(transit.data.items[0]).toMatchObject({
      transitToLocationId: 'loc-jkt',
      transitToLocationName: 'Jakarta',
      transitOn: '2026-11-11',
      openCaseNumber: 'LP-20261111-001',
    });
    const service = await call(W, 'serials.list', { custody: 'service' });
    expect(service.data.items.map((s: Json) => s.serial)).toEqual(['C1']);
    const all = await call(W, 'serials.list', {});
    expect(all.data.items).toHaveLength(3);
    expect((await call(W, 'serials.list', { custody: 'lain' })).error?.code).toBe('VALIDATION');
  });
});
