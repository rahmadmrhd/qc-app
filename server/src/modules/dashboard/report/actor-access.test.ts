// Pratinjau dan kirim uji laporan MILIK ORANG LAIN = irisan hak pemilik dan hak pelaku (keputusan pemilik 2026-11-24).
import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import type { MailMessage } from '@server/core/mail';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { seedSerial } from '@server-test/dashboard-seed';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { TEST_BUTTON_NOTE, TEST_NOTE, TRIMMED_NOTE } from './render';

setDefaultTimeout(60_000);

let env: TestEnv;
let rest: ReturnType<typeof restClient>;
let sent: MailMessage[];

const NOW = Date.parse('2026-11-23T05:00:00.000Z'); // Senin 23 Nov 2026 12:00 WIB
const OWNER = 'owner@gmail.com'; // dashboard: edit; serial BU x dan y; sticker view
const WIDE = 'wide@gmail.com'; // manage; hak data sama dengan pemilik
const NARROW = 'narrow@gmail.com'; // manage; serial hanya BU x
const NOSTICKER = 'nosticker@gmail.com'; // manage; serial x dan y tanpa sticker view
const NODATA = 'nodata@gmail.com'; // manage; tanpa hak data sama sekali

const BODY = {
  name: 'Ringkasan',
  schedule: { frequency: 'weekly', hour: 8, weekday: 1, monthDay: 1 },
  period: 'lastWeek',
  filter: { from: '2026-11-01', to: '2026-11-23' },
  widgets: [
    { id: 'sn.recorded', filters: {} },
    { id: 'pt.condition', filters: {} },
  ],
  offers: [],
  recipients: ['penerima@contoh.id'],
  linkDays: 14,
};

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(NOW);
  rest = restClient(env);
  sent = [];
  env.MAILER = {
    send: async (message) => {
      sent.push(message);
    },
  };
  await seedBusinessUnit(env, { id: 'bu-x', code: 'X' });
  await seedBusinessUnit(env, { id: 'bu-y', code: 'Y' });
  await seedRole(env, { id: 'r-edit', name: 'Edit', permissions: { dashboard: 'edit' } });
  await seedRole(env, { id: 'r-all', name: 'All', permissions: { dashboard: 'manage' } });
  await seedRole(env, {
    id: 'r-data',
    name: 'Data',
    permissions: { serial: 'view', sticker: 'view' },
  });
  await seedRole(env, { id: 'r-sn', name: 'SN', permissions: { serial: 'view' } });
  const both = [
    { buId: 'bu-x', roleIds: ['r-data'] },
    { buId: 'bu-y', roleIds: ['r-data'] },
  ];
  const users: [string, string, string, string[], { buId: string; roleIds: string[] }[]][] = [
    ['u-owner', OWNER, 'r-edit', ['r-data'], both],
    ['u-wide', WIDE, 'r-all', ['r-data'], both],
    ['u-narrow', NARROW, 'r-all', ['r-data'], [{ buId: 'bu-x', roleIds: ['r-data'] }]],
    [
      'u-nosticker',
      NOSTICKER,
      'r-all',
      [],
      [
        { buId: 'bu-x', roleIds: ['r-sn'] },
        { buId: 'bu-y', roleIds: ['r-sn'] },
      ],
    ],
    ['u-nodata', NODATA, 'r-all', [], []],
  ];
  for (const [id, email, dashRole, dataRoles, buAssignments] of users) {
    await seedUser(env, {
      id,
      email,
      assignments: [{ locationId: null, roleIds: [dashRole, ...dataRoles] }],
      buAssignments,
    });
  }
  // Minggu lalu (16-22 Nov): dua serial di BU x dan satu di BU y.
  for (const [id, buId] of [
    ['s1', 'bu-x'],
    ['s2', 'bu-x'],
    ['s3', 'bu-y'],
  ] as const) {
    await seedSerial(env, { id, buId, createdAt: '2026-11-18T05:00:00.000Z' });
  }
});

async function makeReport(): Promise<string> {
  const response = await rest.post('/dashboard-reports', { email: OWNER, body: BODY });
  expect(response.status).toBe(201);
  return (await jsonOf(response)).id as string;
}

type Preview = { subject: string; html: string; trimmed: boolean };
const preview = async (id: string, email: string) =>
  rest.get(`/dashboard-reports/${id}/preview`, { email });

describe('pratinjau oleh pelaku bukan pemilik', () => {
  test('hak sama atau lebih luas = tanpa penanda; pemilik sendiri = tanpa penanda dan tanpa irisan', async () => {
    const id = await makeReport();
    for (const email of [OWNER, WIDE]) {
      const response = await preview(id, email);
      expect([email, response.status]).toEqual([email, 200]);
      const body = (await response.json()) as Preview;
      expect([email, body.trimmed]).toEqual([email, false]);
      expect(body.html).not.toContain(TRIMMED_NOTE);
      expect(body.html).toContain('Cakupan: BU: X, Y<br>');
    }
  });

  test('BU pelaku lebih sempit = penanda muncul dan angka hanya dari BU pelaku', async () => {
    const id = await makeReport();
    const body = (await (await preview(id, NARROW)).json()) as Preview;
    expect(body.trimmed).toBe(true);
    expect(body.html).toContain(TRIMMED_NOTE);
    // kepala memuat BU pelaku saja
    expect(body.html).toContain('Cakupan: BU: X<br>');
  });

  test('widget yang izin modul sumbernya tak dimiliki pelaku dihilangkan = penanda muncul', async () => {
    const id = await makeReport();
    const full = (await (await preview(id, WIDE)).json()) as Preview;
    const body = (await (await preview(id, NOSTICKER)).json()) as Preview;
    expect(full.html).toContain('Kondisi');
    expect(body.trimmed).toBe(true);
    expect(body.html).toContain(TRIMMED_NOTE);
    expect(body.html).toContain('Serial dicatat');
  });

  test('pelaku tanpa satu pun widget yang berlaku = CONFLICT dengan catatan yang tak menyebut isi laporan', async () => {
    const id = await makeReport();
    const response = await preview(id, NODATA);
    expect(response.status).toBe(409);
    const problem = await jsonOf(response);
    expect(problem.detail).toBe('Tidak ada data yang dapat ditampilkan dengan hak akses Anda');
    expect(JSON.stringify(problem)).not.toContain('Ringkasan');
  });

  test('penanda tidak muncul bila yang berkurang hanya hak PEMILIK sendiri (bukan pelaku)', async () => {
    const id = await makeReport();
    // Pemilik kehilangan BU y; pelaku (manage lebar) tetap memiliki x dan y, tetapi irisan = x saja karena hak pemilik.
    await env.DB.prepare('UPDATE users SET bu_assignments = ? WHERE email = ?')
      .bind(JSON.stringify([{ buId: 'bu-x', roleIds: ['r-data'] }]), OWNER)
      .run();
    const body = (await (await preview(id, WIDE)).json()) as Preview;
    expect(body.trimmed).toBe(false);
    expect(body.html).not.toContain(TRIMMED_NOTE);
  });
});

describe('kirim uji oleh pelaku bukan pemilik', () => {
  test('ke surel PELAKU, tanpa tautan terbitan, tombol ke /dashboard, keterangan uji, penanda hanya bila ada yang disembunyikan', async () => {
    const id = await makeReport();
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM dashboard_shares').first<{
      n: number | string;
    }>();
    expect(Number(before?.n)).toBe(0);

    expect((await rest.post(`/dashboard-reports/${id}/send-test`, { email: NARROW })).status).toBe(
      200,
    );
    const mail = sent[0] as MailMessage;
    expect(mail.bcc).toEqual([NARROW]);
    expect(mail.subject.startsWith('[UJI] ')).toBe(true);
    expect(mail.html).toContain('href="https://qc.test/dashboard"');
    expect(mail.html).not.toContain('/dashboard-publik/');
    expect(mail.text).not.toContain('/dashboard-publik/');
    expect(mail.text?.split('\n')[0]).toBe(TEST_NOTE);
    expect(mail.html).toContain(TEST_NOTE);
    expect(mail.html).toContain(TEST_BUTTON_NOTE);
    expect(mail.html).toContain(TRIMMED_NOTE);
    expect(mail.html).not.toContain('penerima@contoh.id');
    const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM dashboard_shares').first<{
      n: number | string;
    }>();
    expect(Number(after?.n)).toBe(0);

    // hak sama: tanpa penanda, tetap tanpa tautan terbitan
    expect((await rest.post(`/dashboard-reports/${id}/send-test`, { email: WIDE })).status).toBe(
      200,
    );
    const wide = sent[1] as MailMessage;
    expect(wide.bcc).toEqual([WIDE]);
    expect(wide.html).not.toContain(TRIMMED_NOTE);
    expect(wide.html).toContain('href="https://qc.test/dashboard"');
  });

  test('pemilik sendiri: surel uji ke pemilik dengan tautan terbitan SUNGGUHAN, tanpa penanda hak dan tanpa kalimat tombol', async () => {
    const id = await makeReport();
    expect((await rest.post(`/dashboard-reports/${id}/send-test`, { email: OWNER })).status).toBe(
      200,
    );
    const mail = sent[0] as MailMessage;
    expect(mail.bcc).toEqual([OWNER]);
    expect(mail.html).toContain('href="https://qc.test/dashboard-publik/v1.');
    expect(mail.html).toContain(TEST_NOTE);
    expect(mail.html).not.toContain(TEST_BUTTON_NOTE);
    expect(mail.html).not.toContain(TRIMMED_NOTE);
    const shares = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM dashboard_shares WHERE report_id = ?',
    )
      .bind(id)
      .first<{ n: number | string }>();
    expect(Number(shares?.n)).toBe(1);
  });

  test('pelaku tanpa widget yang berlaku = CONFLICT, tidak ada surel', async () => {
    const id = await makeReport();
    const response = await rest.post(`/dashboard-reports/${id}/send-test`, { email: NODATA });
    expect(response.status).toBe(409);
    expect(sent).toHaveLength(0);
  });
});

describe('surel terjadwal sungguhan tidak memuat keterangan uji', () => {
  test('hak pemilik saat kirim; tanpa keterangan uji, penanda hak, atau awalan [UJI]', async () => {
    const id = await makeReport();
    await env.DB.prepare("UPDATE dashboard_reports SET last_run_key = '' WHERE id = ?")
      .bind(id)
      .run();
    const { checkDashboardReports } = await import('./run');
    expect((await checkDashboardReports(env, NOW)).sent).toBe(1);
    const mail = sent[0] as MailMessage;
    expect(mail.subject).not.toContain('UJI');
    expect(mail.html).not.toContain(TEST_NOTE);
    expect(mail.text).not.toContain(TEST_NOTE);
    expect(mail.html).not.toContain(TRIMMED_NOTE);
    expect(mail.html).toContain('href="https://qc.test/dashboard-publik/v1.');
  });
});
