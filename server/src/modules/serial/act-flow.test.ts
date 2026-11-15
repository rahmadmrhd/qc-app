// `serials.act` alur laporan rusak (2026-11-14): Lapor rusak, Kirim ke servis, Terima (QC), cek ulang dengan stiker
// tercentang, catatan, dan keadaan akhir oleh tim QC (baris 1, 2, 8-14 tabel transisi).
import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { onEvent, resetEventListenersForTest } from '@server/core/events';
import { registerSerialStockListeners } from '@server/modules/sticker/serial-listener';
import { seedLocation } from '@server-test/access-fixtures';
import { restCall } from '@server-test/rest-call';
import { jsonOf, restClient } from '@server-test/rest-client';
import { SERIAL_USERS, seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { seedSticker } from '@server-test/sticker-fixtures';
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
  options: { email?: string; id?: string; at?: string; occurredOn?: string } = {},
) =>
  call(options.email ?? W, 'serials.act', {
    id: options.id ?? 'sn1',
    expectedUpdatedAt: options.at ?? AT,
    action,
    occurredOn: options.occurredOn ?? TODAY,
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
/** Serial Dilaporkan (laporan terbuka) di QC Surabaya. */
const seedReported = (over: Record<string, unknown> = {}) =>
  seedOne({
    status: 'reported',
    openCase: { id: 'case-1', number: 'LP-20261110-001' },
    ...over,
  });
/** Serial Menunggu cek ulang yang sedang dikirim balik dari servis ke QC (asal Surabaya). */
const seedRecheckTransit = (over: Record<string, unknown> = {}) =>
  seedSerial(env, {
    id: 'sn1',
    serial: 'AB12',
    status: 'recheck',
    custody: 'transit',
    locationId: 'loc-jkt',
    stickers: [{ stickerId: 's1', qty: 1 }],
    transitFromLocationId: 'loc-jkt',
    transitToLocationId: 'loc-sby',
    transitOn: '2026-11-10',
    openCase: { id: 'case-1', number: 'LP-20261110-001', originLocationId: 'loc-sby' },
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
      'SELECT id, number, opened_on, closed_on, outcome, origin_location_id FROM serial_cases WHERE serial_id = ? ORDER BY number',
    )
      .bind(serialId)
      .all<{
        id: string;
        number: string;
        opened_on: string;
        closed_on: string;
        outcome: string;
        origin_location_id: string;
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

const stickerQty = async (stickerId: string, serialId = 'sn1') =>
  Number(
    (
      await env.DB.prepare('SELECT qty FROM serial_stickers WHERE serial_id = ? AND sticker_id = ?')
        .bind(serialId, stickerId)
        .first<{ qty: number | string }>()
    )?.qty ?? 0,
  );

/** Menyetel konfigurasi lokasi servis langsung (kunci `SERIAL_SERVICE_LOCATIONS`). */
async function setServiceLocations(locationIds: string[]): Promise<void> {
  await env.DB.prepare('INSERT INTO settings (`key`, value) VALUES (?, ?)')
    .bind('SERIAL_SERVICE_LOCATIONS', JSON.stringify({ locationIds, updatedAt: AT }))
    .run();
}

describe('report_failure (baris 1)', () => {
  test('membuka laporan LP-<hari ini>-001, status reported, kejadian ber-caseId membawa catatan', async () => {
    await seedOne();
    const result = await act('report_failure', { message: 'Layar mati saat uji' });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      status: 'reported',
      custody: 'qc',
      openCaseNumber: CASE_1,
    });
    expect(result.data.openCase).toMatchObject({
      number: CASE_1,
      openedOn: TODAY,
      closedOn: null,
      outcome: null,
    });
    expect(result.data.openCase.damage).toBeUndefined();
    const events = await eventsOf();
    expect(events).toHaveLength(2);
    const last = events[1];
    expect(last).toMatchObject({
      type: 'report_failure',
      message: 'Layar mati saat uji',
      actor_team: 'qc',
    });
    expect(last?.case_id).toBe(result.data.openCaseId);
    expect(JSON.parse(last?.changes_json ?? '[]')).toEqual([
      { field: 'status', from: 'Lolos', to: 'Dilaporkan' },
    ]);
    expect(JSON.parse(last?.data_json ?? '{}')).toEqual({ caseNumber: CASE_1 });
    expect((await casesOf())[0]).toMatchObject({ number: CASE_1, closed_on: '', outcome: '' });
  });

  test('tanpa catatan atau hanya spasi: VALIDATION pada message, tanpa efek', async () => {
    await seedOne();
    for (const message of ['', '   \n ']) {
      const out = await act('report_failure', { message });
      expect(out.error?.code).toBe('VALIDATION');
      expect(Object.keys(out.error?.fields ?? {})).toContain('message');
    }
    expect(await casesOf()).toHaveLength(0);
    expect(await eventsOf()).toHaveLength(1);
  });

  test('pada serial yang sudah dilaporkan atau rusak: CONFLICT', async () => {
    await seedReported();
    expect((await act('report_failure', { message: 'lagi' })).error?.code).toBe('CONFLICT');
    await env.DB.prepare("UPDATE serials SET status = 'broken', open_case_id = ''").run();
    expect((await act('report_failure', { message: 'lagi' })).error?.code).toBe('CONFLICT');
  });
});

describe('send: Kirim ke servis (baris 2)', () => {
  test('satu lokasi servis dikonfigurasi: dipakai otomatis; lokasi QC asal tersimpan di laporan', async () => {
    await setServiceLocations(['loc-jkt']);
    await seedReported();
    const out = await act('send', { message: 'Bawa ke Jakarta' });
    expect(out.ok).toBe(true);
    expect(out.data).toMatchObject({
      status: 'at_service',
      custody: 'transit',
      locationId: 'loc-sby',
      transitToLocationId: 'loc-jkt',
      transitOn: TODAY,
    });
    expect(await serialRow()).toMatchObject({
      transit_from_location_id: 'loc-sby',
      transit_to_location_id: 'loc-jkt',
    });
    expect((await casesOf())[0]?.origin_location_id).toBe('loc-sby');
    const sent = (await eventsOf()).at(-1);
    expect(sent).toMatchObject({ type: 'send', message: 'Bawa ke Jakarta', case_id: 'case-1' });
    expect(JSON.parse(sent?.data_json ?? '{}')).toMatchObject({
      leg: 'to_service',
      fromLocationName: 'Surabaya',
      toLocationName: 'Jakarta',
    });
  });

  test('catatan pengiriman opsional (ekspedisi, resi, pengantar): dipangkas dan tersimpan di data kejadian', async () => {
    await setServiceLocations(['loc-jkt']);
    await seedReported();
    const out = await act('send', { shipmentNote: '  JNE resi 123456, diantar Budi  ' });
    expect(out.ok).toBe(true);
    const sent = (await eventsOf()).at(-1);
    expect(JSON.parse(sent?.data_json ?? '{}')).toMatchObject({
      leg: 'to_service',
      shipmentNote: 'JNE resi 123456, diantar Budi',
    });
  });

  test('catatan pengiriman kosong atau spasi saja tidak disimpan', async () => {
    await setServiceLocations(['loc-jkt']);
    await seedReported();
    const out = await act('send', { shipmentNote: '   ' });
    expect(out.ok).toBe(true);
    expect(JSON.parse((await eventsOf()).at(-1)?.data_json ?? '{}')).not.toHaveProperty(
      'shipmentNote',
    );
  });

  test('catatan pengiriman tidak sah (lewat batas, baris baru, pengatur arah) atau pada aksi selain kirim = VALIDATION', async () => {
    await setServiceLocations(['loc-jkt']);
    await seedReported();
    for (const shipmentNote of ['x'.repeat(201), 'resi\n123', 'resi‮123']) {
      const bad = await act('send', { shipmentNote });
      expect(bad.error?.code).toBe('VALIDATION');
      expect(Object.keys(bad.error?.fields ?? {})).toContain('shipmentNote');
    }
    const onNote = await act('note', { message: 'catatan', shipmentNote: 'resi 1' });
    expect(onNote.error?.code).toBe('VALIDATION');
    expect(Object.keys(onNote.error?.fields ?? {})).toContain('shipmentNote');
    expect(await serialRow()).toMatchObject({ status: 'reported', custody: 'qc' });
  });

  test('kirim dari QC Surabaya ke servis Surabaya sah (lokasi sama)', async () => {
    await setServiceLocations(['loc-sby']);
    await seedReported();
    const out = await act('send');
    expect(out.ok).toBe(true);
    expect(out.data).toMatchObject({ transitToLocationId: 'loc-sby', locationId: 'loc-sby' });
  });

  test('banyak lokasi servis: tanpa pilihan ditolak; di luar daftar atau nonaktif ditolak; pilihan sah diterima', async () => {
    await setServiceLocations(['loc-sby', 'loc-jkt']);
    await seedReported();
    const none = await act('send');
    expect(none.error?.code).toBe('VALIDATION');
    expect(Object.keys(none.error?.fields ?? {})).toContain('toLocationId');
    const outside = await act('send', { toLocationId: 'loc-off' });
    expect(outside.error?.code).toBe('VALIDATION');
    const unknown = await act('send', { toLocationId: 'tidak-ada' });
    expect(unknown.error?.code).toBe('VALIDATION');
    expect(await serialRow()).toMatchObject({ status: 'reported', custody: 'qc' });
    const ok = await act('send', { toLocationId: 'loc-jkt' });
    expect(ok.ok).toBe(true);
    expect(ok.data.transitToLocationId).toBe('loc-jkt');
  });

  test('tanpa konfigurasi (kosong) = semua lokasi aktif: pilihan wajib; satu lokasi dikirim sama atau kosong', async () => {
    await seedReported();
    expect((await act('send')).error?.code).toBe('VALIDATION');
    expect((await act('send', { toLocationId: 'loc-off' })).error?.code).toBe('VALIDATION');
    expect((await act('send', { toLocationId: 'loc-jkt' })).ok).toBe(true);
  });

  test('satu lokasi servis: toLocationId lain ditolak', async () => {
    await setServiceLocations(['loc-jkt']);
    await seedReported();
    expect((await act('send', { toLocationId: 'loc-sby' })).error?.code).toBe('VALIDATION');
    expect((await act('send', { toLocationId: 'loc-jkt' })).ok).toBe(true);
  });

  test('stiker, hasil, atau tahap pada send: VALIDATION; send dari good atau dua kali: CONFLICT', async () => {
    await setServiceLocations(['loc-jkt']);
    await seedReported();
    expect((await act('send', { stickerIds: ['s1'] })).error?.code).toBe('VALIDATION');
    expect((await act('send', { stage: 'done' })).error?.code).toBe('VALIDATION');
    const first = await act('send');
    expect(first.ok).toBe(true);
    const again = await act('send', {}, { at: first.data.updatedAt });
    expect(again.error?.code).toBe('CONFLICT');
  });

  test('send dari serial Lolos: CONFLICT (kirim antar lokasi dihapus)', async () => {
    await seedOne();
    expect((await act('send', { toLocationId: 'loc-jkt' })).error?.code).toBe('CONFLICT');
  });
});

describe('receive di QC (baris 8)', () => {
  test('recheck/transit: custody qc, lokasi = lokasi QC asal, transit dikosongkan, hari di jalan', async () => {
    await seedRecheckTransit();
    const out = await act('receive', {}, { occurredOn: '2026-11-12' });
    expect(out.ok).toBe(true);
    expect(out.data).toMatchObject({
      status: 'recheck',
      custody: 'qc',
      locationId: 'loc-sby',
      transitToLocationId: null,
    });
    expect(await serialRow()).toMatchObject({
      transit_from_location_id: '',
      transit_to_location_id: '',
      transit_on: '',
    });
    const event = (await eventsOf()).at(-1);
    expect(event).toMatchObject({ type: 'receive', actor_team: 'qc' });
    expect(JSON.parse(event?.data_json ?? '{}')).toMatchObject({
      leg: 'at_qc',
      daysInTransit: 2,
    });
    expect(JSON.parse(event?.changes_json ?? '[]')).toContainEqual({
      field: 'location',
      from: 'Jakarta',
      to: 'Surabaya',
    });
  });

  test('tanggal terima sebelum tanggal kirim: VALIDATION pada occurredOn, tanpa efek; tanggal sama lolos', async () => {
    await seedRecheckTransit();
    const early = await act('receive', {}, { occurredOn: '2026-11-09' });
    expect(early.error?.code).toBe('VALIDATION');
    expect(Object.keys(early.error?.fields ?? {})).toContain('occurredOn');
    expect((await serialRow())?.custody).toBe('transit');
    expect((await act('receive', {}, { occurredOn: '2026-11-10' })).ok).toBe(true);
  });

  test('lokasi QC asal nonaktif: toLocationId wajib (lokasi aktif lain); nonaktif atau tak ada ditolak', async () => {
    await seedRecheckTransit({ transitToLocationId: 'loc-off' });
    const missing = await act('receive');
    expect(missing.error?.code).toBe('VALIDATION');
    expect(Object.keys(missing.error?.fields ?? {})).toContain('toLocationId');
    expect((await act('receive', { toLocationId: 'loc-off' })).error?.code).toBe('VALIDATION');
    expect((await act('receive', { toLocationId: 'tidak-ada' })).error?.code).toBe('VALIDATION');
    const ok = await act('receive', { toLocationId: 'loc-sby' });
    expect(ok.ok).toBe(true);
    expect(ok.data).toMatchObject({ custody: 'qc', locationId: 'loc-sby' });
  });

  test('lokasi QC asal masih aktif: toLocationId yang berbeda ditolak, yang sama diterima', async () => {
    await seedRecheckTransit();
    expect((await act('receive', { toLocationId: 'loc-jkt' })).error?.code).toBe('VALIDATION');
    expect((await act('receive', { toLocationId: 'loc-sby' })).ok).toBe(true);
  });

  test('receive tanpa pengiriman berjalan atau pada reported: CONFLICT', async () => {
    await seedReported();
    expect((await act('receive')).error?.code).toBe('CONFLICT');
  });
});

describe('cek ulang dengan stiker tercentang (baris 9-12)', () => {
  test('recheck lolos: tiap centang menambah satu dan memotong satu stok di lokasi unit', async () => {
    await seedOne();
    const out = await act('recheck', { result: 'pass', stickerIds: ['s1'] });
    expect(out.ok).toBe(true);
    expect(await stickerQty('s1')).toBe(2);
    expect(await stickerQty('s2')).toBe(1);
    expect(await stock('s1', 'loc-sby')).toBe(9);
    expect(await stock('s2', 'loc-sby')).toBe(10);
    expect(await stock('s1', 'loc-jkt')).toBe(10);
    const event = (await eventsOf()).at(-1);
    expect(event?.type).toBe('recheck');
    expect(JSON.parse(event?.changes_json ?? '[]')).toEqual([
      { field: 'stickers', from: 'Segel A ×1', to: 'Segel A ×2' },
    ]);
    expect(JSON.parse(event?.data_json ?? '{}')).toMatchObject({
      result: 'pass',
      stickers: [{ stickerId: 's1', qtyFrom: 1, qtyTo: 2 }],
    });
    const entry = await env.DB.prepare(
      "SELECT serial_event_id FROM sticker_stock_entries WHERE serial_id = 'sn1'",
    ).first<{ serial_event_id: string }>();
    expect(entry?.serial_event_id).toBe(event?.id);
  });

  test('tanpa centang: tidak ada perubahan stiker dan stok', async () => {
    await seedOne();
    expect((await act('recheck', { result: 'pass' })).ok).toBe(true);
    expect(await stickerQty('s1')).toBe(1);
    expect(await stock('s1', 'loc-sby')).toBe(10);
  });

  test('stiker yang belum pernah ditempel tetapi berlaku bisa dicentang: qty awal 1', async () => {
    await seedOne({ stickers: [{ stickerId: 's1', qty: 1 }] });
    expect((await act('recheck', { stickerIds: ['s2'] })).ok).toBe(true);
    expect(await stickerQty('s2')).toBe(1);
    expect(await stock('s2', 'loc-sby')).toBe(9);
  });

  test('stiker yang tidak berlaku bagi item ditolak (VALIDATION stickerIds), tanpa efek', async () => {
    await seedSticker(env, { id: 's9', typeId: 't1', name: 'Segel Z' });
    await seedOne();
    const out = await act('recheck', { stickerIds: ['s1', 's9'] });
    expect(out.error?.code).toBe('VALIDATION');
    expect(Object.keys(out.error?.fields ?? {})).toContain('stickerIds');
    expect(await stickerQty('s1')).toBe(1);
    expect(await stock('s1', 'loc-sby')).toBe(10);
  });

  test('stiker nonaktif ditolak, deprecated boleh', async () => {
    await seedOne();
    await env.DB.prepare("UPDATE stickers SET status = 'inactive' WHERE id = 's1'").run();
    const rejected = await act('recheck', { stickerIds: ['s1'] });
    expect(rejected.error?.code).toBe('VALIDATION');
    expect(Object.keys(rejected.error?.fields ?? {})).toContain('stickerIds');
    await env.DB.prepare("UPDATE stickers SET status = 'deprecated' WHERE id = 's1'").run();
    expect((await act('recheck', { stickerIds: ['s1'] })).ok).toBe(true);
    expect(await stickerQty('s1')).toBe(2);
    expect(await stock('s1', 'loc-sby')).toBe(9);
  });

  test('daftar kembar, lebih dari 20, atau bukan teks: VALIDATION; stiker pada aksi non-cek-ulang: VALIDATION', async () => {
    await seedOne();
    expect((await act('recheck', { stickerIds: ['s1', 's1'] })).error?.code).toBe('VALIDATION');
    const many = Array.from({ length: 21 }, (_, i) => `x${i}`);
    expect((await act('recheck', { stickerIds: many })).error?.code).toBe('VALIDATION');
    expect((await act('recheck', { stickerIds: [1] })).error?.code).toBe('VALIDATION');
    expect((await act('note', { message: 'x', stickerIds: ['s1'] })).error?.code).toBe(
      'VALIDATION',
    );
    expect((await act('recheck', { stickers: [{ stickerId: 's1', qty: 3 }] })).ok).toBe(true);
    expect(await stickerQty('s1')).toBe(1);
  });

  test('recheck lolos dari reported menutup laporan good: closed_on = occurredOn, open_case_id kosong', async () => {
    await seedReported();
    const out = await act('recheck_pass', { message: 'Sudah normal', stickerIds: ['s2'] });
    expect(out.ok).toBe(true);
    expect(out.data).toMatchObject({ status: 'good', custody: 'qc', openCaseId: null });
    expect((await casesOf())[0]).toMatchObject({ closed_on: TODAY, outcome: 'good' });
    const event = (await eventsOf()).at(-1);
    expect(event).toMatchObject({ type: 'recheck_pass', case_id: 'case-1' });
    expect(JSON.parse(event?.data_json ?? '{}')).toMatchObject({
      caseNumber: 'LP-20261110-001',
      outcome: 'good',
    });
    expect(await stock('s2', 'loc-sby')).toBe(9);
  });

  test('recheck_fail dari reported atau recheck: status reported, laporan tetap terbuka; catatan wajib', async () => {
    await seedReported();
    const noNote = await act('recheck_fail', {});
    expect(noNote.error?.code).toBe('VALIDATION');
    expect(Object.keys(noNote.error?.fields ?? {})).toContain('message');
    const out = await act('recheck_fail', { message: 'Masih mati', stickerIds: ['s1'] });
    expect(out.ok).toBe(true);
    expect(out.data).toMatchObject({ status: 'reported', openCaseId: 'case-1' });
    expect((await casesOf())[0]).toMatchObject({ closed_on: '', outcome: '' });
    expect(await stock('s1', 'loc-sby')).toBe(9);
    // Dari recheck (custody qc) juga boleh.
    await env.DB.prepare("UPDATE serials SET status = 'recheck'").run();
    const row = await env.DB.prepare('SELECT updated_at FROM serials WHERE id = ?')
      .bind('sn1')
      .first<{ updated_at: string }>();
    const again = await act(
      'recheck_fail',
      { message: 'Masih mati lagi' },
      { at: row?.updated_at },
    );
    expect(again.ok).toBe(true);
    expect(again.data.status).toBe('reported');
  });

  test('recheck gagal pada serial Lolos: dua kejadian (recheck lalu report_failure), laporan baru, catatan di report_failure', async () => {
    await seedOne();
    const out = await act('recheck', {
      result: 'fail',
      message: 'Port 2 mati',
      stickerIds: ['s1'],
    });
    expect(out.ok).toBe(true);
    expect(out.data).toMatchObject({ status: 'reported', custody: 'qc', openCaseNumber: CASE_1 });
    const events = await eventsOf();
    expect(events.map((event) => event.type)).toEqual(['recorded', 'recheck', 'report_failure']);
    const [, recheck, report] = events;
    expect(recheck?.case_id).toBe(out.data.openCaseId);
    expect(report?.case_id).toBe(out.data.openCaseId);
    expect(recheck?.message).toBe('');
    expect(report?.message).toBe('Port 2 mati');
    expect(JSON.parse(recheck?.data_json ?? '{}')).toMatchObject({ result: 'fail' });
    expect(JSON.parse(report?.changes_json ?? '[]')).toEqual([
      { field: 'status', from: 'Lolos', to: 'Dilaporkan' },
    ]);
    expect(await stock('s1', 'loc-sby')).toBe(9);
    const entry = await env.DB.prepare(
      "SELECT serial_event_id FROM sticker_stock_entries WHERE serial_id = 'sn1'",
    ).first<{ serial_event_id: string }>();
    expect(entry?.serial_event_id).toBe(recheck?.id);
  });

  test('recheck gagal tanpa catatan: VALIDATION; catatan pada hasil lolos opsional', async () => {
    await seedOne();
    const out = await act('recheck', { result: 'fail' });
    expect(out.error?.code).toBe('VALIDATION');
    expect(Object.keys(out.error?.fields ?? {})).toContain('message');
    expect((await act('recheck', { result: 'pass' })).ok).toBe(true);
  });

  test('cek ulang langsung dari recheck/transit: Terima otomatis dulu, stok dipotong di lokasi tujuan', async () => {
    await seedRecheckTransit();
    const out = await act('recheck_pass', { stickerIds: ['s1'] }, { occurredOn: '2026-11-12' });
    expect(out.ok).toBe(true);
    expect(out.data).toMatchObject({ status: 'good', custody: 'qc', locationId: 'loc-sby' });
    const events = await eventsOf();
    expect(events.map((event) => event.type)).toEqual(['recorded', 'receive', 'recheck_pass']);
    expect(JSON.parse(events[1]?.data_json ?? '{}')).toMatchObject({ leg: 'at_qc', auto: true });
    expect(await stock('s1', 'loc-sby')).toBe(9);
    expect(await stock('s1', 'loc-jkt')).toBe(10);
    expect(await serialRow()).toMatchObject({ transit_to_location_id: '', custody: 'qc' });
  });

  test('cek ulang dari transit dengan tanggal sebelum tanggal kirim: VALIDATION occurredOn, tanpa efek', async () => {
    await seedRecheckTransit();
    const out = await act('recheck_pass', { stickerIds: ['s1'] }, { occurredOn: '2026-11-09' });
    expect(out.error?.code).toBe('VALIDATION');
    expect(Object.keys(out.error?.fields ?? {})).toContain('occurredOn');
    expect(await eventsOf()).toHaveLength(1);
    expect(await stock('s1', 'loc-sby')).toBe(10);
  });

  test('cek ulang tidak lagi menerima locationId atau jumlah stiker lama', async () => {
    await seedOne();
    const out = await act('recheck', { locationId: 'loc-jkt' });
    expect(out.ok).toBe(true);
    expect((await serialRow())?.location_id).toBe('loc-sby');
  });
});

describe('note dan keadaan akhir', () => {
  test('note pada broken boleh dan tidak membawa caseId; aksi lain pada broken CONFLICT', async () => {
    await seedOne({ status: 'broken', custody: 'service' });
    const note = await act('note', { message: 'Klaim vendor diajukan' });
    expect(note.ok).toBe(true);
    const last = (await eventsOf()).at(-1);
    expect(last).toMatchObject({ type: 'note', case_id: '' });
    for (const [action, extra] of [
      ['report_failure', { message: 'x' }],
      ['recheck', {}],
      ['recheck_pass', {}],
      ['send', { toLocationId: 'loc-jkt' }],
    ] as const) {
      expect((await act(action, extra, { at: note.data.updatedAt })).error?.code, action).toBe(
        'CONFLICT',
      );
    }
  });

  test('note pada reported membawa case_id laporan terbuka', async () => {
    await seedReported();
    expect((await act('note', { message: 'Menunggu suku cadang' })).ok).toBe(true);
    expect((await eventsOf()).at(-1)?.case_id).toBe('case-1');
  });

  test('note tanpa isi: VALIDATION; tanggal masa depan: VALIDATION; aksi tak sah menurut status: CONFLICT', async () => {
    await seedOne();
    expect((await act('note', { message: '  ' })).error?.code).toBe('VALIDATION');
    expect((await act('note', { message: 'x' }, { occurredOn: '2026-11-13' })).error?.code).toBe(
      'VALIDATION',
    );
    expect((await act('recheck_pass')).error?.code).toBe('CONFLICT');
  });

  test('expectedUpdatedAt usang: CONFLICT (stale) tanpa efek', async () => {
    await seedOne();
    const out = await act('note', { message: 'x' }, { at: '2026-01-01T00:00:00.000Z' });
    expect(out.error?.code).toBe('CONFLICT');
    expect(out.error?.message).toContain('Serial Number sudah diubah orang lain');
    expect(await eventsOf()).toHaveLength(1);
  });
});

describe('izin per baris', () => {
  test('serial: edit tidak menjalankan aksi servis: FORBIDDEN', async () => {
    await seedSerial(env, {
      id: 'sn1',
      serial: 'AB12',
      status: 'at_service',
      custody: 'service',
      openCase: { id: 'case-1', number: 'LP-20261110-001' },
    });
    for (const [action, extra] of [
      ['service_diagnosis', { stage: 'done' }],
      ['declare_broken', { message: 'rusak' }],
    ] as const) {
      expect((await act(action, extra)).error?.code, action).toBe('FORBIDDEN');
    }
    expect((await serialRow())?.status).toBe('at_service');
  });

  test('serialservice: edit tidak menjalankan aksi QC maupun note pada good/reported: FORBIDDEN', async () => {
    await seedReported();
    const svc = SERIAL_USERS.svcEdit;
    expect((await act('recheck_pass', {}, { email: svc })).error?.code).toBe('FORBIDDEN');
    expect((await act('send', { toLocationId: 'loc-jkt' }, { email: svc })).error?.code).toBe(
      'FORBIDDEN',
    );
    expect((await act('note', { message: 'x' }, { email: svc })).error?.code).toBe('FORBIDDEN');
  });

  test('serial: edit di BU A + serial: view di BU B pada serial BU B: FORBIDDEN; tanpa baca BU B: NOT_FOUND', async () => {
    await seedOne({ buId: 'bu-b', itemId: 'i-b' });
    expect((await act('note', { message: 'x' }, { email: SERIAL_USERS.mixed })).error?.code).toBe(
      'FORBIDDEN',
    );
    expect((await act('note', { message: 'x' })).error?.code).toBe('NOT_FOUND');
  });

  test('pemegang kedua modul memenuhi baris QC', async () => {
    await seedOne();
    const out = await act('report_failure', { message: 'x' }, { email: SERIAL_USERS.hybrid });
    expect(out.ok).toBe(true);
    expect((await eventsOf()).at(-1)?.actor_team).toBe('qc');
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

describe('konkurensi laporan (Promise.all)', () => {
  test('report_failure pada dua serial BERBEDA di hari yang sama: keduanya sukses, nomor berbeda', async () => {
    await seedSerial(env, { id: 'sn1', serial: 'AB12' });
    await seedSerial(env, { id: 'sn2', serial: 'AB13' });
    const [a, b] = await Promise.all([
      act('report_failure', { message: 'A' }, { id: 'sn1' }),
      act('report_failure', { message: 'B' }, { id: 'sn2' }),
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
      ids.map((id) => act('report_failure', { message: id }, { id })),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(new Set(results.map((r) => r.data.openCaseNumber)).size).toBe(4);
  });

  test('Lapor rusak dua kali serentak pada serial SAMA: tepat satu laporan aktif, yang kalah CONFLICT', async () => {
    await seedOne();
    const [a, b] = await Promise.all([
      act('report_failure', { message: 'A' }),
      act('report_failure', { message: 'B' }),
    ]);
    expect([a.ok, b.ok].filter(Boolean).length).toBe(1);
    const failed = a.ok ? b : a;
    expect(failed.error?.code).toBe('CONFLICT');
    expect((await casesOf()).length).toBe(1);
    expect((await serialRow())?.status).toBe('reported');
  });

  test('Lapor rusak serentak dari dua pengguna dengan versi yang sama: satu laporan', async () => {
    await seedOne();
    const [a, b] = await Promise.all([
      act('report_failure', { message: 'A' }, { email: W }),
      act('report_failure', { message: 'B' }, { email: SERIAL_USERS.hybrid }),
    ]);
    expect([a.ok, b.ok].filter(Boolean).length).toBe(1);
    expect((await casesOf()).length).toBe(1);
  });
});

describe('atomisitas', () => {
  test('galat pada pernyataan TERAKHIR batch membatalkan semuanya (status, laporan, kejadian, stok, berkas)', async () => {
    await seedReported();
    resetEventListenersForTest();
    registerSerialStockListeners();
    // Pernyataan terakhir batch gagal (tabel tak ada): seluruh transaksi harus dibatalkan.
    onEvent('serial.stickers_added', (e) => [
      e.DB.prepare('INSERT INTO tabel_tidak_ada (x) VALUES (1)'),
    ]);
    const realError = console.error;
    console.error = () => undefined;
    try {
      const out = await act('recheck_pass', { message: 'Lolos', stickerIds: ['s1'] });
      expect(out.ok).toBe(false);
    } finally {
      console.error = realError;
      resetEventListenersForTest();
      registerSerialStockListeners();
    }
    expect(await serialRow()).toMatchObject({ status: 'reported', open_case_id: 'case-1' });
    expect((await casesOf())[0]).toMatchObject({ closed_on: '', outcome: '' });
    expect((await eventsOf()).length).toBe(1);
    expect(await stock('s1', 'loc-sby')).toBe(10);
    expect(await stickerQty('s1')).toBe(1);
  });

  test('recheck_fail: stiker dinonaktifkan serentak (setelah dibaca, sebelum batch) = CONFLICT usang, tanpa efek; sudah nonaktif sebelumnya = VALIDATION', async () => {
    await seedReported();
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
      out = await act('recheck_fail', { message: 'Masih mati', stickerIds: ['s1'] });
    } finally {
      resetEventListenersForTest();
      registerSerialStockListeners();
    }
    expect(out.ok).toBe(false);
    expect(out.error?.code).toBe('CONFLICT');
    expect(out.error?.message).toContain('Serial Number sudah diubah orang lain');
    expect(await serialRow()).toMatchObject({ status: 'reported', open_case_id: 'case-1' });
    expect((await eventsOf()).length).toBe(1);
    expect(await stock('s1', 'loc-sby')).toBe(10);

    // Sekarang s1 SUDAH nonaktif sebelum permintaan: VALIDATION pada field `stickerIds`.
    const again = await act('recheck_fail', { message: 'Masih mati', stickerIds: ['s1'] });
    expect(again.error?.code).toBe('VALIDATION');
    expect(Object.keys(again.error?.fields ?? {})).toContain('stickerIds');
  });
});
