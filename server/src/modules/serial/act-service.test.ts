// `serials.act` 5b: aksi tim servis (baris 5-8 dan 17 tabel transisi) dan batas `serialservice`.
import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { onEvent, resetEventListenersForTest } from '@server/core/events';
import { registerSerialStockListeners } from '@server/modules/sticker/serial-listener';
import { restCall } from '@server-test/rest-call';
import { SERIAL_USERS, seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;
const SVC = SERIAL_USERS.svcEdit;
const AT = '2026-11-12T00:00:00.000Z';
const TODAY = '2026-11-12';

const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
  await seedSerialWorld(env);
});

const act = (
  action: string,
  extra: Record<string, unknown> = {},
  options: { email?: string; id?: string; at?: string } = {},
) =>
  call(options.email ?? SVC, 'serials.act', {
    id: options.id ?? 'sn1',
    expectedUpdatedAt: options.at ?? AT,
    action,
    occurredOn: TODAY,
    message: '',
    ...extra,
  });

const CASE = { id: 'case-1', number: 'LP-20261110-001', damage: 'Layar retak' };
const seedAt = (status: string, custody: string, over: Record<string, unknown> = {}) =>
  seedSerial(env, {
    id: 'sn1',
    serial: 'AB12',
    status,
    custody,
    openCase: CASE,
    ...(custody === 'transit'
      ? {
          transitFromLocationId: 'loc-sby',
          transitToLocationId: 'loc-jkt',
          transitOn: '2026-11-10',
        }
      : {}),
    ...over,
  });

const eventsOf = async () =>
  (
    await env.DB.prepare(
      'SELECT seq, case_id, type, actor_team, changes_json, data_json FROM serial_events WHERE serial_id = ? ORDER BY seq',
    )
      .bind('sn1')
      .all<{
        seq: number;
        case_id: string;
        type: string;
        actor_team: string;
        changes_json: string;
        data_json: string;
      }>()
  ).results;

const serialRow = async () =>
  env.DB.prepare('SELECT status, custody, location_id, open_case_id FROM serials WHERE id = ?')
    .bind('sn1')
    .first<{ status: string; custody: string; location_id: string; open_case_id: string }>();

describe('receive oleh servis (baris 5)', () => {
  test('at_service/transit: custody service, lokasi = tujuan, hari di jalan, tim service', async () => {
    await seedAt('at_service', 'transit');
    const result = await act('receive');
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      status: 'at_service',
      custody: 'service',
      locationId: 'loc-jkt',
      transitToLocationId: null,
    });
    const event = (await eventsOf())[1];
    expect(event).toMatchObject({ type: 'receive', actor_team: 'service', case_id: 'case-1' });
    expect(JSON.parse(event?.data_json ?? '{}')).toMatchObject({
      leg: 'at_service',
      daysInTransit: 2,
    });
  });

  test('receive oleh tim QC pada at_service: FORBIDDEN', async () => {
    await seedAt('at_service', 'transit');
    expect((await act('receive', {}, { email: SERIAL_USERS.writer })).error?.code).toBe(
      'FORBIDDEN',
    );
  });
});

describe('diagnosis, rusak, dan kirim balik (baris 6, 7, 8)', () => {
  test('service_diagnosis: at_service/service menjadi service_repair, damage kasus diperbarui', async () => {
    await seedAt('at_service', 'service', { locationId: 'loc-jkt' });
    const result = await act('service_diagnosis', { damage: 'Motherboard rusak, bisa diganti' });
    expect(result.ok).toBe(true);
    expect(result.data.status).toBe('service_repair');
    expect(result.data.openCase.damage).toBe('Motherboard rusak, bisa diganti');
    const event = (await eventsOf())[1];
    expect(event).toMatchObject({ type: 'service_diagnosis', actor_team: 'service' });
    expect(JSON.parse(event?.changes_json ?? '[]')).toEqual([
      { field: 'status', from: 'Di servis', to: 'Perbaikan servis' },
      { field: 'damage', from: 'Layar retak', to: 'Motherboard rusak, bisa diganti' },
    ]);
  });

  test('service_diagnosis sebelum receive (custody transit): CONFLICT', async () => {
    await seedAt('at_service', 'transit');
    expect((await act('service_diagnosis', { damage: 'x' })).error?.code).toBe('CONFLICT');
    expect((await act('declare_broken')).error?.code).toBe('CONFLICT');
  });

  test('service_diagnosis tanpa damage: VALIDATION', async () => {
    await seedAt('at_service', 'service');
    expect((await act('service_diagnosis', {})).error?.code).toBe('VALIDATION');
  });

  test('declare_broken dari at_service dan dari service_repair: broken, kasus outcome broken, tim service', async () => {
    for (const status of ['at_service', 'service_repair']) {
      env = await createTestEnv();
      env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
      await seedSerialWorld(env);
      await seedAt(status, 'service');
      const result = await act('declare_broken', { message: 'Tidak bisa diperbaiki' });
      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({ status: 'broken', openCaseId: null, openCase: null });
      const c = await env.DB.prepare(
        "SELECT closed_on, outcome FROM serial_cases WHERE id = 'case-1'",
      ).first<{ closed_on: string; outcome: string }>();
      expect(c).toEqual({ closed_on: TODAY, outcome: 'broken' });
      const event = (await eventsOf())[1];
      expect(event).toMatchObject({
        type: 'declare_broken',
        actor_team: 'service',
        case_id: 'case-1',
      });
      expect((await serialRow())?.open_case_id).toBe('');
    }
  });

  test('declare_broken memanggil pendengar serial.declared_broken tepat sekali dengan id yang benar', async () => {
    await seedAt('service_repair', 'service');
    const seen: unknown[] = [];
    resetEventListenersForTest();
    registerSerialStockListeners();
    onEvent('serial.declared_broken', (_env, payload) => {
      seen.push(payload);
      return [];
    });
    try {
      const result = await act('declare_broken');
      expect(result.ok).toBe(true);
    } finally {
      resetEventListenersForTest();
      registerSerialStockListeners();
    }
    const event = (await eventsOf())[1];
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ serialId: 'sn1', caseId: 'case-1' });
    expect((seen[0] as { eventId: string }).eventId).toBeTruthy();
    expect(event?.type).toBe('declare_broken');
  });

  test('declare_broken yang batal (stale) tidak memicu pendengar', async () => {
    await seedAt('service_repair', 'service');
    let calls = 0;
    resetEventListenersForTest();
    registerSerialStockListeners();
    onEvent('serial.declared_broken', () => {
      calls++;
      return [];
    });
    try {
      const stale = await act('declare_broken', {}, { at: '2026-01-01T00:00:00.000Z' });
      expect(stale.error?.code).toBe('CONFLICT');
    } finally {
      resetEventListenersForTest();
      registerSerialStockListeners();
    }
    expect(calls).toBe(0);
  });

  test('galat pada pernyataan terakhir (pendengar) membatalkan declare_broken seluruhnya', async () => {
    await seedAt('service_repair', 'service');
    resetEventListenersForTest();
    registerSerialStockListeners();
    onEvent('serial.declared_broken', (e) => [
      e.DB.prepare('INSERT INTO tabel_tidak_ada (x) VALUES (1)'),
    ]);
    const realError = console.error;
    console.error = () => undefined;
    try {
      expect((await act('declare_broken')).ok).toBe(false);
    } finally {
      console.error = realError;
      resetEventListenersForTest();
      registerSerialStockListeners();
    }
    expect(await serialRow()).toMatchObject({ status: 'service_repair', open_case_id: 'case-1' });
    const c = await env.DB.prepare(
      "SELECT closed_on, outcome FROM serial_cases WHERE id = 'case-1'",
    ).first<{
      closed_on: string;
      outcome: string;
    }>();
    expect(c).toEqual({ closed_on: '', outcome: '' });
    expect((await eventsOf()).length).toBe(1);
  });

  test('send kembali ke QC dari service_repair: recheck/transit, lokasi tujuan tercatat', async () => {
    await seedAt('service_repair', 'service', { locationId: 'loc-jkt' });
    const result = await act('send', { toLocationId: 'loc-sby', shipmentNote: 'Kurir internal' });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      status: 'recheck',
      custody: 'transit',
      locationId: 'loc-jkt',
      transitFromLocationId: 'loc-jkt',
      transitToLocationId: 'loc-sby',
    });
    const event = (await eventsOf())[1];
    expect(event).toMatchObject({ type: 'send', actor_team: 'service' });
    expect(JSON.parse(event?.data_json ?? '{}')).toMatchObject({
      leg: 'to_qc',
      shipmentNote: 'Kurir internal',
    });
  });

  test('alur utuh: kirim ke servis, diterima, diagnosis, kirim balik, diterima QC, cek ulang lolos', async () => {
    await seedSerial(env, {
      id: 'sn1',
      serial: 'AB12',
      status: 'failed',
      openCase: CASE,
      stickers: [{ stickerId: 's1', qty: 1 }],
    });
    const sent = await act('send', { toLocationId: 'loc-jkt' }, { email: SERIAL_USERS.hybrid });
    expect(sent.ok).toBe(true);
    const received = await act('receive', {}, { at: sent.data.updatedAt });
    const diagnosed = await act(
      'service_diagnosis',
      { damage: 'Ganti PSU' },
      { at: received.data.updatedAt },
    );
    const back = await act('send', { toLocationId: 'loc-sby' }, { at: diagnosed.data.updatedAt });
    const atQc = await act('receive', {}, { at: back.data.updatedAt, email: SERIAL_USERS.writer });
    expect(atQc.data).toMatchObject({ status: 'recheck', custody: 'qc', locationId: 'loc-sby' });
    const done = await act(
      'recheck_pass',
      {},
      { at: atQc.data.updatedAt, email: SERIAL_USERS.writer },
    );
    expect(done.data).toMatchObject({ status: 'good', openCaseId: null });
    expect((await eventsOf()).map((e) => [e.type, e.actor_team])).toEqual([
      ['recorded', 'qc'],
      ['send', 'qc'],
      ['receive', 'service'],
      ['service_diagnosis', 'service'],
      ['send', 'service'],
      ['receive', 'qc'],
      ['recheck_pass', 'qc'],
    ]);
  });
});

describe('note dan batas serialservice (baris 16, 17)', () => {
  test('note pada service_repair: tim service oleh servis, tim qc oleh pencatat', async () => {
    await seedAt('service_repair', 'service');
    const bySvc = await act('note', { message: 'Menunggu suku cadang' });
    expect(bySvc.ok).toBe(true);
    const byQc = await act(
      'note',
      { message: 'Info dari QC' },
      { email: SERIAL_USERS.writer, at: bySvc.data.updatedAt },
    );
    expect(byQc.ok).toBe(true);
    expect((await eventsOf()).map((e) => e.actor_team)).toEqual(['qc', 'service', 'qc']);
  });

  test('pemegang kedua modul: note pada at_service = tim service', async () => {
    await seedAt('at_service', 'service');
    await act('note', { message: 'x' }, { email: SERIAL_USERS.hybrid });
    expect((await eventsOf())[1]?.actor_team).toBe('service');
  });

  test('serialservice pada good, failed, recheck: aksi yang ada tetapi bukan miliknya FORBIDDEN, yang tak ada CONFLICT', async () => {
    // F = baris tabel ada tetapi modulnya bukan serialservice; C = tak ada baris untuk aksi itu pada status tersebut.
    const expectations: Record<string, Record<string, 'FORBIDDEN' | 'CONFLICT'>> = {
      good: {
        note: 'FORBIDDEN',
        recheck: 'FORBIDDEN',
        report_failure: 'FORBIDDEN',
        send: 'FORBIDDEN',
        attempt_repair: 'CONFLICT',
        recheck_pass: 'CONFLICT',
      },
      failed: {
        note: 'FORBIDDEN',
        attempt_repair: 'FORBIDDEN',
        send: 'FORBIDDEN',
        recheck: 'CONFLICT',
        report_failure: 'CONFLICT',
        recheck_pass: 'CONFLICT',
      },
      recheck: {
        note: 'FORBIDDEN',
        recheck_pass: 'FORBIDDEN',
        recheck: 'CONFLICT',
        report_failure: 'CONFLICT',
        attempt_repair: 'CONFLICT',
        send: 'CONFLICT',
      },
    };
    const inputs: Record<string, Record<string, unknown>> = {
      note: { message: 'x' },
      report_failure: { damage: 'x' },
      send: { toLocationId: 'loc-jkt' },
    };
    for (const [status, table] of Object.entries(expectations)) {
      env = await createTestEnv();
      env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
      await seedSerialWorld(env);
      await seedAt(status, 'qc');
      for (const [action, code] of Object.entries(table)) {
        const out = await act(action, inputs[action] ?? {});
        expect([status, action, out.error?.code]).toEqual([status, action, code]);
      }
      expect((await serialRow())?.status).toBe(status);
    }
  });

  test('serialservice BU B pada serial BU A: NOT_FOUND', async () => {
    await seedAt('at_service', 'service');
    expect((await act('note', { message: 'x' }, { email: SERIAL_USERS.svcB })).error?.code).toBe(
      'NOT_FOUND',
    );
  });

  test('serialservice tidak dapat mencatat, mengubah, atau memilih stiker: FORBIDDEN', async () => {
    await seedAt('at_service', 'service');
    const row = {
      clientId: 'client-baru-1',
      serial: 'ZZ99',
      itemId: 'i-a1',
      buId: 'bu-a',
      testDate: TODAY,
      locationId: 'loc-sby',
      sample: false,
      note: '',
      status: 'good',
    };
    expect((await call(SVC, 'serials.saveBatch', { rows: [row] })).error?.code).toBe('FORBIDDEN');
    expect(
      (
        await call(SVC, 'serials.update', {
          id: 'sn1',
          expectedUpdatedAt: AT,
          serial: 'AB12',
          itemId: 'i-a1',
          testDate: TODAY,
          sample: false,
          note: '',
          locationId: 'loc-sby',
        })
      ).error?.code,
    ).toBe('FORBIDDEN');
    expect(
      (
        await call(SVC, 'serials.updateBatch', {
          rows: [{ id: 'sn1', expectedUpdatedAt: AT, fields: { note: 'x' } }],
        })
      ).error?.code,
    ).toBe('FORBIDDEN');
    expect(
      (await call(SVC, 'serials.stickerOptions', { itemId: 'i-a1', buId: 'bu-a' })).error?.code,
    ).toBe('FORBIDDEN');
  });

  test('serialservice: edit boleh memuat pilihan lokasi (keputusan pemilik 2026-11-13); serialservice view saja tidak', async () => {
    const ok = await call(SVC, 'serials.locationOptions', null);
    expect(ok.ok).toBe(true);
    expect(ok.data.locations.map((l: { id: string }) => l.id)).toEqual(['loc-jkt', 'loc-sby']);
    expect((await call(SERIAL_USERS.service, 'serials.locationOptions', null)).error?.code).toBe(
      'FORBIDDEN',
    );
  });

  test('serialservice view saja tidak dapat beraksi: FORBIDDEN di gerbang rute', async () => {
    await seedAt('at_service', 'service');
    expect((await act('note', { message: 'x' }, { email: SERIAL_USERS.service })).error?.code).toBe(
      'FORBIDDEN',
    );
  });
});
