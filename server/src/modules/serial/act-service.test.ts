// `serials.act` alur laporan rusak (2026-11-14): aksi tim servis (baris 3-7 dan 14 tabel transisi), Terima otomatis,
// dan batas `serialservice`.
import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { onEvent, resetEventListenersForTest } from '@server/core/events';
import { registerSerialStockListeners } from '@server/modules/sticker/serial-listener';
import { seedLocation } from '@server-test/access-fixtures';
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
  await seedLocation(env, { id: 'loc-off', code: 'OFF', name: 'Gudang tutup', status: 'inactive' });
});

const act = (
  action: string,
  extra: Record<string, unknown> = {},
  options: { email?: string; id?: string; at?: string; occurredOn?: string } = {},
) =>
  call(options.email ?? SVC, 'serials.act', {
    id: options.id ?? 'sn1',
    expectedUpdatedAt: options.at ?? AT,
    action,
    occurredOn: options.occurredOn ?? TODAY,
    message: '',
    ...extra,
  });

const CASE = { id: 'case-1', number: 'LP/A/2611-0001', originLocationId: 'loc-sby' };
/** Serial di tim servis (Jakarta). `transit` = baru dikirim dari Surabaya pada 2026-11-10. */
const seedAt = (status: string, custody: string, over: Record<string, unknown> = {}) =>
  seedSerial(env, {
    id: 'sn1',
    serial: 'AB12',
    status,
    custody,
    openCase: CASE,
    locationId: custody === 'transit' ? 'loc-sby' : 'loc-jkt',
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
      'SELECT seq, case_id, type, actor_team, message, changes_json, data_json FROM serial_events WHERE serial_id = ? ORDER BY seq',
    )
      .bind('sn1')
      .all<{
        seq: number;
        case_id: string;
        type: string;
        actor_team: string;
        message: string;
        changes_json: string;
        data_json: string;
      }>()
  ).results;

const serialRow = async () =>
  env.DB.prepare(
    'SELECT status, custody, location_id, open_case_id, transit_from_location_id, transit_to_location_id, transit_on FROM serials WHERE id = ?',
  )
    .bind('sn1')
    .first<{
      status: string;
      custody: string;
      location_id: string;
      open_case_id: string;
      transit_from_location_id: string;
      transit_to_location_id: string;
      transit_on: string;
    }>();

describe('receive oleh servis (baris 3)', () => {
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

  test('tanggal terima sebelum tanggal kirim: VALIDATION occurredOn; toLocationId pada terima servis: VALIDATION', async () => {
    await seedAt('at_service', 'transit');
    const early = await act('receive', {}, { occurredOn: '2026-11-09' });
    expect(early.error?.code).toBe('VALIDATION');
    expect(Object.keys(early.error?.fields ?? {})).toContain('occurredOn');
    expect((await act('receive', { toLocationId: 'loc-sby' })).error?.code).toBe('VALIDATION');
    expect((await serialRow())?.custody).toBe('transit');
  });

  test('receive oleh tim QC pada at_service: FORBIDDEN', async () => {
    await seedAt('at_service', 'transit');
    expect((await act('receive', {}, { email: SERIAL_USERS.writer })).error?.code).toBe(
      'FORBIDDEN',
    );
  });
});

describe('diagnosis (baris 4-6)', () => {
  test('stage diagnosis dari at_service/service: status diagnosis, kustodi tetap service, catatan opsional', async () => {
    await seedAt('at_service', 'service');
    const result = await act('service_diagnosis', { stage: 'diagnosis' });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ status: 'diagnosis', custody: 'service' });
    const event = (await eventsOf())[1];
    expect(event).toMatchObject({
      type: 'service_diagnosis',
      actor_team: 'service',
      case_id: 'case-1',
    });
    expect(JSON.parse(event?.changes_json ?? '[]')).toEqual([
      { field: 'status', from: 'Di servis', to: 'Diagnosis' },
    ]);
    expect(JSON.parse(event?.data_json ?? '{}')).toMatchObject({ stage: 'diagnosis' });
  });

  test('stage repairing dari diagnosis: Sedang diperbaiki; diagnosis ulang dari service_repair boleh', async () => {
    await seedAt('diagnosis', 'service');
    const repairing = await act('service_diagnosis', { stage: 'repairing', message: 'Ganti PSU' });
    expect(repairing.data.status).toBe('service_repair');
    expect((await eventsOf())[1]?.message).toBe('Ganti PSU');
    const again = await act(
      'service_diagnosis',
      { stage: 'diagnosis' },
      { at: repairing.data.updatedAt },
    );
    expect(again.data.status).toBe('diagnosis');
  });

  test('tanpa stage atau stage tak dikenal: VALIDATION', async () => {
    await seedAt('at_service', 'service');
    const none = await act('service_diagnosis');
    expect(none.error?.code).toBe('VALIDATION');
    expect(Object.keys(none.error?.fields ?? {})).toContain('stage');
    expect((await act('service_diagnosis', { stage: 'rusak' })).error?.code).toBe('VALIDATION');
    expect((await act('note', { message: 'x', stage: 'done' })).error?.code).toBe('VALIDATION');
  });

  test('stage done dari service_repair: recheck/transit, asal = lokasi servis, tujuan = lokasi QC asal laporan', async () => {
    await seedAt('service_repair', 'service');
    const result = await act('service_diagnosis', { stage: 'done', message: 'Sudah diganti' });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      status: 'recheck',
      custody: 'transit',
      locationId: 'loc-jkt',
      transitFromLocationId: 'loc-jkt',
      transitToLocationId: 'loc-sby',
      transitOn: TODAY,
    });
    const event = (await eventsOf())[1];
    expect(event).toMatchObject({ type: 'service_diagnosis', actor_team: 'service' });
    expect(JSON.parse(event?.data_json ?? '{}')).toMatchObject({
      stage: 'done',
      leg: 'to_qc',
      toLocationName: 'Surabaya',
    });
    expect(JSON.parse(event?.changes_json ?? '[]')).toEqual([
      { field: 'status', from: 'Sedang diperbaiki', to: 'Menunggu cek ulang' },
      { field: 'custody', from: 'Di servis', to: 'Dalam pengiriman' },
    ]);
  });

  test('stage done: lokasi QC asal nonaktif tetap jadi tujuan (Terima QC yang meminta lokasi lain)', async () => {
    await seedAt('service_repair', 'service', {
      openCase: { ...CASE, originLocationId: 'loc-off' },
    });
    const result = await act('service_diagnosis', { stage: 'done' });
    expect(result.data.transitToLocationId).toBe('loc-off');
  });

  test('stage done tanpa lokasi QC asal tercatat (data lama): tujuan = lokasi unit sekarang', async () => {
    await seedAt('service_repair', 'service', {
      openCase: { ...CASE, originLocationId: '' },
      recordedLocationId: 'loc-sby',
    });
    const result = await act('service_diagnosis', { stage: 'done' });
    expect(result.data.transitToLocationId).toBe('loc-jkt');
  });

  test('laporan baru menyimpan lokasi unit saat dilaporkan sebagai lokasi QC asal', async () => {
    await seedSerial(env, {
      id: 'sn1',
      serial: 'AB12',
      status: 'good',
      custody: 'qc',
      locationId: 'loc-sby',
    });
    const reported = await act(
      'report_failure',
      { message: 'Rusak' },
      { email: SERIAL_USERS.hybrid },
    );
    expect(reported.ok).toBe(true);
    const row = await env.DB.prepare(
      'SELECT origin_location_id FROM serial_cases WHERE serial_id = ?',
    )
      .bind('sn1')
      .first<{ origin_location_id: string }>();
    expect(row?.origin_location_id).toBe('loc-sby');
  });

  test('cek ulang dari transit ke lokasi QC asal nonaktif ditolak: terima dulu di lokasi aktif', async () => {
    await seedAt('recheck', 'transit', {
      openCase: { ...CASE, originLocationId: 'loc-off' },
      locationId: 'loc-jkt',
      transitFromLocationId: 'loc-jkt',
      transitToLocationId: 'loc-off',
      transitOn: '2026-11-10',
    });
    const result = await act('recheck_pass', {}, { email: SERIAL_USERS.hybrid });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('VALIDATION');
    expect(JSON.stringify(result.error)).toContain('Terima dulu unitnya di lokasi aktif');
    const row = await env.DB.prepare(
      'SELECT status, custody, location_id FROM serials WHERE id = ?',
    )
      .bind('sn1')
      .first<{ status: string; custody: string; location_id: string }>();
    expect(row).toMatchObject({ status: 'recheck', custody: 'transit', location_id: 'loc-jkt' });
  });

  test('diagnosis langsung dari custody transit: dua kejadian (receive otomatis lalu service_diagnosis) dalam satu batch', async () => {
    await seedAt('at_service', 'transit');
    const result = await act('service_diagnosis', { stage: 'diagnosis' });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      status: 'diagnosis',
      custody: 'service',
      locationId: 'loc-jkt',
      transitToLocationId: null,
    });
    const events = await eventsOf();
    expect(events.map((event) => [event.seq, event.type, event.actor_team, event.case_id])).toEqual(
      [
        [1, 'recorded', 'qc', ''],
        [2, 'receive', 'service', 'case-1'],
        [3, 'service_diagnosis', 'service', 'case-1'],
      ],
    );
    expect(JSON.parse(events[1]?.data_json ?? '{}')).toMatchObject({
      leg: 'at_service',
      auto: true,
      daysInTransit: 2,
    });
    expect(JSON.parse(events[1]?.changes_json ?? '[]')).toEqual([
      { field: 'custody', from: 'Dalam pengiriman', to: 'Di servis' },
      { field: 'location', from: 'Surabaya', to: 'Jakarta' },
    ]);
    // Aksi sendiri: hanya perubahan status (kustodi sudah service sesudah Terima otomatis).
    expect(JSON.parse(events[2]?.changes_json ?? '[]')).toEqual([
      { field: 'status', from: 'Di servis', to: 'Diagnosis' },
    ]);
  });

  test('diagnosis selesai langsung dari transit: kembali ke transit dengan asal = lokasi servis, tujuan = lokasi QC asal', async () => {
    await seedAt('at_service', 'transit');
    const result = await act('service_diagnosis', { stage: 'done' });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      status: 'recheck',
      custody: 'transit',
      transitFromLocationId: 'loc-jkt',
      transitToLocationId: 'loc-sby',
    });
    const events = await eventsOf();
    expect(events.map((event) => event.type)).toEqual(['recorded', 'receive', 'service_diagnosis']);
    expect(JSON.parse(events[2]?.changes_json ?? '[]')).toEqual([
      { field: 'status', from: 'Di servis', to: 'Menunggu cek ulang' },
      { field: 'custody', from: 'Di servis', to: 'Dalam pengiriman' },
    ]);
  });

  test('diagnosis dari transit dengan tanggal sebelum tanggal kirim: VALIDATION occurredOn, tanpa efek; tanggal sama lolos', async () => {
    await seedAt('at_service', 'transit');
    const early = await act(
      'service_diagnosis',
      { stage: 'diagnosis' },
      { occurredOn: '2026-11-09' },
    );
    expect(early.error?.code).toBe('VALIDATION');
    expect(Object.keys(early.error?.fields ?? {})).toContain('occurredOn');
    expect(await eventsOf()).toHaveLength(1);
    expect((await serialRow())?.custody).toBe('transit');
    const ok = await act('service_diagnosis', { stage: 'diagnosis' }, { occurredOn: '2026-11-10' });
    expect(ok.ok).toBe(true);
  });

  test('diagnosis oleh tim QC: FORBIDDEN; pada status Lolos atau Dilaporkan: CONFLICT', async () => {
    await seedAt('at_service', 'service');
    expect(
      (await act('service_diagnosis', { stage: 'done' }, { email: SERIAL_USERS.writer })).error
        ?.code,
    ).toBe('FORBIDDEN');
    await env.DB.prepare("UPDATE serials SET status = 'reported', custody = 'qc'").run();
    expect((await act('service_diagnosis', { stage: 'done' })).error?.code).toBe('CONFLICT');
  });
});

describe('declare_broken: Rusak (baris 7)', () => {
  test('dari at_service/transit (Terima otomatis) dan dari diagnosis: broken, laporan outcome broken, tim service', async () => {
    await seedAt('at_service', 'transit');
    const fromTransit = await act('declare_broken', {
      message: 'Motherboard tidak bisa diperbaiki',
    });
    expect(fromTransit.ok).toBe(true);
    expect(fromTransit.data).toMatchObject({
      status: 'broken',
      custody: 'service',
      locationId: 'loc-jkt',
      openCaseId: null,
    });
    expect(fromTransit.data.cases[0]).toMatchObject({ closedOn: TODAY, outcome: 'broken' });
    const events = await eventsOf();
    expect(events.map((event) => event.type)).toEqual(['recorded', 'receive', 'declare_broken']);
    expect(events[2]).toMatchObject({
      actor_team: 'service',
      case_id: 'case-1',
      message: 'Motherboard tidak bisa diperbaiki',
    });
    expect(JSON.parse(events[2]?.data_json ?? '{}')).toMatchObject({
      caseNumber: 'LP/A/2611-0001',
      outcome: 'broken',
    });

    await env.DB.prepare('DELETE FROM serial_events').run();
    await env.DB.prepare('DELETE FROM serial_cases').run();
    await env.DB.prepare('DELETE FROM serials').run();
    await seedAt('diagnosis', 'service');
    const fromDiagnosis = await act('declare_broken', { message: 'Rusak total' });
    expect(fromDiagnosis.data.status).toBe('broken');
  });

  test('tanpa catatan atau hanya spasi: VALIDATION pada message, tanpa efek', async () => {
    await seedAt('service_repair', 'service');
    for (const message of ['', '  \n']) {
      const out = await act('declare_broken', { message });
      expect(out.error?.code).toBe('VALIDATION');
      expect(Object.keys(out.error?.fields ?? {})).toContain('message');
    }
    expect((await serialRow())?.status).toBe('service_repair');
    expect(await eventsOf()).toHaveLength(1);
  });

  test('memanggil pendengar serial.declared_broken tepat sekali dengan id yang benar (event aksi, bukan receive)', async () => {
    await seedAt('at_service', 'transit');
    const seen: unknown[] = [];
    resetEventListenersForTest();
    registerSerialStockListeners();
    onEvent('serial.declared_broken', (_env, payload) => {
      seen.push(payload);
      return [];
    });
    try {
      const result = await act('declare_broken', { message: 'Rusak' });
      expect(result.ok).toBe(true);
    } finally {
      resetEventListenersForTest();
      registerSerialStockListeners();
    }
    const declared = (await eventsOf()).at(-1);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ serialId: 'sn1', caseId: 'case-1' });
    const eventId = await env.DB.prepare(
      "SELECT id FROM serial_events WHERE serial_id = 'sn1' AND type = 'declare_broken'",
    ).first<{ id: string }>();
    expect((seen[0] as { eventId: string }).eventId).toBe(eventId?.id as string);
    expect(declared?.type).toBe('declare_broken');
  });

  test('yang batal (stale) tidak memicu pendengar', async () => {
    await seedAt('service_repair', 'service');
    let calls = 0;
    resetEventListenersForTest();
    registerSerialStockListeners();
    onEvent('serial.declared_broken', () => {
      calls++;
      return [];
    });
    try {
      const stale = await act(
        'declare_broken',
        { message: 'x' },
        { at: '2026-01-01T00:00:00.000Z' },
      );
      expect(stale.error?.code).toBe('CONFLICT');
    } finally {
      resetEventListenersForTest();
      registerSerialStockListeners();
    }
    expect(calls).toBe(0);
  });

  test('galat pada pernyataan terakhir (pendengar) membatalkan declare_broken seluruhnya, termasuk Terima otomatis', async () => {
    await seedAt('at_service', 'transit');
    resetEventListenersForTest();
    registerSerialStockListeners();
    onEvent('serial.declared_broken', (e) => [
      e.DB.prepare('INSERT INTO tabel_tidak_ada (x) VALUES (1)'),
    ]);
    const realError = console.error;
    console.error = () => undefined;
    try {
      expect((await act('declare_broken', { message: 'x' })).ok).toBe(false);
    } finally {
      console.error = realError;
      resetEventListenersForTest();
      registerSerialStockListeners();
    }
    expect(await serialRow()).toMatchObject({
      status: 'at_service',
      custody: 'transit',
      open_case_id: 'case-1',
    });
    const c = await env.DB.prepare(
      "SELECT closed_on, outcome FROM serial_cases WHERE id = 'case-1'",
    ).first<{ closed_on: string; outcome: string }>();
    expect(c).toEqual({ closed_on: '', outcome: '' });
    expect((await eventsOf()).length).toBe(1);
  });
});

describe('alur utuh', () => {
  test('lapor, kirim, terima, diagnosis, diperbaiki, selesai, terima QC, cek ulang lolos', async () => {
    await seedSerial(env, {
      id: 'sn1',
      serial: 'AB12',
      stickers: [{ stickerId: 's1', qty: 1 }],
    });
    await env.DB.prepare('INSERT INTO settings (`key`, value) VALUES (?, ?)')
      .bind('SERIAL_SERVICE_LOCATIONS', JSON.stringify({ locationIds: ['loc-jkt'], updatedAt: AT }))
      .run();
    const QC = SERIAL_USERS.hybrid;
    const reported = await act('report_failure', { message: 'Mati total' }, { email: QC });
    const sent = await act(
      'send',
      { message: 'Kirim' },
      { email: QC, at: reported.data.updatedAt },
    );
    expect(sent.ok).toBe(true);
    const received = await act('receive', {}, { at: sent.data.updatedAt });
    const diagnosis = await act(
      'service_diagnosis',
      { stage: 'diagnosis' },
      { at: received.data.updatedAt },
    );
    const repairing = await act(
      'service_diagnosis',
      { stage: 'repairing' },
      { at: diagnosis.data.updatedAt },
    );
    const done = await act(
      'service_diagnosis',
      { stage: 'done' },
      { at: repairing.data.updatedAt },
    );
    expect(done.data).toMatchObject({
      status: 'recheck',
      custody: 'transit',
      transitToLocationId: 'loc-sby',
    });
    const atQc = await act('receive', {}, { at: done.data.updatedAt, email: QC });
    expect(atQc.data).toMatchObject({ status: 'recheck', custody: 'qc', locationId: 'loc-sby' });
    const pass = await act('recheck_pass', {}, { at: atQc.data.updatedAt, email: QC });
    expect(pass.data).toMatchObject({ status: 'good', openCaseId: null });
    expect((await eventsOf()).map((e) => [e.type, e.actor_team])).toEqual([
      ['recorded', 'qc'],
      ['report_failure', 'qc'],
      ['send', 'qc'],
      ['receive', 'service'],
      ['service_diagnosis', 'service'],
      ['service_diagnosis', 'service'],
      ['service_diagnosis', 'service'],
      ['receive', 'qc'],
      ['recheck_pass', 'qc'],
    ]);
    expect(pass.data.cases[0]).toMatchObject({ outcome: 'good', closedOn: TODAY });
  });
});

describe('note dan batas serialservice (baris 13, 14)', () => {
  test('note pada service_repair: tim service oleh servis, tim qc oleh pencatat', async () => {
    await seedAt('service_repair', 'service');
    const bySvc = await act('note', { message: 'Menunggu suku cadang' });
    expect(bySvc.ok).toBe(true);
    const byQc = await act(
      'note',
      { message: 'QC menunggu' },
      { email: SERIAL_USERS.writer, at: bySvc.data.updatedAt },
    );
    expect(byQc.ok).toBe(true);
    expect((await eventsOf()).slice(1).map((e) => e.actor_team)).toEqual(['service', 'qc']);
  });

  test('pemegang kedua modul: note pada at_service = tim service', async () => {
    await seedAt('at_service', 'service');
    const out = await act('note', { message: 'x' }, { email: SERIAL_USERS.hybrid });
    expect(out.ok).toBe(true);
    expect((await eventsOf())[1]?.actor_team).toBe('service');
  });

  test('serialservice pada good, reported, recheck: aksi yang ada tetapi bukan miliknya FORBIDDEN, yang tak ada CONFLICT', async () => {
    for (const [status, custody] of [
      ['good', 'qc'],
      ['reported', 'qc'],
      ['recheck', 'qc'],
    ] as const) {
      await env.DB.prepare('DELETE FROM serial_events').run();
      await env.DB.prepare('DELETE FROM serial_cases').run();
      await env.DB.prepare('DELETE FROM serials').run();
      await seedAt(status, custody, {
        locationId: 'loc-sby',
        ...(status === 'good' ? { openCase: undefined } : {}),
      });
      expect((await act('note', { message: 'x' })).error?.code, status).toBe('FORBIDDEN');
      expect((await act('declare_broken', { message: 'x' })).error?.code, status).toBe('CONFLICT');
      expect((await act('service_diagnosis', { stage: 'done' })).error?.code, status).toBe(
        'CONFLICT',
      );
      expect((await serialRow())?.status).toBe(status);
    }
  });

  test('serialservice BU B pada serial BU A: NOT_FOUND', async () => {
    await seedAt('at_service', 'service');
    expect((await act('note', { message: 'x' }, { email: SERIAL_USERS.svcB })).error?.code).toBe(
      'NOT_FOUND',
    );
  });

  test('serialservice tidak dapat mencatat, mengubah, atau memilih stiker/lokasi: FORBIDDEN', async () => {
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
    // Tim servis tidak lagi memilih lokasi (keputusan rancangan §3 butir h).
    expect((await call(SVC, 'serials.locationOptions', null)).error?.code).toBe('FORBIDDEN');
  });

  test('serialservice view saja tidak dapat beraksi: FORBIDDEN di gerbang rute', async () => {
    await seedAt('at_service', 'service');
    expect((await act('note', { message: 'x' }, { email: SERIAL_USERS.service })).error?.code).toBe(
      'FORBIDDEN',
    );
  });
});
