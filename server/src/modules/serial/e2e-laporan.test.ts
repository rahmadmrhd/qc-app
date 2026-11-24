// Uji end to end alur laporan rusak (rancangan 2026-11-14): SATU skenario berurutan lewat kabel REST nyata (`restCall`,
// `app.request`), tanpa memanggil service langsung. Tes saling bergantung dan dijalankan berurutan pada satu lingkungan:
// jalur 1 (serial A) = lapor -> kirim -> diagnosis langsung dari transit -> diperbaiki -> selesai -> terima QC -> cek ulang
// lolos dengan stiker; jalur 2 (serial B) = lapor -> kirim -> Rusak langsung dari transit -> surel -> halaman publik.
import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { app } from '@server/app';
import type { MailMessage } from '@server/core/mail';
import { runPendingJobs } from '@server/jobs/runner';
import { seedRole, seedUser } from '@server-test/access-fixtures';
import { restCall } from '@server-test/rest-call';
import { jsonOf, restClient } from '@server-test/rest-client';
import { SERIAL_USERS, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { verifyReportToken } from './public-link';

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

const W = SERIAL_USERS.writer;
const SVC = SERIAL_USERS.svcEdit;
const MGR = 'kelola-semua@gmail.com';
const TODAY = '2026-11-14';
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let env: TestEnv;
const mails: MailMessage[] = [];

const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

const act = (email: string, serial: Json, action: string, extra: Record<string, unknown> = {}) =>
  call(email, 'serials.act', {
    id: serial.id,
    expectedUpdatedAt: serial.updatedAt,
    action,
    occurredOn: TODAY,
    message: '',
    ...extra,
  });

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

const stock = async (stickerId: string, locationId: string): Promise<number> =>
  Number(
    (
      await env.DB.prepare('SELECT qty FROM sticker_stock WHERE sticker_id = ? AND location_id = ?')
        .bind(stickerId, locationId)
        .first<{ qty: number | string }>()
    )?.qty ?? Number.NaN,
  );
const stickerQty = async (serialId: string, stickerId: string): Promise<number> =>
  Number(
    (
      await env.DB.prepare('SELECT qty FROM serial_stickers WHERE serial_id = ? AND sticker_id = ?')
        .bind(serialId, stickerId)
        .first<{ qty: number | string }>()
    )?.qty ?? Number.NaN,
  );
const stockEntryCount = async (serialId: string): Promise<number> =>
  Number(
    (
      await env.DB.prepare('SELECT COUNT(*) AS n FROM sticker_stock_entries WHERE serial_id = ?')
        .bind(serialId)
        .first<{ n: number | string }>()
    )?.n ?? -1,
  );
const getSerial = async (id: string): Promise<Json> => (await call(W, 'serials.get', { id })).data;

async function fetchPublic(path: string, ip = '203.0.113.5'): Promise<Response> {
  return app.request(`https://qc.test/api/public${path}`, {}, { ...env, clientIp: ip });
}
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

// Keadaan bersama antar tes (skenario berurutan).
let serialA: Json;
let serialB: Json;
let imageB: string;
let token = '';
let caseB = '';

beforeAll(async () => {
  env = await createTestEnv({
    MAILER: {
      send: async (message) => {
        mails.push(message);
      },
    },
  });
  env.clock.set(Date.parse('2026-11-14T03:00:00.000Z')); // 10:00 WIB
  await seedSerialWorld(env);
  await seedRole(env, { id: 'r-mgr', name: 'Kelola Serial', permissions: { serial: 'manage' } });
  await seedUser(env, {
    id: 'u-mgr',
    email: MGR,
    buAssignments: [{ buId: null, roleIds: ['r-mgr'] }],
  });
  await env.DB.prepare("UPDATE users SET name = 'Wati Pencatat' WHERE email = ?").bind(W).run();
  await env.DB.prepare("UPDATE users SET name = 'Budi Servis' WHERE email = ?").bind(SVC).run();
  await env.DB.prepare(
    "INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES ('s1', 'loc-sby', 10, ''), ('s2', 'loc-sby', 10, ''), ('s1', 'loc-jkt', 10, '')",
  ).run();
  await env.DB.prepare("UPDATE stickers SET status = 'inactive' WHERE id = 's2'").run();
});

describe('e2e laporan rusak: jalur 1 (serial A sampai Lolos)', () => {
  test('(a) Lapor Rusak serial baru: lookup kosong, reportNew -> Dilaporkan + LP; laporan kedua ditolak dan lookup menautkan LP aktif', async () => {
    const before = await call(W, 'serials.lookup', { serial: 'e2e-a1' });
    expect(before.ok).toBe(true);
    expect(before.data.matches).toEqual([]);

    const created = await call(W, 'serials.reportNew', {
      serial: 'e2e-a1',
      itemId: 'i-a1',
      buId: 'bu-a',
      locationId: 'loc-sby',
      message: 'Layar mati total',
      occurredOn: TODAY,
    });
    expect(created.ok).toBe(true);
    serialA = created.data;
    expect(serialA).toMatchObject({
      serial: 'E2E-A1',
      status: 'reported',
      custody: 'qc',
      locationId: 'loc-sby',
    });
    expect(serialA.openCase.number).toBe('LP/A/2611-0001');
    expect(serialA.openCaseId).toBe(serialA.openCase.id);

    const got = await getSerial(serialA.id);
    const types = [...got.events].reverse().map((e: Json) => [e.seq, e.type, !!e.caseId]);
    expect(types).toEqual([
      [1, 'recorded', false],
      [2, 'report_failure', true],
    ]);

    // Laporan kedua untuk serial yang sama: ditolak (dua jalur), tanpa kejadian baru.
    const dup = await call(W, 'serials.reportNew', {
      serial: 'E2E-A1',
      itemId: 'i-a1',
      buId: 'bu-a',
      locationId: 'loc-sby',
      message: 'Lapor lagi',
      occurredOn: TODAY,
    });
    expect(dup.ok).toBe(false);
    expect(dup.error.code).toBe('CONFLICT');
    const again = await act(W, serialA, 'report_failure', { message: 'Lapor lagi' });
    expect(again.ok).toBe(false);
    expect(again.error.code).toBe('CONFLICT');
    expect((await getSerial(serialA.id)).events).toHaveLength(2);

    // Tautan ke LP aktif datang dari lookup (dipakai UI): nomor dan id laporan aktif.
    const after = await call(W, 'serials.lookup', { serial: 'E2E-A1' });
    expect(after.data.matches).toHaveLength(1);
    expect(after.data.matches[0]).toMatchObject({
      id: serialA.id,
      status: 'reported',
      openCaseId: serialA.openCaseId,
      openCaseNumber: 'LP/A/2611-0001',
    });
  });

  test('(b) konfigurasi lokasi servis: hanya pengelola yang boleh menyimpan; serviceLocations memuat lokasi efektif', async () => {
    const initial = await call(W, 'serials.serviceLocations', null);
    expect(initial.data.locations.map((l: Json) => l.id)).toEqual(['loc-jkt', 'loc-sby']);
    // Penulis biasa tidak boleh mengubah konfigurasi.
    const denied = await call(W, 'serialServiceSettings.save', {
      expectedUpdatedAt: '',
      locationIds: ['loc-jkt'],
    });
    expect(denied.error?.code).toBe('FORBIDDEN');

    const saved = await call(MGR, 'serialServiceSettings.save', {
      expectedUpdatedAt: '',
      locationIds: ['loc-jkt'],
    });
    expect(saved.ok).toBe(true);
    expect(saved.data.locationIds).toEqual(['loc-jkt']);
    const read = await call(MGR, 'serialServiceSettings.get', null);
    expect(read.data.locationIds).toEqual(['loc-jkt']);
    const effective = await call(W, 'serials.serviceLocations', null);
    expect(effective.data.locations.map((l: Json) => l.id)).toEqual(['loc-jkt']);
    // Simpan ulang dengan ETag usang ditolak.
    const stale = await call(MGR, 'serialServiceSettings.save', {
      expectedUpdatedAt: '',
      locationIds: ['loc-sby'],
    });
    expect(stale.error?.code).toBe('CONFLICT');
  });

  test('(c) kirim ke servis lalu diagnosis LANGSUNG dari transit: dua kejadian (receive otomatis + aksi) dalam satu langkah', async () => {
    const sent = await act(W, serialA, 'send', { message: 'Dikirim ke servis' });
    expect(sent.ok).toBe(true);
    expect(sent.data).toMatchObject({
      status: 'at_service',
      custody: 'transit',
      locationId: 'loc-sby',
    });
    serialA = sent.data;

    // Tim QC tidak boleh mendiagnosis; tim servis boleh.
    expect((await act(W, serialA, 'service_diagnosis', { stage: 'diagnosis' })).error?.code).toBe(
      'FORBIDDEN',
    );

    const eventsBefore = (await getSerial(serialA.id)).events.length;
    const diag = await act(SVC, serialA, 'service_diagnosis', {
      stage: 'diagnosis',
      message: 'Cek motherboard',
    });
    expect(diag.ok).toBe(true);
    expect(diag.data).toMatchObject({
      status: 'diagnosis',
      custody: 'service',
      locationId: 'loc-jkt',
    });
    serialA = diag.data;
    const got = await getSerial(serialA.id);
    expect(got.events.length).toBe(eventsBefore + 2);
    const [last, secondLast] = got.events as Json[];
    expect(secondLast).toMatchObject({ type: 'receive', actorTeam: 'service' });
    expect(secondLast.data).toMatchObject({ auto: true, leg: 'at_service' });
    expect(last).toMatchObject({ type: 'service_diagnosis', actorTeam: 'service' });
    expect(last.seq).toBe(secondLast.seq + 1);
    expect(last.caseId).toBe(serialA.openCaseId);
    expect(secondLast.caseId).toBe(serialA.openCaseId);
  });

  test('(d) berstage repairing -> done (kembali ke QC asal), terima di QC, cek ulang lolos dengan stiker (tepat sekali, inactive ditolak)', async () => {
    const repairing = await act(SVC, serialA, 'service_diagnosis', { stage: 'repairing' });
    expect(repairing.ok).toBe(true);
    expect(repairing.data).toMatchObject({ status: 'service_repair', custody: 'service' });
    serialA = repairing.data;

    const done = await act(SVC, serialA, 'service_diagnosis', {
      stage: 'done',
      message: 'Selesai diperbaiki',
    });
    expect(done.ok).toBe(true);
    expect(done.data).toMatchObject({ status: 'recheck', custody: 'transit' });
    serialA = done.data;
    // Tujuan kembali = QC asal (Surabaya); lokasi unit baru berpindah saat diterima.
    expect(serialA.locationId).toBe('loc-jkt');

    // Tim servis tidak menerima unit di QC; QC menerima, lokasi kembali ke QC asal.
    expect((await act(SVC, serialA, 'receive')).error?.code).toBe('FORBIDDEN');
    const received = await act(W, serialA, 'receive');
    expect(received.ok).toBe(true);
    expect(received.data).toMatchObject({
      status: 'recheck',
      custody: 'qc',
      locationId: 'loc-sby',
    });
    serialA = received.data;

    const stockBefore = await stock('s1', 'loc-sby');
    // Stiker nonaktif (s2) tidak dapat dicentang: ditolak tanpa efek apa pun.
    const rejected = await act(W, serialA, 'recheck_pass', { stickerIds: ['s1', 's2'] });
    expect(rejected.error?.code).toBe('VALIDATION');
    expect(Object.keys(rejected.error?.fields ?? {})).toContain('stickerIds');
    expect(await stock('s1', 'loc-sby')).toBe(stockBefore);
    expect(await stockEntryCount(serialA.id)).toBe(0);
    expect((await getSerial(serialA.id)).serial.status).toBe('recheck');

    const passed = await act(W, serialA, 'recheck_pass', {
      message: 'Normal kembali',
      stickerIds: ['s1'],
    });
    expect(passed.ok).toBe(true);
    expect(passed.data).toMatchObject({ status: 'good', custody: 'qc', openCaseId: null });
    serialA = passed.data;
    expect(serialA.cases[0]).toMatchObject({ number: 'LP/A/2611-0001', outcome: 'good' });
    expect(serialA.cases[0].closedOn).toBe(TODAY);
    // Jumlah tempel naik tepat 1 dan stok di lokasi cek ulang turun tepat 1 (satu entri stok).
    expect(await stickerQty(serialA.id, 's1')).toBe(1);
    expect(await stock('s1', 'loc-sby')).toBe(stockBefore - 1);
    expect(await stock('s1', 'loc-jkt')).toBe(10);
    expect(await stockEntryCount(serialA.id)).toBe(1);
    // Aksi ulang dengan updatedAt lama tidak menambah lagi.
    const replay = await call(W, 'serials.act', {
      id: serialA.id,
      expectedUpdatedAt: received.data.updatedAt,
      action: 'recheck_pass',
      occurredOn: TODAY,
      message: '',
      stickerIds: ['s1'],
    });
    expect(replay.ok).toBe(false);
    expect(await stock('s1', 'loc-sby')).toBe(stockBefore - 1);
    expect(await stockEntryCount(serialA.id)).toBe(1);
  });
});

describe('e2e laporan rusak: jalur 2 (serial B sampai Rusak, surel, halaman publik)', () => {
  test('(e1) serial B sampai Rusak langsung dari transit; tak ada surel sebelum Rusak', async () => {
    imageB = await uploadImage(W, 21);
    const created = await call(W, 'serials.reportNew', {
      serial: 'e2e-b1',
      itemId: 'i-a1',
      buId: 'bu-a',
      locationId: 'loc-sby',
      message: `Retak ![foto](qcfile:${imageB})`,
      occurredOn: TODAY,
    });
    expect(created.ok).toBe(true);
    serialB = created.data;
    caseB = serialB.openCaseId;
    expect(serialB.openCase.number).toBe('LP/A/2611-0002');

    const sent = await act(W, serialB, 'send', { message: 'Kirim servis' });
    expect(sent.ok).toBe(true);
    serialB = sent.data;
    // Surel diaktifkan oleh pengelola.
    const alert = await call(MGR, 'serialSettings.save', {
      expectedUpdatedAt: '',
      alert: { enabled: true, recipients: ['a@contoh.com', 'b@contoh.com'] },
    });
    expect(alert.ok).toBe(true);
    expect(await runPendingJobs(env)).toBe(0);
    expect(mails).toHaveLength(0);

    const broken = await act(SVC, serialB, 'declare_broken', {
      message: 'Layar **pecah** total\nPort mati',
    });
    expect(broken.ok).toBe(true);
    expect(broken.data).toMatchObject({ status: 'broken', custody: 'service', openCaseId: null });
    serialB = broken.data;
    expect(serialB.cases[0]).toMatchObject({ number: 'LP/A/2611-0002', outcome: 'broken' });
    expect(serialB.cases[0].closedOn).toBe(TODAY);
    // Rusak langsung dari transit: receive otomatis + declare_broken, keduanya dalam lingkup laporan.
    const got = await getSerial(serialB.id);
    const [last, prev] = got.events as Json[];
    expect(last).toMatchObject({ type: 'declare_broken', caseId: caseB });
    expect(prev).toMatchObject({ type: 'receive', caseId: caseB });
    expect(prev.data.auto).toBe(true);
    // Surel dikirim runner (bukan saat permintaan).
    expect(mails).toHaveLength(0);
  });

  test('(e2) job serial_alert: satu surel dengan subjek, catatan penuh, dan tautan; tanpa surel pengguna dan stok', async () => {
    expect(await runPendingJobs(env)).toBe(1);
    expect(mails).toHaveLength(1);
    const mail = mails[0] as MailMessage;
    expect(mail.to).toEqual(['a@contoh.com', 'b@contoh.com']);
    expect(mail.subject).toBe('Serial Number rusak: E2E-B1 (Alfa, A)');
    const text = mail.text ?? '';
    expect(text).toContain('Serial Number: E2E-B1');
    expect(text).toContain('Item: Merk Alfa');
    expect(text).toContain('Nomor LP: LP/A/2611-0002');
    expect(text).toContain('Dilaporkan: 2026-11-14');
    expect(text).toContain('Dinyatakan rusak: 2026-11-14');
    expect(text).toContain('Oleh: Budi Servis');
    expect(text).toContain('Layar pecah total\nPort mati');
    expect(text).not.toContain('**');
    expect(text).not.toContain(SVC);
    expect(text).not.toContain(W);
    expect(text).not.toContain('@gmail.com');
    expect(text.toLowerCase()).not.toContain('stok');
    expect(text).toContain('Tautan berlaku sampai 2027-01-13.');
    const found = /Buka: https:\/\/qc\.test\/laporan\/(\S+)\n/.exec(text);
    expect(found).not.toBeNull();
    token = found?.[1] ?? '';
    expect(token.split('.')).toHaveLength(4);
    expect(await verifyReportToken(env.SESSION_SECRET, token, env.clock.now())).toEqual({
      caseId: caseB,
    });
    const job = await env.DB.prepare(
      "SELECT status, result FROM jobs WHERE kind = 'serial_alert'",
    ).first<{ status: string; result: string }>();
    expect(job).toMatchObject({ status: 'done', result: 'sent' });
    // Dijalankan lagi: tidak ada surel ganda.
    expect(await runPendingJobs(env)).toBe(0);
    expect(mails).toHaveLength(1);
  });

  test('(g) sesudah Rusak, catatan (note) masih boleh; aksi lain ditolak', async () => {
    const noted = await act(W, serialB, 'note', { message: 'Klaim-vendor-123 diajukan' });
    expect(noted.ok).toBe(true);
    serialB = noted.data;
    expect(serialB.status).toBe('broken');
    const got = await getSerial(serialB.id);
    expect(got.events[0]).toMatchObject({ type: 'note', caseId: null });
    // Servis juga tidak lagi memberi aksi servis; lapor ulang pada serial Rusak ditolak.
    expect((await act(SVC, serialB, 'declare_broken', { message: 'x' })).error?.code).toBe(
      'CONFLICT',
    );
    expect((await act(W, serialB, 'report_failure', { message: 'x' })).error?.code).toBe(
      'CONFLICT',
    );
    expect(
      (
        await call(W, 'serials.reportNew', {
          serial: 'E2E-B1',
          itemId: 'i-a1',
          buId: 'bu-a',
          locationId: 'loc-sby',
          message: 'x',
          occurredOn: TODAY,
        })
      ).error?.code,
    ).toBe('CONFLICT');
    // Surel tidak dikirim ulang oleh catatan.
    expect(await runPendingJobs(env)).toBe(0);
    expect(mails).toHaveLength(1);
  });

  test('(f1) halaman publik lewat token surel: 200, daftar putih tanpa surel, linimasa hanya kejadian laporan itu', async () => {
    const response = await fetchPublic(`/serial-reports/${token}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    const raw = await response.text();
    const body = JSON.parse(raw) as Json;
    expect(Object.keys(body).sort()).toEqual(
      [
        'caseId',
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
    expect(body).toMatchObject({
      number: 'LP/A/2611-0002',
      openedOn: TODAY,
      closedOn: TODAY,
      outcome: 'broken',
      expiresOn: '2027-01-13',
      viewerCanOpen: false,
      serialId: serialB.id,
    });
    expect(body.unit).toEqual({
      serial: 'E2E-B1',
      itemLabel: 'Merk Alfa',
      buCode: 'A',
      buName: body.unit.buName,
      locationName: 'Jakarta',
      testDate: TODAY,
      sample: false,
      status: 'broken',
    });
    // Linimasa: hanya kejadian dalam lingkup LP (lapor, kirim, receive otomatis, rusak); tanpa `recorded` dan tanpa
    // catatan sesudah Rusak.
    expect(body.events.map((e: Json) => e.type)).toEqual([
      'report_failure',
      'send',
      'receive',
      'declare_broken',
    ]);
    const seqs = body.events.map((e: Json) => e.seq);
    expect(seqs).toEqual([...seqs].sort((x: number, y: number) => x - y));
    for (const event of body.events) {
      expect(Object.keys(event).sort()).toEqual(
        ['actorName', 'actorTeam', 'changes', 'message', 'occurredOn', 'seq', 'type'].sort(),
      );
    }
    expect(body.events[3].actorName).toBe('Budi Servis');
    expect(raw).not.toContain('@');
    expect(raw).not.toContain('Klaim-vendor-123');
    expect(raw.toLowerCase()).not.toContain('stok');
    // Laporan serial A (LP/A/2611-0001) tidak ikut di halaman B.
    expect(raw).not.toContain('E2E-A1');
    expect(raw).not.toContain('Layar mati total');
  });

  test('(f2) rute berkas bertoken: gambar pesan laporan 200 dengan byte aslinya; id lain 404', async () => {
    const response = await fetchPublic(`/serial-reports/${token}/files/${imageB}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes.slice(0, 8))).toEqual(PNG_HEAD);
    expect(bytes[8]).toBe(21);
    const missing = await fetchPublic(`/serial-reports/${token}/files/${crypto.randomUUID()}`);
    expect(missing.status).toBe(404);
  });

  test('(f3) token rusak, dipalsukan, atau laporan lain: 404 yang identik; sesi tidak membuka apa pun', async () => {
    const reference = await problemShape(
      await fetchPublic('/serial-reports/sampah', '198.51.100.1'),
    );
    expect(reference.status).toBe(404);
    const parts = token.split('.');
    const forged = [
      `${parts[0]}.${caseB}.${parts[2]}.${'A'.repeat(43)}`,
      `${parts[0]}.${serialA.openCase?.id ?? serialA.cases[0].id}.${parts[2]}.${parts[3]}`,
      `${parts[0]}.${caseB}.${Number(parts[2]) + 86_400}.${parts[3]}`,
      `${token}x`,
      token.slice(0, -1),
    ];
    let index = 10;
    for (const bad of forged) {
      const shape = await problemShape(
        await fetchPublic(`/serial-reports/${bad}`, `198.51.100.${index++}`),
      );
      expect(shape).toEqual(reference);
    }
  });

  test('(f4) pembatas laju: 20 kegagalan dari satu IP membuat kegagalan berikutnya 429, tautan sah tetap 200', async () => {
    const ip = '198.51.100.99';
    for (let attempt = 0; attempt < 20; attempt++) {
      expect((await fetchPublic(`/serial-reports/salah-${attempt}`, ip)).status).toBe(404);
    }
    expect((await fetchPublic(`/serial-reports/${token}`, ip)).status).toBe(200);
    const blocked = await fetchPublic('/serial-reports/salah-lagi', ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('content-type')).toContain('application/problem+json');
    expect(blocked.headers.get('cache-control')).toBe('no-store');
    expect((await fetchPublic(`/serial-reports/${token}`, '198.51.100.100')).status).toBe(200);
  });

  test('(f5) kedaluwarsa tepat akhir hari WIB ke-60 sesudah laporan ditutup: sebelum batas 200, sesudahnya 404', async () => {
    env.clock.set(Date.parse('2027-01-13T16:59:59.000Z')); // 23:59:59 WIB
    expect((await fetchPublic(`/serial-reports/${token}`, '192.0.2.50')).status).toBe(200);
    env.clock.set(Date.parse('2027-01-13T17:00:02.000Z')); // 00:00:02 WIB hari berikutnya
    const expired = await fetchPublic(`/serial-reports/${token}`, '192.0.2.51');
    expect(expired.status).toBe(404);
    const reference = await problemShape(await fetchPublic('/serial-reports/sampah', '192.0.2.52'));
    expect(await problemShape(expired)).toEqual(reference);
    expect(
      (await fetchPublic(`/serial-reports/${token}/files/${imageB}`, '192.0.2.53')).status,
    ).toBe(404);
  });
});
