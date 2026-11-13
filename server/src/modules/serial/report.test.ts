// Lapor Rusak (2026-11-14 §4.3): `serials.lookup` dan `serials.reportNew`.
import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
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
const BOTH = SERIAL_USERS.both;
const TODAY = '2026-11-12';

const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
  await seedSerialWorld(env);
  await env.DB.prepare(
    "INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES ('s1', 'loc-sby', 10, '')",
  ).run();
});

const lookup = (email: string, serial: string) => call(email, 'serials.lookup', { serial });
const report = (over: Record<string, unknown> = {}, email: string = W) =>
  call(email, 'serials.reportNew', {
    serial: 'NEW-1',
    itemId: 'i-a1',
    buId: 'bu-a',
    locationId: 'loc-sby',
    message: 'Layar mati saat dinyalakan',
    occurredOn: TODAY,
    ...over,
  });

const count = async (table: string) =>
  Number(
    (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number | string }>())?.n,
  );

describe('serials.lookup', () => {
  test('menemukan serial di BU yang boleh ditulis, lengkap dengan status dan nomor laporan aktif', async () => {
    await seedSerial(env, { id: 'sn1', serial: 'AB12' });
    await seedSerial(env, {
      id: 'sn2',
      serial: 'CD34',
      status: 'reported',
      openCase: { id: 'c1', number: 'LP-20261110-001' },
    });
    const good = await lookup(W, 'AB12');
    expect(good.data.matches).toHaveLength(1);
    expect(good.data.matches[0]).toMatchObject({
      id: 'sn1',
      buId: 'bu-a',
      buCode: 'A',
      itemLabel: 'Merk Alfa',
      serial: 'AB12',
      status: 'good',
      custody: 'qc',
      locationName: 'Surabaya',
      openCaseId: null,
      openCaseNumber: null,
    });
    const reported = await lookup(W, 'cd34');
    expect(reported.data.matches[0]).toMatchObject({
      status: 'reported',
      openCaseId: 'c1',
      openCaseNumber: 'LP-20261110-001',
    });
  });

  test('serial rusak muncul dengan status broken (UI yang menolak, bukan lookup)', async () => {
    await seedSerial(env, { id: 'sn1', serial: 'AB12', status: 'broken', custody: 'service' });
    const out = await lookup(W, 'AB12');
    expect(out.data.matches[0]).toMatchObject({ status: 'broken', openCaseNumber: null });
  });

  test('tidak ditemukan: daftar kosong; serial di BU yang tak boleh ditulis tidak muncul (generik)', async () => {
    await seedSerial(env, { id: 'sn-b', serial: 'BB-1', buId: 'bu-b', itemId: 'i-b' });
    expect((await lookup(W, 'TIDAK-ADA')).data).toEqual({ matches: [] });
    expect((await lookup(W, 'BB-1')).data).toEqual({ matches: [] });
    expect((await lookup(BOTH, 'BB-1')).data.matches).toHaveLength(1);
  });

  test('pembaca saja (serial view) tidak melihat apa pun di BU yang hanya boleh dibacanya', async () => {
    await seedSerial(env, { id: 'sn1', serial: 'AB12' });
    expect((await lookup(SERIAL_USERS.viewer, 'AB12')).error?.code).toBe('FORBIDDEN');
    expect((await lookup(SERIAL_USERS.svcEdit, 'AB12')).error?.code).toBe('FORBIDDEN');
    expect((await lookup(SERIAL_USERS.nobu, 'AB12')).error?.code).toBe('FORBIDDEN');
    // edit di A + view di B: serial BU B tidak muncul
    await seedSerial(env, { id: 'sn-b', serial: 'BB-1', buId: 'bu-b', itemId: 'i-b' });
    expect((await lookup(SERIAL_USERS.mixed, 'BB-1')).data.matches).toEqual([]);
  });

  test('serial yang sama di dua BU: dua baris, urut kode BU', async () => {
    await seedSerial(env, { id: 'sn-a', serial: 'DUP-1' });
    await seedSerial(env, { id: 'sn-b', serial: 'DUP-1', buId: 'bu-b', itemId: 'i-b' });
    const out = await lookup(BOTH, 'DUP-1');
    expect(out.data.matches.map((m: Json) => [m.buCode, m.id])).toEqual([
      ['A', 'sn-a'],
      ['B', 'sn-b'],
    ]);
  });

  test('alamat MAC dinormalisasi; serial kosong, terlalu panjang, atau berkarakter kontrol: VALIDATION', async () => {
    await seedSerial(env, { id: 'sn1', serial: '4C5E0C1A2B3D' });
    expect((await lookup(W, '4c:5e:0c:1a:2b:3d')).data.matches).toHaveLength(1);
    expect((await lookup(W, '4C5E.0C1A.2B3D')).data.matches).toHaveLength(1);
    for (const bad of ['', '   ', 'A'.repeat(65), 'AB\u0000C']) {
      expect([bad, (await lookup(W, bad)).error?.code]).toEqual([bad, 'VALIDATION']);
    }
  });

  test('lewat REST GET /serials/lookup?serial=', async () => {
    await seedSerial(env, { id: 'sn1', serial: 'AB12' });
    const res = await restClient(env).get('/serials/lookup?serial=ab12', { email: W });
    expect(res.status).toBe(200);
    expect(((await jsonOf(res)).matches as unknown[]).length).toBe(1);
  });
});

describe('serials.reportNew', () => {
  test('membuat serial berstatus reported, satu laporan LP, kejadian recorded lalu report_failure; tanpa stiker dan stok', async () => {
    const out = await report({ serial: 'new-1' });
    expect(out.ok).toBe(true);
    expect(out.data).toMatchObject({
      serial: 'NEW-1',
      buId: 'bu-a',
      itemLabel: 'Merk Alfa',
      status: 'reported',
      custody: 'qc',
      locationId: 'loc-sby',
      testDate: TODAY,
      sample: false,
      openCaseNumber: 'LP-20261112-001',
      stickers: [],
    });
    expect(out.data.openCase).toMatchObject({ openedOn: TODAY, closedOn: null, outcome: null });
    const events = (
      await env.DB.prepare(
        'SELECT seq, case_id, type, message, actor_team, changes_json, data_json FROM serial_events WHERE serial_id = ? ORDER BY seq',
      )
        .bind(out.data.id)
        .all<{
          seq: number;
          case_id: string;
          type: string;
          message: string;
          actor_team: string;
          changes_json: string;
          data_json: string;
        }>()
    ).results;
    expect(events.map((e) => [e.seq, e.type, e.case_id === '' ? '' : 'case'])).toEqual([
      [1, 'recorded', ''],
      [2, 'report_failure', 'case'],
    ]);
    expect(events[1]).toMatchObject({
      message: 'Layar mati saat dinyalakan',
      actor_team: 'qc',
      case_id: out.data.openCaseId,
    });
    expect(JSON.parse(events[1]?.changes_json ?? '[]')).toEqual([
      { field: 'status', from: null, to: 'Dilaporkan' },
    ]);
    expect(JSON.parse(events[1]?.data_json ?? '{}')).toEqual({ caseNumber: 'LP-20261112-001' });
    expect(JSON.parse(events[0]?.data_json ?? '{}')).toMatchObject({
      locationId: 'loc-sby',
      locationName: 'Surabaya',
      stickers: [],
    });
    expect(await count('serial_stickers')).toBe(0);
    expect(await count('sticker_stock_entries')).toBe(0);
    const stock = await env.DB.prepare(
      "SELECT qty FROM sticker_stock WHERE sticker_id = 's1' AND location_id = 'loc-sby'",
    ).first<{ qty: number | string }>();
    expect(Number(stock?.qty)).toBe(10);
  });

  test('alamat MAC disimpan dalam bentuk kanonis', async () => {
    const out = await report({ serial: '4c:5e:0c:1a:2b:3d' });
    expect(out.data.serial).toBe('4C5E0C1A2B3D');
  });

  test('serial sudah ada di BU itu: CONFLICT generik tanpa menyebut BU lain; di BU lain boleh', async () => {
    await seedSerial(env, { id: 'sn1', serial: 'AB12' });
    const dup = await report({ serial: 'ab12' });
    expect(dup.error?.code).toBe('CONFLICT');
    expect(dup.error?.message).toBe(
      'Serial Number sudah terdaftar, cari dulu lewat kolom Serial Number',
    );
    expect(await count('serial_cases')).toBe(0);
    await seedSerial(env, { id: 'sn-b', serial: 'XX-1', buId: 'bu-b', itemId: 'i-b' });
    const other = await report({ serial: 'XX-1' });
    expect(other.ok).toBe(true);
  });

  test('item di luar BU, BU di luar hak tulis, item nonaktif: VALIDATION dengan pesan yang sama', async () => {
    const outside = await report({ itemId: 'i-b' });
    const noRight = await report({ buId: 'bu-b', itemId: 'i-b' });
    const inactive = await report({ itemId: 'i-off' });
    const unknown = await report({ itemId: 'tidak-ada' });
    for (const out of [outside, noRight, inactive, unknown]) {
      expect(out.error?.code).toBe('VALIDATION');
      expect(Object.keys(out.error?.fields ?? {})).toEqual(['itemId']);
    }
    expect(new Set([outside, noRight, inactive, unknown].map((o) => o.error?.message)).size).toBe(
      1,
    );
    expect(await count('serials')).toBe(0);
  });

  test('lokasi tak ada atau nonaktif; catatan kosong; tanggal masa depan; tanggal rusak: VALIDATION', async () => {
    await env.DB.prepare("UPDATE locations SET status = 'inactive' WHERE id = 'loc-jkt'").run();
    expect((await report({ locationId: 'loc-jkt' })).error?.fields).toHaveProperty('locationId');
    expect((await report({ locationId: 'hilang' })).error?.code).toBe('VALIDATION');
    expect((await report({ message: '  ' })).error?.fields).toHaveProperty('message');
    expect((await report({ occurredOn: '2026-11-13' })).error?.fields).toHaveProperty('occurredOn');
    expect((await report({ occurredOn: 'besok' })).error?.code).toBe('VALIDATION');
    expect((await report({ serial: '' })).error?.code).toBe('VALIDATION');
    expect(await count('serials')).toBe(0);
  });

  test('pemegang BU ganda memilih BU: item yang ada di dua BU dilaporkan ke BU pilihan', async () => {
    const out = await report({ itemId: 'i-a2', buId: 'bu-b' }, BOTH);
    expect(out.ok).toBe(true);
    expect(out.data).toMatchObject({ buId: 'bu-b', buCode: 'B' });
  });

  test('hak: serial view saja, tim servis, dan tanpa peran FORBIDDEN', async () => {
    for (const email of [SERIAL_USERS.viewer, SERIAL_USERS.svcEdit, SERIAL_USERS.nobu]) {
      expect([email, (await report({}, email)).error?.code]).toEqual([email, 'FORBIDDEN']);
    }
  });

  test('dua laporan serentak untuk serial yang sama: satu berhasil, satu CONFLICT, hanya satu serial dan satu laporan', async () => {
    const [a, b] = await Promise.all([report({ message: 'A' }), report({ message: 'B' }, BOTH)]);
    expect([a.ok, b.ok].filter(Boolean).length).toBe(1);
    const failed = a.ok ? b : a;
    expect(failed.error?.code).toBe('CONFLICT');
    expect(await count('serials')).toBe(1);
    expect(await count('serial_cases')).toBe(1);
  });

  test('laporan serial berbeda serentak: nomor LP unik berurutan', async () => {
    const results = await Promise.all([1, 2, 3].map((n) => report({ serial: `PAR-${n}` })));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.map((r) => r.data.openCaseNumber).sort()).toEqual([
      'LP-20261112-001',
      'LP-20261112-002',
      'LP-20261112-003',
    ]);
  });

  test('gambar unggahan sendiri pada catatan diklaim pemilik serial baru', async () => {
    const bytes = new Uint8Array(16);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const upload = await restClient(env).post('/files?width=2&height=2', {
      email: W,
      raw: bytes,
      headers: { 'content-type': 'image/png' },
    });
    const fileId = (await jsonOf(upload)).id as string;
    const out = await report({ message: `Retak ![foto](qcfile:${fileId})` });
    expect(out.ok).toBe(true);
    const owner = await env.DB.prepare('SELECT owner_type, owner_id FROM files WHERE id = ?')
      .bind(fileId)
      .first<{ owner_type: string; owner_id: string }>();
    expect(owner).toEqual({ owner_type: 'serial', owner_id: out.data.id });
    // Berkas milik pengguna lain ditolak.
    const foreign = await restClient(env).post('/files?width=2&height=2', {
      email: BOTH,
      raw: bytes,
      headers: { 'content-type': 'image/png' },
    });
    const foreignId = (await jsonOf(foreign)).id as string;
    const bad = await report({ serial: 'NEW-2', message: `![x](qcfile:${foreignId})` });
    expect(bad.error?.code).toBe('VALIDATION');
    expect(await count('serials')).toBe(1);
  });

  test('laporan baru lalu aksi lanjutan: serial siap dikirim ke servis', async () => {
    const out = await report();
    const send = await call(W, 'serials.act', {
      id: out.data.id,
      expectedUpdatedAt: out.data.updatedAt,
      action: 'send',
      occurredOn: TODAY,
      message: '',
      toLocationId: 'loc-jkt',
    });
    expect(send.ok).toBe(true);
    expect(send.data).toMatchObject({ status: 'at_service', custody: 'transit' });
  });
});
