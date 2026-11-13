// Halaman publik laporan rusak (rancangan 2026-11-14 §4.8, §5a): `/api/public/serial-reports/:token[/files/:fileId]`.
import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { app } from '@server/app';
import { signSessionToken } from '@server/core/session';
import { restCall } from '@server-test/rest-call';
import { jsonOf, restClient } from '@server-test/rest-client';
import { SERIAL_USERS, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { reportLinkExpiresAt } from '@shared/serials';
import { signReportToken } from './public-link';

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;

let env: TestEnv;
const W = SERIAL_USERS.writer;
const SVC = SERIAL_USERS.svcEdit;
const TODAY = '2026-11-12';
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IP = '203.0.113.5';

const call = async (email: string, id: string, input: unknown): Promise<Json> =>
  restCall(env, email, id, input);

async function uploadImage(email: string, marker: number): Promise<string> {
  const bytes = new Uint8Array(16);
  bytes.set(PNG_HEAD, 0);
  bytes[8] = marker;
  const response = await restClient(env).post('/files?width=2&height=2', {
    email,
    raw: bytes,
    headers: { 'content-type': 'image/png' },
  });
  expect(response.status).toBe(201);
  return (await jsonOf(response)).id as string;
}

const md = (id: string) => `Retak ![gambar](qcfile:${id})`;

interface World {
  serialId: string;
  caseId: string;
  imageId: string;
}

/** Laporan baru (gambar pada catatan) -> kirim ke servis -> servis menyatakan Rusak: laporan tertutup pada TODAY. */
async function brokenReport(serial: string, marker: number): Promise<World> {
  const imageId = await uploadImage(W, marker);
  const reported = await call(W, 'serials.reportNew', {
    serial,
    itemId: 'i-a1',
    buId: 'bu-a',
    locationId: 'loc-sby',
    message: md(imageId),
    occurredOn: TODAY,
  });
  expect(reported.ok).toBe(true);
  const sent = await call(W, 'serials.act', {
    id: reported.data.id,
    expectedUpdatedAt: reported.data.updatedAt,
    action: 'send',
    occurredOn: TODAY,
    message: 'Kirim ke servis',
    toLocationId: 'loc-jkt',
  });
  expect(sent.ok).toBe(true);
  const broken = await call(SVC, 'serials.act', {
    id: reported.data.id,
    expectedUpdatedAt: sent.data.updatedAt,
    action: 'declare_broken',
    occurredOn: TODAY,
    message: 'Mati total',
  });
  expect(broken.ok).toBe(true);
  expect(broken.data.status).toBe('broken');
  return { serialId: reported.data.id, caseId: reported.data.openCaseId, imageId };
}

const tokenFor = (caseId: string, closedOn = TODAY) =>
  signReportToken(env.SESSION_SECRET, caseId, reportLinkExpiresAt(closedOn));

async function fetchPublic(
  path: string,
  options: { ip?: string; cookie?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.cookie = options.cookie;
  return app.request(
    `https://qc.test/api/public${path}`,
    { headers },
    { ...env, clientIp: options.ip ?? IP },
  );
}

const report = (token: string, options?: { ip?: string; cookie?: string }) =>
  fetchPublic(`/serial-reports/${token}`, options);
const file = (token: string, fileId: string, options?: { ip?: string; cookie?: string }) =>
  fetchPublic(`/serial-reports/${token}/files/${fileId}`, options);

const problemShape = async (response: Response) => {
  const body = (await response.json()) as Json;
  return {
    status: response.status,
    type: body.type,
    title: body.title,
    detail: body.detail,
    code: body.code,
  };
};

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
  await seedSerialWorld(env);
  await env.DB.prepare("UPDATE users SET name = 'Wati Pencatat' WHERE email = ?").bind(W).run();
  await env.DB.prepare("UPDATE users SET name = 'Budi Servis' WHERE email = ?").bind(SVC).run();
  await env.DB.prepare(
    "INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES ('s1', 'loc-sby', 10, '')",
  ).run();
});

describe('GET /api/public/serial-reports/:token', () => {
  test('token sah tanpa sesi: 200 dengan unit, laporan, dan linimasa dalam lingkup nomor LP itu', async () => {
    const { serialId, caseId } = await brokenReport('PUB-1', 1);
    // Catatan sesudah Rusak (caseId kosong) dan kejadian laporan lain TIDAK ikut.
    const state = await call(W, 'serials.get', { id: serialId });
    const noted = await call(W, 'serials.act', {
      id: serialId,
      expectedUpdatedAt: state.data.serial.updatedAt,
      action: 'note',
      occurredOn: TODAY,
      message: 'Catatan-sesudah-rusak',
    });
    expect(noted.ok).toBe(true);
    await env.DB.prepare(
      "INSERT INTO serial_cases (id, number, serial_id, bu_id, opened_on, closed_on, outcome, created_at, created_by, updated_at) VALUES ('c-old', 'LP-20261001-001', ?, 'bu-a', '2026-10-01', '2026-10-03', 'good', '2026-10-01T00:00:00.000Z', 's', 't')",
    )
      .bind(serialId)
      .run();
    await env.DB.prepare(
      "INSERT INTO serial_events (id, serial_id, case_id, seq, type, occurred_on, created_at, actor_id, actor_name, actor_team, message, changes_json, data_json) VALUES ('e-old', ?, 'c-old', 90, 'note', '2026-10-02', '2026-10-02T00:00:00.000Z', 'x', 'Lama', 'qc', 'Kejadian-laporan-lain', '[]', '{}')",
    )
      .bind(serialId)
      .run();

    const response = await report(await tokenFor(caseId));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Json;
    expect(body).toMatchObject({
      number: expect.stringMatching(/^LP-20261112-\d{3}$/),
      openedOn: TODAY,
      closedOn: TODAY,
      outcome: 'broken',
      expiresOn: '2026-12-12',
      viewerCanOpen: false,
      serialId,
      unit: {
        serial: 'PUB-1',
        itemLabel: 'Merk Alfa',
        buCode: 'A',
        buName: 'A',
        locationName: 'Jakarta',
        sample: false,
        status: 'broken',
      },
    });
    expect(body.events.map((e: Json) => e.type)).toEqual([
      'report_failure',
      'send',
      'receive',
      'declare_broken',
    ]);
    expect(body.events.map((e: Json) => e.seq)).toEqual(
      [...body.events.map((e: Json) => e.seq)].sort((a: number, b: number) => a - b),
    );
    expect(body.events[0]).toMatchObject({ actorName: 'Wati Pencatat', actorTeam: 'qc' });
    expect(body.events[3]).toMatchObject({
      actorName: 'Budi Servis',
      actorTeam: 'service',
      message: 'Mati total',
    });
    const text = JSON.stringify(body);
    expect(text).not.toContain('Catatan-sesudah-rusak');
    expect(text).not.toContain('Kejadian-laporan-lain');
  });

  test('DTO hanya memuat daftar putih field: tanpa surel, stok, atau data mentah', async () => {
    const { caseId } = await brokenReport('PUB-2', 2);
    const body = (await (await report(await tokenFor(caseId))).json()) as Json;
    expect(Object.keys(body).sort()).toEqual(
      [
        'closedOn',
        'events',
        'expiresOn',
        'number',
        'openedOn',
        'outcome',
        'serialId',
        'unit',
        'viewerCanOpen',
      ].sort(),
    );
    expect(Object.keys(body.unit).sort()).toEqual(
      [
        'buCode',
        'buName',
        'itemLabel',
        'locationName',
        'sample',
        'serial',
        'status',
        'testDate',
      ].sort(),
    );
    for (const event of body.events) {
      expect(Object.keys(event).sort()).toEqual(
        ['actorName', 'actorTeam', 'changes', 'message', 'occurredOn', 'seq', 'type'].sort(),
      );
    }
    const text = JSON.stringify(body);
    expect(text).not.toContain('@');
    expect(text.toLowerCase()).not.toContain('stock');
    expect(text.toLowerCase()).not.toContain('"data"');
  });

  test('nama pelaku berupa alamat surel atau kosong: DTO publik menampilkan bagian lokal atau Admin, tanpa "@"', async () => {
    const { caseId } = await brokenReport('PUB-ADM', 9);
    await env.DB.prepare(
      "UPDATE serial_events SET actor_name = '' WHERE case_id = ? AND type = 'declare_broken'",
    )
      .bind(caseId)
      .run();
    await env.DB.prepare(
      "UPDATE serial_events SET actor_name = ? WHERE case_id = ? AND type = 'report_failure'",
    )
      .bind('pencatat@gmail.com', caseId)
      .run();
    const body = (await (await report(await tokenFor(caseId))).json()) as Json;
    const names = body.events.map((e: Json) => e.actorName);
    expect(names).toContain('pencatat');
    expect(names).toContain('Admin');
    expect(JSON.stringify(body)).not.toContain('@');
  });

  test('header respons: Cache-Control no-store dan Referrer-Policy no-referrer', async () => {
    const { caseId } = await brokenReport('PUB-3', 3);
    const ok = await report(await tokenFor(caseId));
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(ok.headers.get('referrer-policy')).toBe('no-referrer');
    const bad = await report('v1.x.1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(bad.headers.get('cache-control')).toBe('no-store');
    expect(bad.headers.get('referrer-policy')).toBe('no-referrer');
  });

  test('token salah, kedaluwarsa, tanda tangan rusak, atau laporan tak ada: 404 problem+json yang IDENTIK', async () => {
    const { caseId } = await brokenReport('PUB-4', 4);
    const good = await tokenFor(caseId);
    const parts = good.split('.');
    const tampered = `${good.slice(0, -1)}${good.endsWith('A') ? 'B' : 'A'}`;
    const missingCase = await tokenFor('00000000-0000-4000-8000-000000000000');
    const expired = await signReportToken(
      env.SESSION_SECRET,
      caseId,
      Date.parse('2026-11-12T03:00:00.000Z') - 1000,
    );
    const otherSecret = await signReportToken(
      'rahasia-lain-0123456789',
      caseId,
      reportLinkExpiresAt(TODAY),
    );
    const cases = [
      tampered,
      missingCase,
      expired,
      otherSecret,
      'sampah',
      `${parts[0]}.${parts[1]}`,
      'v1..0.x',
    ];
    const shapes = [];
    for (const token of cases) {
      const response = await report(token, { ip: '198.51.100.7' });
      expect([token.slice(0, 12), response.status]).toEqual([token.slice(0, 12), 404]);
      expect(response.headers.get('content-type')).toContain('application/problem+json');
      shapes.push(await problemShape(response));
    }
    expect(new Set(shapes.map((s) => JSON.stringify(s))).size).toBe(1);
    expect(shapes[0]).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  test('kedaluwarsa tepat di akhir hari WIB hari ke-30: sebelum batas 200, sesudahnya 404', async () => {
    const { caseId } = await brokenReport('PUB-5', 5);
    const token = await tokenFor(caseId);
    env.clock.set(Date.parse('2026-12-12T16:59:00.000Z'));
    expect((await report(token)).status).toBe(200);
    env.clock.set(Date.parse('2026-12-12T17:00:01.000Z'));
    expect((await report(token)).status).toBe(404);
  });

  test('viewerCanOpen: true hanya bagi sesi sah yang boleh membaca BU serial; sesi lain, rusak, atau tanpa sesi = false', async () => {
    const { caseId } = await brokenReport('PUB-6', 6);
    const token = await tokenFor(caseId);
    const cookieOf = async (email: string) =>
      `qc_session=${await signSessionToken(env, email, env.clock.now())}`;
    const open = async (cookie?: string) =>
      ((await (await report(token, { cookie })).json()) as Json).viewerCanOpen;
    expect(await open(await cookieOf(W))).toBe(true);
    expect(await open(await cookieOf(SERIAL_USERS.service))).toBe(true);
    expect(await open(await cookieOf(SERIAL_USERS.svcB))).toBe(false); // hanya BU B
    expect(await open(await cookieOf(SERIAL_USERS.nobu))).toBe(false);
    expect(await open('qc_session=bukan-token')).toBe(false);
    expect(await open()).toBe(false);
  });

  test('sesi TIDAK dipakai untuk meloloskan token: sesi berizin dengan token salah tetap 404', async () => {
    const cookie = `qc_session=${await signSessionToken(env, W, env.clock.now())}`;
    const response = await report('v1.x.1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', { cookie });
    expect(response.status).toBe(404);
  });

  test('pembatas laju: 20 kegagalan dari satu IP membuat kegagalan berikutnya 429; tautan sah tetap 200; IP lain dan jendela baru tidak terblokir', async () => {
    const { caseId, imageId } = await brokenReport('PUB-7', 7);
    const good = await tokenFor(caseId);
    const ip = '198.51.100.9';
    for (let attempt = 0; attempt < 20; attempt++) {
      expect((await report(`salah-${attempt}`, { ip })).status).toBe(404);
    }
    const blocked = await report('salah-lagi', { ip });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('content-type')).toContain('application/problem+json');
    expect((await file('salah-lagi', imageId, { ip })).status).toBe(429);
    // Tautan SAH tetap dilayani walau IP sudah diblokir (pembatas hanya menahan jalur kegagalan).
    expect((await report(good, { ip })).status).toBe(200);
    expect((await file(good, imageId, { ip })).status).toBe(200);
    expect((await report('salah-lagi', { ip })).status).toBe(429);
    expect((await report('salah-lagi', { ip: '198.51.100.10' })).status).toBe(404);
    // Jendela 10 menit berlalu: kegagalan dihitung dari awal lagi.
    env.clock.advance(10 * 60_000 + 1000);
    expect((await report('salah-lagi', { ip })).status).toBe(404);
  });

  test('permintaan sukses tidak menghabiskan jatah kegagalan', async () => {
    const { caseId } = await brokenReport('PUB-8', 8);
    const good = await tokenFor(caseId);
    for (let attempt = 0; attempt < 30; attempt++) expect((await report(good)).status).toBe(200);
  });
});

describe('GET /api/public/serial-reports/:token/files/:fileId', () => {
  test('gambar yang dirujuk pesan laporan itu: 200 dengan byte dan tipe aslinya', async () => {
    const { caseId, imageId } = await brokenReport('FIL-1', 11);
    const response = await file(await tokenFor(caseId), imageId);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes).toHaveLength(16);
    expect(bytes[8]).toBe(11);
  });

  test('berkas serial yang sama di luar laporan, berkas serial lain, dan id acak: 404 identik', async () => {
    const one = await brokenReport('FIL-2', 12);
    const other = await brokenReport('FIL-3', 13);
    // Gambar milik serial yang sama tetapi pada catatan SESUDAH Rusak (di luar laporan).
    const outside = await uploadImage(W, 14);
    const state = await call(W, 'serials.get', { id: one.serialId });
    const noted = await call(W, 'serials.act', {
      id: one.serialId,
      expectedUpdatedAt: state.data.serial.updatedAt,
      action: 'note',
      occurredOn: TODAY,
      message: md(outside),
    });
    expect(noted.ok).toBe(true);
    const token = await tokenFor(one.caseId);
    const shapes = [];
    for (const id of [
      outside,
      other.imageId,
      '00000000-0000-4000-8000-000000000000',
      'bukan-id',
      '..%2F..%2Fetc',
    ]) {
      const response = await file(token, id);
      expect([id, response.status]).toEqual([id, 404]);
      shapes.push(await problemShape(response));
    }
    expect(new Set(shapes.map((s) => JSON.stringify(s))).size).toBe(1);
    // Token laporan lain melayani berkas laporan lain itu sendiri.
    expect((await file(await tokenFor(other.caseId), other.imageId)).status).toBe(200);
  });

  test('token salah/kedaluwarsa: 404 sama dengan berkas tak ada; berkas dihapus atau ditandai hapus: 404', async () => {
    const { caseId, imageId } = await brokenReport('FIL-4', 15);
    const token = await tokenFor(caseId);
    expect((await file('sampah', imageId)).status).toBe(404);
    expect((await file(token, imageId)).status).toBe(200);
    await env.DB.prepare("UPDATE files SET status = 'pending_delete' WHERE id = ?")
      .bind(imageId)
      .run();
    expect((await file(token, imageId)).status).toBe(404);
  });

  test('gambar milik serial dan BU lain yang kebetulan dirujuk pesan laporan ini tetap 404', async () => {
    const one = await brokenReport('FIL-5', 16);
    const other = await brokenReport('FIL-6', 17);
    // Kejadian laporan `one` merujuk berkas `other` (data tak wajar): pemilik berkas bukan serial laporan ini.
    await env.DB.prepare(
      "INSERT INTO serial_events (id, serial_id, case_id, seq, type, occurred_on, created_at, actor_id, actor_name, actor_team, message, changes_json, data_json) VALUES ('e-x', ?, ?, 95, 'note', ?, '2026-11-12T00:00:00.000Z', 'x', 'X', 'qc', ?, '[]', '{}')",
    )
      .bind(one.serialId, one.caseId, TODAY, md(other.imageId))
      .run();
    expect((await file(await tokenFor(one.caseId), other.imageId)).status).toBe(404);
  });
});

describe('indeks serial_events_case (K1)', () => {
  test('kueri linimasa dan pemeriksaan berkas berpredikat serial_id memakai indeks berawalan serial_id (bukan pindai penuh)', async () => {
    for (const sql of [
      'SELECT id FROM serial_events WHERE serial_id = ? AND case_id = ? ORDER BY seq ASC LIMIT ?',
      'SELECT message FROM serial_events WHERE serial_id = ? AND case_id = ?',
    ]) {
      const binds = sql.includes('LIMIT') ? ['s', 'c', 5] : ['s', 'c'];
      const plan = await env.DB.prepare(`EXPLAIN ${sql}`)
        .bind(...binds)
        .all<{ key: string | null }>();
      // Kolom terdepan kedua indeks adalah serial_id: tanpa predikat itu MariaDB memindai seluruh tabel (key NULL).
      expect(plan.results.map((row) => row.key)).toEqual([
        expect.stringMatching(/^serial_events_(case|seq)$/),
      ]);
    }
  });
});
