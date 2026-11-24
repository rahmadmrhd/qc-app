// Surel "Serial Number rusak" (5b, spek §4.6): pendengar `serial.declared_broken` -> job `serial_alert` -> surel, dan
// pengaturan `serialSettings.get|save` (kunci `SERIAL_ALERT`, penerima global).
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import type { MailMessage } from '@server/core/mail';
import { putSetting } from '@server/core/settings';
import { runPendingJobs } from '@server/jobs/runner';
import { JOB_MAX_ATTEMPTS } from '@server/modules/jobs/consumer';
import { seedRole, seedUser } from '@server-test/access-fixtures';
import { restCall } from '@server-test/rest-call';
import { jsonOf, restClient } from '@server-test/rest-client';
import { SERIAL_USERS, seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { SETTING_SERIAL_ALERT } from './alert';
import { serialAlertJobStmt, serialBrokenMail } from './alert-job';
import { verifyReportToken } from './public-link';

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;
let sent: MailMessage[];
const realError = console.error;
const SVC = SERIAL_USERS.svcEdit;
const AT = '2026-11-12T00:00:00.000Z';
const TODAY = '2026-11-12';
const MGR = 'kelola-semua@gmail.com';
const MGR_ONE = 'kelola-satu@gmail.com';
const EDIT_ALL = 'edit-semua@gmail.com';

const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

async function freshEnv(over: { mailer?: boolean } = {}): Promise<void> {
  sent = [];
  env = await createTestEnv(
    over.mailer === false
      ? {}
      : {
          MAILER: {
            send: async (message) => {
              sent.push(message);
            },
          },
        },
  );
  env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
  await seedSerialWorld(env);
  await seedRole(env, { id: 'r-mgr', name: 'Kelola Serial', permissions: { serial: 'manage' } });
  await seedRole(env, { id: 'r-ed', name: 'Edit Serial', permissions: { serial: 'edit' } });
  await seedUser(env, {
    id: 'u-mgr',
    email: MGR,
    buAssignments: [{ buId: null, roleIds: ['r-mgr'] }],
  });
  await seedUser(env, {
    id: 'u-mgr1',
    email: MGR_ONE,
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-mgr'] }],
  });
  await seedUser(env, {
    id: 'u-ed',
    email: EDIT_ALL,
    buAssignments: [{ buId: null, roleIds: ['r-ed'] }],
  });
}

beforeEach(async () => {
  console.error = () => undefined;
  await freshEnv();
});
afterEach(() => {
  console.error = realError;
});

async function enableAlert(recipients = ['a@contoh.com', 'b@contoh.com']): Promise<void> {
  const out = await call(MGR, 'serialSettings.save', {
    expectedUpdatedAt: '',
    alert: { enabled: true, recipients },
  });
  expect(out.ok).toBe(true);
}

const CASE = { id: 'case-1', number: 'LP/A/2611-0001', openedOn: '2026-11-10' };
const seedBroken = () =>
  seedSerial(env, {
    id: 'sn1',
    serial: 'AB12',
    buId: 'bu-a',
    itemId: 'i-a1',
    status: 'service_repair',
    custody: 'service',
    openCase: { ...CASE, createdBy: 'pelapor@gmail.com' },
  });
const declareBroken = (over: { at?: string; message?: string } = {}) =>
  call(SVC, 'serials.act', {
    id: 'sn1',
    expectedUpdatedAt: over.at ?? AT,
    action: 'declare_broken',
    occurredOn: TODAY,
    message: over.message ?? 'Mati total',
  });
const alertJobs = () =>
  env.DB.prepare(
    "SELECT id, status, input, created_by, result FROM jobs WHERE kind = 'serial_alert' ORDER BY created_at",
  ).all<{ id: string; status: string; input: string; created_by: string; result: string }>();

describe('declare_broken dan antrean job', () => {
  test('membuat tepat satu job serial_alert dalam batch yang sama; stale (CONFLICT) tidak membuat job', async () => {
    await seedBroken();
    const stale = await declareBroken({ at: '2026-01-01T00:00:00.000Z' });
    expect(stale.error?.code).toBe('CONFLICT');
    expect((await alertJobs()).results).toHaveLength(0);

    const ok = await declareBroken();
    expect(ok.ok).toBe(true);
    const jobs = (await alertJobs()).results;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: 'queued', created_by: 'system' });
    const input = JSON.parse(jobs[0]?.input ?? '{}');
    const event = await env.DB.prepare(
      "SELECT id FROM serial_events WHERE serial_id = 'sn1' AND type = 'declare_broken'",
    ).first<{ id: string }>();
    expect(input).toEqual({ serialId: 'sn1', caseId: 'case-1', eventId: event?.id });
  });

  test('menjalankan job mengirim SATU surel: subjek memuat tipe item, badan memuat catatan penuh dan nama pelaku, tanpa surel pelaku atau stok', async () => {
    await enableAlert();
    await env.DB.prepare("UPDATE users SET name = 'Budi Servis' WHERE email = ?").bind(SVC).run();
    await seedBroken();
    const out = await declareBroken({ message: 'Layar **pecah** total\nPort mati' });
    expect(out.ok).toBe(true);
    expect(sent).toHaveLength(0); // dikirim runner, bukan saat permintaan pengguna
    expect(await runPendingJobs(env)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toEqual(['a@contoh.com', 'b@contoh.com']);
    expect(sent[0]?.subject).toBe('Serial Number rusak: AB12 (Alfa, A)');
    const text = sent[0]?.text ?? '';
    const token = /Buka: https:\/\/qc\.test\/laporan\/(\S+)\n/.exec(text)?.[1] ?? '';
    expect(text).toBe(
      [
        'Ada Serial Number yang dinyatakan rusak.',
        '',
        'Serial Number: AB12',
        'Item: Merk Alfa',
        'BU: A (A)',
        'Nomor LP: LP/A/2611-0001',
        'Lokasi unit: Surabaya',
        'Dilaporkan: 2026-11-10',
        'Dinyatakan rusak: 2026-11-12',
        'Oleh: Budi Servis',
        '',
        'Catatan:',
        'Layar pecah total',
        'Port mati',
        '',
        `Buka: https://qc.test/laporan/${token}`,
        'Tautan berlaku sampai 2027-01-11.',
        '',
      ].join('\n'),
    );
    expect(await verifyReportToken(env.SESSION_SECRET, token, env.clock.now())).toEqual({
      caseId: 'case-1',
    });
    expect(text).not.toContain(SVC);
    expect(text).not.toContain('pelapor@gmail.com');
    expect(text).not.toContain('**');
    expect(text.toLowerCase()).not.toContain('stok');
    expect((await alertJobs()).results[0]).toMatchObject({ status: 'done', result: 'sent' });
  });

  test('catatan bergambar: gambar dijelaskan jumlahnya; catatan kosong ditulis "-"', async () => {
    await enableAlert();
    await seedBroken();
    await env.DB.prepare(
      "INSERT INTO serial_events (id, serial_id, case_id, seq, type, occurred_on, created_at, actor_id, actor_name, actor_team, message, changes_json, data_json) VALUES ('e-fix', 'sn1', 'case-1', 9, 'declare_broken', ?, ?, 'x', 'Budi', 'service', ?, '[]', '{}')",
    )
      .bind(TODAY, AT, 'Retak ![foto](qcfile:abc) dan ![foto2](qcfile:def)')
      .run();
    await env.DB.prepare(
      "UPDATE serial_cases SET closed_on = ?, outcome = 'broken' WHERE id = 'case-1'",
    )
      .bind(TODAY)
      .run();
    await env.DB.batch([
      serialAlertJobStmt(env, { serialId: 'sn1', caseId: 'case-1', eventId: 'e-fix' }),
    ]);
    await runPendingJobs(env);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain('Retak dan');
    expect(sent[0]?.text).toContain('(2 gambar, lihat di tautan)');
    expect(sent[0]?.text).not.toContain('qcfile');
  });

  test('tautan hanya bila APP_ORIGIN dan rahasia sesi tersedia; surel tetap terkirim tanpa tautan', async () => {
    await enableAlert();
    await seedBroken();
    await declareBroken({ message: 'Mati total' });
    delete env.APP_ORIGIN;
    await runPendingJobs(env);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).not.toContain('Buka:');
    expect(sent[0]?.text).not.toContain('/laporan/');
    expect(sent[0]?.text).toContain('Mati total');

    await freshEnv();
    await enableAlert();
    await seedBroken();
    await declareBroken({ message: 'Mati total' });
    env.SESSION_SECRET = '';
    await runPendingJobs(env);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).not.toContain('Buka:');
  });

  test('serialBrokenMail: nama pelaku berupa alamat surel diganti bagian lokal; nama kosong menjadi Admin', () => {
    const base = {
      serial: 'AB12',
      buCode: 'A',
      buName: 'A',
      itemLabel: 'Merk Alfa',
      itemModel: 'Alfa',
      caseNumber: 'LP-1',
      locationName: 'Surabaya',
      reportedOn: '2026-11-10',
      brokenOn: '2026-11-12',
      note: 'Mati',
      link: '',
      linkExpiresOn: '',
    };
    const byEmail = serialBrokenMail({ ...base, actorName: 'super.admin@gmail.com' });
    expect(byEmail.text).toContain('Oleh: super.admin\n');
    expect(byEmail.text).not.toContain('@');
    expect(serialBrokenMail({ ...base, actorName: '' }).text).toContain('Oleh: Admin\n');
  });

  test('serialBrokenMail: karakter kontrol dan pengatur arah dibersihkan; subjek satu baris; catatan per baris', () => {
    const mail = serialBrokenMail({
      serial: 'AB\nBcc: x@y.co',
      buCode: 'A\r\nX',
      buName: 'Alfa',
      itemLabel: 'Merk\u0000Alfa',
      itemModel: 'Alfa\nBcc: z@y.co',
      caseNumber: 'LP-1',
      locationName: 'Sby‮',
      reportedOn: '2026-11-10',
      brokenOn: '2026-11-12',
      actorName: 'Bud\ni',
      note: 'Layar\nBcc: x@y.co‮pecah',
      link: '',
      linkExpiresOn: '',
    });
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.subject).toBe('Serial Number rusak: AB Bcc: x@y.co (Alfa Bcc: z@y.co, A X)');
    expect(mail.text).not.toContain('‮');
    expect(mail.text).not.toContain('\u0000');
    expect(mail.text).toContain('Oleh: Bud i');
    // catatan multibaris tetap per baris, tetapi isinya sudah bersih
    expect(mail.text).toContain('Catatan:\nLayar\nBcc: x@y.co pecah\n');
    expect(mail.text).not.toContain('Buka:');
  });

  test('pengaturan nonaktif, tanpa penerima, atau tanpa SMTP: job selesai skipped tanpa kirim', async () => {
    // 1. belum pernah diatur (bawaan nonaktif)
    await seedBroken();
    await declareBroken();
    await runPendingJobs(env);
    expect(sent).toHaveLength(0);
    expect((await alertJobs()).results[0]).toMatchObject({ status: 'done', result: 'skipped' });

    // 2. aktif tetapi tanpa penerima
    await freshEnv();
    await enableAlert([]);
    await seedBroken();
    await declareBroken();
    await runPendingJobs(env);
    expect(sent).toHaveLength(0);
    expect((await alertJobs()).results[0]).toMatchObject({ status: 'done', result: 'skipped' });

    // 3. aktif dengan penerima tetapi SMTP belum diatur
    await freshEnv({ mailer: false });
    await enableAlert();
    await seedBroken();
    await declareBroken();
    await runPendingJobs(env);
    expect((await alertJobs()).results[0]).toMatchObject({ status: 'done', result: 'skipped' });
  });

  test('pengaturan dibaca saat kirim: dimatikan sesudah aksi menahan surel; penerima tersimpan yang rusak dibuang', async () => {
    await enableAlert();
    await seedBroken();
    await declareBroken();
    await putSetting(
      env,
      SETTING_SERIAL_ALERT,
      JSON.stringify({
        enabled: true,
        recipients: ['ok@contoh.com', 'a@b.c, d@e.f', 7],
        updatedAt: 'x',
      }),
    );
    await runPendingJobs(env);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toEqual(['ok@contoh.com']);
  });

  test('MAILER melempar: job diulang lalu failed; serial tetap broken dan aksi pengguna tak terpengaruh', async () => {
    await enableAlert();
    env.MAILER = {
      send: async () => {
        throw new Error('SMTP putus');
      },
    };
    await seedBroken();
    const out = await declareBroken();
    expect(out.ok).toBe(true);
    expect(await runPendingJobs(env)).toBe(1);
    expect((await alertJobs()).results[0]?.status).toBe('running');
    for (let attempt = 2; attempt <= JOB_MAX_ATTEMPTS; attempt++) {
      env.clock.advance(5 * 60_000);
      expect(await runPendingJobs(env)).toBe(1);
    }
    expect((await alertJobs()).results[0]?.status).toBe('failed');
    const serial = await env.DB.prepare("SELECT status FROM serials WHERE id = 'sn1'").first<{
      status: string;
    }>();
    expect(serial?.status).toBe('broken');
  });
});

describe('serialSettings', () => {
  test('bawaan: nonaktif, tanpa penerima; smtpConfigured mengikuti MAILER', async () => {
    const out = await call(MGR, 'serialSettings.get', null);
    expect(out.data).toEqual({
      alert: { enabled: false, recipients: [] },
      updatedAt: '',
      smtpConfigured: true,
    });
    delete env.MAILER;
    expect((await call(MGR, 'serialSettings.get', null)).data.smtpConfigured).toBe(false);
  });

  test('izin hanya menghitung BU AKTIF: BU nonaktif tak dikelola tidak menghalangi; semua nonaktif = ditolak', async () => {
    // MGR_ONE hanya mengelola bu-a; bu-b aktif dan tak dikelola menghalangi.
    expect((await call(MGR_ONE, 'serialSettings.get', null)).error?.code).toBe('FORBIDDEN');
    await env.DB.prepare("UPDATE business_units SET status = 'inactive' WHERE id = 'bu-b'").run();
    expect((await call(MGR_ONE, 'serialSettings.get', null)).ok).toBe(true);
    // Tanpa BU aktif sama sekali: gagal tertutup untuk pengelola biasa.
    await env.DB.prepare("UPDATE business_units SET status = 'inactive'").run();
    expect((await call(MGR_ONE, 'serialSettings.get', null)).error?.code).toBe('FORBIDDEN');
    expect((await call(MGR, 'serialSettings.get', null)).error?.code).toBe('FORBIDDEN');
  });

  test('simpan pertama dan kedua: penerima dinormalkan, audit serial.settings, get menyajikan nilainya', async () => {
    const first = await call(MGR, 'serialSettings.save', {
      expectedUpdatedAt: '',
      alert: { enabled: true, recipients: ['  Satu@Contoh.com '] },
    });
    expect(first.ok).toBe(true);
    expect(first.data.alert).toEqual({ enabled: true, recipients: ['satu@contoh.com'] });
    expect(first.data.updatedAt).toBe('2026-11-12T03:00:00.000Z');
    env.clock.advance(60_000);
    const second = await call(MGR, 'serialSettings.save', {
      expectedUpdatedAt: first.data.updatedAt,
      alert: { enabled: false, recipients: ['satu@contoh.com', 'dua@contoh.com'] },
    });
    expect(second.ok).toBe(true);
    expect((await call(MGR, 'serialSettings.get', null)).data.alert.recipients).toHaveLength(2);
    const audits = await env.DB.prepare(
      "SELECT action, target FROM audit_log WHERE action = 'serial.settings' ORDER BY ts",
    ).all<{ action: string; target: string }>();
    expect(audits.results).toEqual([
      { action: 'serial.settings', target: 'settings:SERIAL_ALERT' },
      { action: 'serial.settings', target: 'settings:SERIAL_ALERT' },
    ]);
  });

  test('If-Match usang: 412 dan CONFLICT; tanpa nilai awal saat sudah ada pengaturan juga usang', async () => {
    const rest = restClient(env);
    const first = await call(MGR, 'serialSettings.save', {
      expectedUpdatedAt: '',
      alert: { enabled: true, recipients: ['a@contoh.com'] },
    });
    env.clock.advance(60_000);
    const stale = await call(MGR, 'serialSettings.save', {
      expectedUpdatedAt: '',
      alert: { enabled: true, recipients: ['b@contoh.com'] },
    });
    expect(stale.error?.code).toBe('CONFLICT');
    const res = await rest.put('/serial-settings', {
      email: MGR,
      body: {
        expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
        alert: { enabled: true, recipients: ['b@contoh.com'] },
      },
      headers: { 'If-Match': '"2026-01-01T00:00:00.000Z"' },
    });
    expect(res.status).toBe(412);
    expect((await jsonOf(res)).code).toBeDefined();
    const kept = await call(MGR, 'serialSettings.get', null);
    expect(kept.data.alert.recipients).toEqual(['a@contoh.com']);
    expect(kept.data.updatedAt).toBe(first.data.updatedAt);
  });

  test('validasi: 21 penerima, dua alamat dalam satu entri, ganda tanpa beda huruf, bukan boolean: VALIDATION', async () => {
    const bad = (recipients: unknown, enabled: unknown = true) =>
      call(MGR, 'serialSettings.save', { expectedUpdatedAt: '', alert: { enabled, recipients } });
    const many = Array.from({ length: 21 }, (_, index) => `u${index}@contoh.com`);
    expect((await bad(many)).error?.code).toBe('VALIDATION');
    expect((await bad(['a@b.co, d@e.fr'])).error?.code).toBe('VALIDATION');
    expect((await bad(['a@contoh.com', 'A@Contoh.com'])).error?.code).toBe('VALIDATION');
    expect((await bad(['bukan-email'])).error?.code).toBe('VALIDATION');
    expect((await bad(['a@contoh.com'], 'ya')).error?.code).toBe('VALIDATION');
    expect((await bad('a@contoh.com')).error?.code).toBe('VALIDATION');
    expect((await bad(many.slice(0, 20))).ok).toBe(true);
  });

  test('izin: serial manage di semua BU atau super admin boleh; manage di satu BU, edit, view, atau tanpa peran: FORBIDDEN', async () => {
    expect((await call(MGR, 'serialSettings.get', null)).ok).toBe(true);
    expect((await call('admin@gmail.com', 'serialSettings.get', null)).ok).toBe(true);
    for (const email of [MGR_ONE, EDIT_ALL, SERIAL_USERS.viewer, SERIAL_USERS.nobu]) {
      expect([email, (await call(email, 'serialSettings.get', null)).error?.code]).toEqual([
        email,
        'FORBIDDEN',
      ]);
      const save = await call(email, 'serialSettings.save', {
        expectedUpdatedAt: '',
        alert: { enabled: true, recipients: ['a@contoh.com'] },
      });
      expect([email, save.error?.code]).toEqual([email, 'FORBIDDEN']);
    }
    const stored = await env.DB.prepare('SELECT 1 AS present FROM settings WHERE `key` = ?')
      .bind(SETTING_SERIAL_ALERT)
      .first();
    expect(stored).toBeNull();
  });
});
