// `serials.act` 5b: aksi tidak lolos, kasus, pengiriman, dan cek ulang oleh tim QC (baris 1-4, 9-16 tabel transisi).
import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { onEvent, resetEventListenersForTest } from '@server/core/events';
import { registerSerialStockListeners } from '@server/modules/sticker/serial-listener';
import { seedLocation } from '@server-test/access-fixtures';
import { restCall } from '@server-test/rest-call';
import { jsonOf, restClient } from '@server-test/rest-client';
import { SERIAL_USERS, seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;
const W = SERIAL_USERS.writer;
const AT = '2026-11-12T00:00:00.000Z';
const TODAY = '2026-11-12';
const CASE_1 = 'LP-20261112-001';

const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
  await seedSerialWorld(env);
  await seedLocation(env, { id: 'loc-off', code: 'OFF', name: 'Gudang tutup', status: 'inactive' });
  await env.DB.prepare(
    "INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES ('s1', 'loc-sby', 10, ''), ('s2', 'loc-sby', 10, ''), ('s1', 'loc-jkt', 10, ''), ('s2', 'loc-jkt', 10, '')",
  ).run();
});

const act = (
  action: string,
  extra: Record<string, unknown> = {},
  options: { email?: string; id?: string; at?: string } = {},
) =>
  call(options.email ?? W, 'serials.act', {
    id: options.id ?? 'sn1',
    expectedUpdatedAt: options.at ?? AT,
    action,
    occurredOn: TODAY,
    message: '',
    ...extra,
  });

const seedOne = (over: Record<string, unknown> = {}) =>
  seedSerial(env, {
    id: 'sn1',
    serial: 'AB12',
    stickers: [
      { stickerId: 's1', qty: 1 },
      { stickerId: 's2', qty: 1 },
    ],
    ...over,
  });
const seedFailed = (over: Record<string, unknown> = {}) =>
  seedOne({
    status: 'failed',
    openCase: { id: 'case-1', number: 'LP-20261110-001', damage: 'Layar retak' },
    ...over,
  });

async function stock(stickerId: string, locationId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT qty FROM sticker_stock WHERE sticker_id = ? AND location_id = ?',
  )
    .bind(stickerId, locationId)
    .first<{ qty: number | string }>();
  return Number(row?.qty);
}

const eventsOf = async (serialId = 'sn1') =>
  (
    await env.DB.prepare(
      'SELECT id, case_id, seq, type, actor_team, message, changes_json, data_json FROM serial_events WHERE serial_id = ? ORDER BY seq',
    )
      .bind(serialId)
      .all<{
        id: string;
        case_id: string;
        seq: number;
        type: string;
        actor_team: string;
        message: string;
        changes_json: string;
        data_json: string;
      }>()
  ).results;

const casesOf = async (serialId = 'sn1') =>
  (
    await env.DB.prepare(
      'SELECT id, number, opened_on, closed_on, damage, outcome FROM serial_cases WHERE serial_id = ? ORDER BY number',
    )
      .bind(serialId)
      .all<{
        id: string;
        number: string;
        opened_on: string;
        closed_on: string;
        damage: string;
        outcome: string;
      }>()
  ).results;

const serialRow = async (serialId = 'sn1') =>
  env.DB.prepare(
    'SELECT status, custody, location_id, open_case_id, transit_from_location_id, transit_to_location_id, transit_on FROM serials WHERE id = ?',
  )
    .bind(serialId)
    .first<{
      status: string;
      custody: string;
      location_id: string;
      open_case_id: string;
      transit_from_location_id: string;
      transit_to_location_id: string;
      transit_on: string;
    }>();

describe('report_failure (baris 1)', () => {
  test('membuka kasus LP-<hari ini>-001, status failed, kejadian ber-caseId, openCase terisi', async () => {
    await seedOne();
    const result = await act('report_failure', {
      damage: 'Layar retak',
      message: 'Jatuh saat uji',
    });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ status: 'failed', custody: 'qc', openCaseNumber: CASE_1 });
    expect(result.data.openCase).toMatchObject({
      number: CASE_1,
      openedOn: TODAY,
      closedOn: null,
      damage: 'Layar retak',
      outcome: null,
    });
    expect(result.data.cases).toHaveLength(1);
    const events = await eventsOf();
    const last = events[1];
    expect(last).toMatchObject({
      seq: 2,
      type: 'report_failure',
      actor_team: 'qc',
      message: 'Jatuh saat uji',
    });
    expect(last?.case_id).toBe(result.data.openCaseId);
    expect(JSON.parse(last?.changes_json ?? '[]')).toEqual([
      { field: 'status', from: 'Lolos', to: 'Tidak lolos' },
      { field: 'damage', from: null, to: 'Layar retak' },
    ]);
    expect((await serialRow())?.open_case_id).toBe(result.data.openCaseId);
    expect(await stock('s1', 'loc-sby')).toBe(10);
  });

  test('tanpa damage: VALIDATION; damage banyak baris atau lebih dari 200: VALIDATION', async () => {
    await seedOne();
    expect((await act('report_failure', {})).error?.code).toBe('VALIDATION');
    expect((await act('report_failure', { damage: '  ' })).error?.code).toBe('VALIDATION');
    expect((await act('report_failure', { damage: 'a\nb' })).error?.code).toBe('VALIDATION');
    expect((await act('report_failure', { damage: 'x'.repeat(201) })).error?.code).toBe(
      'VALIDATION',
    );
    expect((await casesOf()).length).toBe(0);
  });

  test('pada serial yang sudah tidak lolos: CONFLICT', async () => {
    await seedFailed();
    expect((await act('report_failure', { damage: 'x' })).error?.code).toBe('CONFLICT');
  });
});

describe('identify_damage dan attempt_repair (baris 2, 3)', () => {
  test('identify_damage mengubah damage kasus dengan chip dari-ke, status tetap', async () => {
    await seedFailed();
    const result = await act('identify_damage', { damage: 'Baterai kembung' });
    expect(result.ok).toBe(true);
    expect(result.data.status).toBe('failed');
    expect(result.data.openCase.damage).toBe('Baterai kembung');
    const event = (await eventsOf())[1];
    expect(event).toMatchObject({ type: 'identify_damage', case_id: 'case-1' });
    expect(JSON.parse(event?.changes_json ?? '[]')).toEqual([
      { field: 'damage', from: 'Layar retak', to: 'Baterai kembung' },
    ]);
  });

  test('attempt_repair: failed menjadi qc_repair; identify_damage masih boleh dari qc_repair', async () => {
    await seedFailed();
    const repair = await act('attempt_repair');
    expect(repair.data.status).toBe('qc_repair');
    const again = await act(
      'identify_damage',
      { damage: 'Konektor longgar' },
      { at: repair.data.updatedAt },
    );
    expect(again.ok).toBe(true);
    expect(again.data.status).toBe('qc_repair');
  });

  test('attempt_repair dari good: CONFLICT', async () => {
    await seedOne();
    expect((await act('attempt_repair')).error?.code).toBe('CONFLICT');
  });
});

describe('send dan receive (baris 4, 9, 14, 15)', () => {
  test('send ke servis dari failed: custody transit, tujuan tercatat, lokasi tetap, data pengiriman', async () => {
    await seedFailed();
    const result = await act('send', { toLocationId: 'loc-jkt', shipmentNote: 'JNE resi 123' });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      status: 'at_service',
      custody: 'transit',
      locationId: 'loc-sby',
      transitFromLocationId: 'loc-sby',
      transitToLocationId: 'loc-jkt',
      transitToLocationName: 'Jakarta',
      transitOn: TODAY,
    });
    const event = (await eventsOf())[1];
    expect(event).toMatchObject({ type: 'send', case_id: 'case-1', actor_team: 'qc' });
    expect(JSON.parse(event?.data_json ?? '{}')).toMatchObject({
      leg: 'to_service',
      fromLocationName: 'Surabaya',
      toLocationName: 'Jakarta',
      shipmentNote: 'JNE resi 123',
    });
  });

  test('lokasi tujuan sama dengan lokasi sekarang atau nonaktif atau tak ada: VALIDATION; stiker pada send: VALIDATION', async () => {
    await seedFailed();
    const same = await act('send', { toLocationId: 'loc-sby' });
    expect(same.error?.code).toBe('VALIDATION');
    expect(same.error?.fields?.toLocationId).toBe(
      'Lokasi tujuan harus beda dengan lokasi sekarang',
    );
    expect((await act('send', { toLocationId: 'loc-off' })).error?.code).toBe('VALIDATION');
    expect((await act('send', { toLocationId: 'tidak-ada' })).error?.code).toBe('VALIDATION');
    expect((await act('send', {})).error?.code).toBe('VALIDATION');
    const stickers = await act('send', {
      toLocationId: 'loc-jkt',
      stickers: [{ stickerId: 's1', qty: 2 }],
    });
    expect(stickers.error?.code).toBe('VALIDATION');
    expect((await serialRow())?.custody).toBe('qc');
  });

  test('catatan pengiriman lebih dari 200 atau banyak baris: VALIDATION', async () => {
    await seedFailed();
    const long = await act('send', { toLocationId: 'loc-jkt', shipmentNote: 'x'.repeat(201) });
    expect(long.error?.code).toBe('VALIDATION');
    const lines = await act('send', { toLocationId: 'loc-jkt', shipmentNote: 'a\nb' });
    expect(lines.error?.code).toBe('VALIDATION');
  });

  test('receive QC dari recheck/transit: custody qc, lokasi = tujuan, transit dikosongkan, hari di jalan', async () => {
    await seedOne({
      status: 'recheck',
      custody: 'transit',
      transitFromLocationId: 'loc-jkt',
      transitToLocationId: 'loc-sby',
      transitOn: '2026-11-09',
      locationId: 'loc-jkt',
      openCase: { id: 'case-1', number: 'LP-20261108-001' },
    });
    const result = await act('receive');
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      status: 'recheck',
      custody: 'qc',
      locationId: 'loc-sby',
      transitToLocationId: null,
      transitOn: null,
    });
    const event = (await eventsOf())[1];
    expect(event).toMatchObject({ type: 'receive', case_id: 'case-1', actor_team: 'qc' });
    expect(JSON.parse(event?.data_json ?? '{}')).toMatchObject({ leg: 'at_qc', daysInTransit: 3 });
    const changes = JSON.parse(event?.changes_json ?? '[]');
    expect(changes).toEqual([
      { field: 'custody', from: 'Dalam pengiriman', to: 'Di QC' },
      { field: 'location', from: 'Jakarta', to: 'Surabaya' },
    ]);
  });

  test('receive: tanggal terima sebelum tanggal kirim = VALIDATION pada occurredOn, tanpa efek; tanggal sama atau lebih akhir lolos', async () => {
    await seedOne({
      status: 'recheck',
      custody: 'transit',
      transitFromLocationId: 'loc-jkt',
      transitToLocationId: 'loc-sby',
      transitOn: '2026-11-09',
      locationId: 'loc-jkt',
      openCase: { id: 'case-1', number: 'LP-20261108-001' },
    });
    const early = await act('receive', { occurredOn: '2026-11-08' });
    expect(early.error?.code).toBe('VALIDATION');
    expect(early.error?.message).toBe('Tanggal terima tidak boleh sebelum tanggal kirim');
    expect(Object.keys(early.error?.fields ?? {})).toContain('occurredOn');
    expect(await serialRow()).toMatchObject({ custody: 'transit', location_id: 'loc-jkt' });
    expect((await eventsOf()).length).toBe(1);
    const same = await act('receive', { occurredOn: '2026-11-09' });
    expect(same.ok).toBe(true);
    expect(JSON.parse((await eventsOf())[1]?.data_json ?? '{}')).toMatchObject({
      daysInTransit: 0,
    });
  });

  test('send dan receive antar lokasi pada good', async () => {
    await seedOne();
    const sent = await act('send', { toLocationId: 'loc-jkt' });
    expect(sent.data).toMatchObject({ status: 'good', custody: 'transit', locationId: 'loc-sby' });
    expect(JSON.parse((await eventsOf())[1]?.data_json ?? '{}').leg).toBe('between');
    const received = await act('receive', {}, { at: sent.data.updatedAt });
    expect(received.data).toMatchObject({ status: 'good', custody: 'qc', locationId: 'loc-jkt' });
    expect(received.data.transitToLocationId).toBeNull();
    expect(JSON.parse((await eventsOf())[2]?.data_json ?? '{}').leg).toBe('between');
  });

  test('receive tanpa pengiriman berjalan (custody qc): CONFLICT; send dua kali: CONFLICT', async () => {
    await seedOne();
    expect((await act('receive')).error?.code).toBe('CONFLICT');
    const sent = await act('send', { toLocationId: 'loc-jkt' });
    expect(
      (await act('send', { toLocationId: 'loc-sby' }, { at: sent.data.updatedAt })).error?.code,
    ).toBe('CONFLICT');
  });
});

describe('cek ulang (baris 10-13)', () => {
  test('recheck_pass dari qc_repair menutup kasus good, closed_on = occurredOn, open_case_id kosong', async () => {
    await seedFailed({ status: 'qc_repair' });
    const result = await act('recheck_pass', {
      occurredOn: '2026-11-11',
      message: 'Sudah diperbaiki',
    });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      status: 'good',
      custody: 'qc',
      openCaseId: null,
      openCase: null,
    });
    expect(await casesOf()).toEqual([
      expect.objectContaining({ id: 'case-1', closed_on: '2026-11-11', outcome: 'good' }),
    ]);
    const event = (await eventsOf())[1];
    expect(event).toMatchObject({ type: 'recheck_pass', case_id: 'case-1' });
    expect(JSON.parse(event?.changes_json ?? '[]')).toEqual([
      { field: 'status', from: 'Perbaikan QC', to: 'Lolos' },
    ]);
    expect((await serialRow())?.open_case_id).toBe('');
  });

  test('recheck_pass memotong stok di lokasi cek ulang sebesar selisih stiker', async () => {
    await seedFailed({ status: 'recheck' });
    const result = await act('recheck_pass', {
      locationId: 'loc-jkt',
      stickers: [
        { stickerId: 's1', qty: 3 },
        { stickerId: 's2', qty: 1 },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.data.locationId).toBe('loc-jkt');
    expect(await stock('s1', 'loc-jkt')).toBe(8);
    expect(await stock('s2', 'loc-jkt')).toBe(10);
    expect(await stock('s1', 'loc-sby')).toBe(10);
  });

  test('recheck_fail dari recheck: failed, kasus tetap terbuka; damage opsional memperbarui kasus', async () => {
    await seedFailed({ status: 'recheck' });
    const result = await act('recheck_fail', { damage: 'Masih mati total' });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ status: 'failed', openCaseId: 'case-1' });
    expect(result.data.openCase).toMatchObject({ damage: 'Masih mati total', closedOn: null });
    const event = (await eventsOf())[1];
    expect(event).toMatchObject({ type: 'recheck_fail', case_id: 'case-1' });
    expect(JSON.parse(event?.changes_json ?? '[]')).toEqual([
      { field: 'status', from: 'Cek ulang', to: 'Tidak lolos' },
      { field: 'damage', from: 'Layar retak', to: 'Masih mati total' },
    ]);
    expect((await casesOf())[0]?.closed_on).toBe('');
  });

  test('recheck_fail dari qc_repair: CONFLICT (hanya dari recheck)', async () => {
    await seedFailed({ status: 'qc_repair' });
    expect((await act('recheck_fail')).error?.code).toBe('CONFLICT');
  });

  test('recheck hasil lolos pada good (5a): tanpa kasus, hasil pass', async () => {
    await seedOne();
    const result = await act('recheck', { result: 'pass', message: 'ok' });
    expect(result.ok).toBe(true);
    expect(result.data.status).toBe('good');
    expect(await casesOf()).toEqual([]);
    expect(JSON.parse((await eventsOf())[1]?.data_json ?? '{}').result).toBe('pass');
  });

  test('recheck hasil tidak lolos pada good: dua kejadian, kasus baru, status failed', async () => {
    await seedOne();
    const result = await act('recheck', {
      result: 'fail',
      damage: 'Port mati',
      locationId: 'loc-jkt',
      message: 'Dicek di Jakarta',
    });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      status: 'failed',
      locationId: 'loc-jkt',
      openCaseNumber: CASE_1,
    });
    const events = await eventsOf();
    expect(events.map((e) => [e.seq, e.type, e.case_id === '' ? 'tanpa-kasus' : 'kasus'])).toEqual([
      [1, 'recorded', 'tanpa-kasus'],
      [2, 'recheck', 'tanpa-kasus'],
      [3, 'report_failure', 'kasus'],
    ]);
    expect(JSON.parse(events[1]?.data_json ?? '{}')).toMatchObject({
      result: 'fail',
      locationName: 'Jakarta',
    });
    expect(events[1]?.message).toBe('Dicek di Jakarta');
    expect(events[2]?.case_id).toBe(result.data.openCaseId);
    expect(JSON.parse(events[2]?.changes_json ?? '[]')).toEqual([
      { field: 'status', from: 'Lolos', to: 'Tidak lolos' },
      { field: 'damage', from: null, to: 'Port mati' },
    ]);
    expect((await casesOf()).map((c) => [c.number, c.damage])).toEqual([[CASE_1, 'Port mati']]);
  });

  test('recheck tidak lolos tanpa damage: VALIDATION; damage pada hasil lolos: VALIDATION', async () => {
    await seedOne();
    expect((await act('recheck', { result: 'fail' })).error?.code).toBe('VALIDATION');
    expect((await act('recheck', { result: 'pass', damage: 'x' })).error?.code).toBe('VALIDATION');
    expect((await act('recheck_pass', { damage: 'x' })).error?.code).toBe('VALIDATION');
    expect((await casesOf()).length).toBe(0);
  });
});

describe('note dan keadaan akhir', () => {
  test('note pada broken boleh; aksi lain pada broken CONFLICT', async () => {
    await seedOne({ status: 'broken', custody: 'service' });
    const note = await act('note', { message: 'Arsip' });
    expect(note.ok).toBe(true);
    expect((await eventsOf())[1]).toMatchObject({ type: 'note', case_id: '' });
    for (const [action, extra] of [
      ['recheck', {}],
      ['report_failure', { damage: 'x' }],
      ['attempt_repair', {}],
      ['send', { toLocationId: 'loc-jkt' }],
    ] as const) {
      const out = await act(action, extra, { at: note.data.updatedAt });
      expect(out.error?.code).toBe('CONFLICT');
    }
  });

  test('note pada failed membawa case_id kasus terbuka', async () => {
    await seedFailed();
    await act('note', { message: 'Menunggu suku cadang' });
    expect((await eventsOf())[1]?.case_id).toBe('case-1');
  });

  test('aksi tak sah menurut status: CONFLICT; tanggal masa depan: VALIDATION', async () => {
    await seedOne();
    expect((await act('service_diagnosis', { damage: 'x' })).error?.code).toBe('CONFLICT');
    expect((await act('declare_broken')).error?.code).toBe('CONFLICT');
    expect((await act('note', { message: 'a', occurredOn: '2099-01-01' })).error?.code).toBe(
      'VALIDATION',
    );
  });

  test('expectedUpdatedAt usang: CONFLICT (stale) tanpa efek', async () => {
    await seedOne();
    const out = await act('report_failure', { damage: 'x' }, { at: '2026-01-01T00:00:00.000Z' });
    expect(out.error?.code).toBe('CONFLICT');
    expect((await casesOf()).length).toBe(0);
    expect((await serialRow())?.status).toBe('good');
  });
});

describe('izin per baris', () => {
  test('serial: edit tidak menjalankan aksi servis: FORBIDDEN', async () => {
    await seedOne({
      status: 'at_service',
      custody: 'service',
      openCase: { id: 'case-1', number: 'LP-20261110-001' },
    });
    for (const [action, extra] of [
      ['service_diagnosis', { damage: 'x' }],
      ['declare_broken', {}],
    ] as const) {
      expect((await act(action, extra)).error?.code).toBe('FORBIDDEN');
    }
    expect((await serialRow())?.status).toBe('at_service');
  });

  test('serial: edit tidak mengirim balik ke QC dari service_repair: FORBIDDEN', async () => {
    await seedOne({
      status: 'service_repair',
      custody: 'service',
      openCase: { id: 'case-1', number: 'LP-20261110-001' },
    });
    expect((await act('send', { toLocationId: 'loc-jkt' })).error?.code).toBe('FORBIDDEN');
  });

  test('serialservice: edit tidak menjalankan aksi QC maupun note pada good/failed: FORBIDDEN', async () => {
    await seedFailed();
    for (const [action, extra] of [
      ['identify_damage', { damage: 'x' }],
      ['attempt_repair', {}],
      ['note', { message: 'x' }],
    ] as const) {
      expect((await act(action, extra, { email: SERIAL_USERS.svcEdit })).error?.code).toBe(
        'FORBIDDEN',
      );
    }
  });

  test('serial: edit di BU A + serial: view di BU B pada serial BU B: FORBIDDEN; tanpa baca BU B: NOT_FOUND', async () => {
    await seedSerial(env, { id: 'sn-b', serial: 'BB1', buId: 'bu-b', itemId: 'i-b' });
    expect(
      (await act('note', { message: 'x' }, { id: 'sn-b', email: SERIAL_USERS.mixed })).error?.code,
    ).toBe('FORBIDDEN');
    expect((await act('note', { message: 'x' }, { id: 'sn-b' })).error?.code).toBe('NOT_FOUND');
  });

  test('pemegang kedua modul memenuhi baris QC', async () => {
    await seedFailed();
    const out = await act('attempt_repair', {}, { email: SERIAL_USERS.hybrid });
    expect(out.ok).toBe(true);
    expect((await eventsOf())[1]?.actor_team).toBe('qc');
  });
});

describe('gambar pada pesan', () => {
  const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  async function uploadImage(email: string = W): Promise<string> {
    const bytes = new Uint8Array(16);
    bytes.set(PNG_HEAD, 0);
    const response = await restClient(env).post('/files?width=2&height=2', {
      email,
      raw: bytes,
      headers: { 'content-type': 'image/png' },
    });
    expect(response.status).toBe(201);
    return (await jsonOf(response)).id as string;
  }
  const md = (...ids: string[]) => ids.map((id) => `![gambar](qcfile:${id})`).join('\n');
  const ownerOf = async (id: string) =>
    env.DB.prepare('SELECT owner_type, owner_id FROM files WHERE id = ?')
      .bind(id)
      .first<{ owner_type: string; owner_id: string }>();

  test('gambar unggahan sendiri diklaim pemilik serial dalam batch aksi', async () => {
    await seedOne();
    const id = await uploadImage();
    const out = await act('note', { message: md(id) });
    expect(out.ok).toBe(true);
    expect(await ownerOf(id)).toEqual({ owner_type: 'serial', owner_id: 'sn1' });
  });

  test('gambar milik item atau unggahan orang lain: VALIDATION, tanpa efek', async () => {
    await seedOne();
    const itemImage = await uploadImage();
    await env.DB.prepare("UPDATE files SET owner_type = 'item', owner_id = 'i-a1' WHERE id = ?")
      .bind(itemImage)
      .run();
    expect((await act('note', { message: md(itemImage) })).error?.code).toBe('VALIDATION');
    const others = await uploadImage(SERIAL_USERS.both);
    expect((await act('note', { message: md(others) })).error?.code).toBe('VALIDATION');
    expect((await eventsOf()).length).toBe(1);
  });

  test('11 gambar pada satu pesan: VALIDATION; 10 gambar diterima', async () => {
    await seedOne();
    const ids: string[] = [];
    for (let i = 0; i < 11; i++) ids.push(await uploadImage());
    expect((await act('note', { message: md(...ids) })).error?.code).toBe('VALIDATION');
    const ok = await act('note', { message: md(...ids.slice(0, 10)) });
    expect(ok.ok).toBe(true);
  });
});

describe('konkurensi nomor kasus (Promise.all)', () => {
  test('report_failure pada dua serial BERBEDA di hari yang sama: keduanya sukses, nomor berbeda', async () => {
    await seedSerial(env, { id: 'sn1', serial: 'AB12' });
    await seedSerial(env, { id: 'sn2', serial: 'AB13' });
    const [a, b] = await Promise.all([
      act('report_failure', { damage: 'A' }, { id: 'sn1' }),
      act('report_failure', { damage: 'B' }, { id: 'sn2' }),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect([a.data.openCaseNumber, b.data.openCaseNumber].sort()).toEqual([
      'LP-20261112-001',
      'LP-20261112-002',
    ]);
  });

  test('empat serial serentak: empat nomor unik', async () => {
    const ids = ['sn1', 'sn2', 'sn3', 'sn4'];
    for (const id of ids) await seedSerial(env, { id, serial: `X-${id}` });
    const results = await Promise.all(
      ids.map((id) => act('report_failure', { damage: id }, { id })),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(new Set(results.map((r) => r.data.openCaseNumber)).size).toBe(4);
  });

  test('serial SAMA dua kali: satu sukses, satu stale, hanya satu kasus', async () => {
    await seedOne();
    const [a, b] = await Promise.all([
      act('report_failure', { damage: 'A' }),
      act('report_failure', { damage: 'B' }),
    ]);
    expect([a.ok, b.ok].filter(Boolean).length).toBe(1);
    const failed = a.ok ? b : a;
    expect(failed.error?.code).toBe('CONFLICT');
    expect((await casesOf()).length).toBe(1);
  });
});

describe('atomisitas', () => {
  test('galat pada pernyataan TERAKHIR batch membatalkan semuanya (status, kasus, kejadian, stok, berkas)', async () => {
    await seedFailed({ status: 'recheck' });
    resetEventListenersForTest();
    registerSerialStockListeners();
    // Pernyataan terakhir batch gagal (tabel tak ada): seluruh transaksi harus dibatalkan.
    onEvent('serial.stickers_added', (e) => [
      e.DB.prepare('INSERT INTO tabel_tidak_ada (x) VALUES (1)'),
    ]);
    const realError = console.error;
    console.error = () => undefined;
    try {
      const out = await act('recheck_pass', {
        message: 'Lolos',
        stickers: [{ stickerId: 's1', qty: 4 }],
      });
      expect(out.ok).toBe(false);
    } finally {
      console.error = realError;
      resetEventListenersForTest();
      registerSerialStockListeners();
    }
    expect(await serialRow()).toMatchObject({ status: 'recheck', open_case_id: 'case-1' });
    expect((await casesOf())[0]).toMatchObject({ closed_on: '', outcome: '' });
    expect((await eventsOf()).length).toBe(1);
    expect(await stock('s1', 'loc-sby')).toBe(10);
    const qty = await env.DB.prepare(
      "SELECT qty FROM serial_stickers WHERE serial_id = 'sn1' AND sticker_id = 's1'",
    ).first<{ qty: number }>();
    expect(Number(qty?.qty)).toBe(1);
  });

  test('recheck_fail: stiker dinonaktifkan serentak (setelah dibaca, sebelum batch) = CONFLICT usang, tanpa efek; sudah nonaktif sebelumnya = VALIDATION', async () => {
    await seedFailed({ status: 'recheck' });
    resetEventListenersForTest();
    registerSerialStockListeners();
    // Meniru penyunting lain: stiker dinonaktifkan tepat setelah pemeriksaan di sisi aplikasi (sekali saja).
    let fired = false;
    onEvent('serial.stickers_added', async (e) => {
      if (!fired) {
        fired = true;
        await e.DB.prepare("UPDATE stickers SET status = 'inactive' WHERE id = 's1'").run();
      }
      return [];
    });
    // Pendengar stok terdaftar SESUDAH pengganggu agar penjaga stiker nonaktif ikut membatalkan batch.
    registerSerialStockListeners();
    let out: CallOut;
    try {
      out = await act('recheck_fail', {
        damage: 'Masih mati',
        stickers: [{ stickerId: 's1', qty: 4 }],
      });
    } finally {
      resetEventListenersForTest();
      registerSerialStockListeners();
    }
    expect(out.ok).toBe(false);
    expect(out.error?.code).toBe('CONFLICT');
    expect(out.error?.message).toContain('Serial Number sudah diubah orang lain');
    expect(await serialRow()).toMatchObject({ status: 'recheck', open_case_id: 'case-1' });
    expect((await eventsOf()).length).toBe(1);
    expect(await stock('s1', 'loc-sby')).toBe(10);

    // Sekarang s1 SUDAH nonaktif sebelum permintaan: VALIDATION pada field `stickers`.
    const again = await act('recheck_fail', {
      damage: 'Masih mati',
      stickers: [{ stickerId: 's1', qty: 4 }],
    });
    expect(again.error?.code).toBe('VALIDATION');
    expect(Object.keys(again.error?.fields ?? {})).toContain('stickers');
  });
});
