import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

setDefaultTimeout(60_000);

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

const NOW = Date.parse('2026-11-23T05:00:00.000Z');
const OWNER = 'owner@gmail.com';
const OTHER = 'other@gmail.com';
const VIEWER = 'viewer@gmail.com';
const ADMIN = 'admin@gmail.com';

const BODY = {
  name: 'Ringkasan mingguan',
  schedule: { frequency: 'weekly', hour: 8, weekday: 1, monthDay: 1 },
  period: 'lastWeek',
  filter: { from: '2026-11-01', to: '2026-11-23' },
  widgets: [{ id: 'sn.recorded', filters: {} }],
  offers: [],
  recipients: ['penerima@contoh.id'],
  linkDays: 14,
};

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(NOW);
  rest = restClient(env);
  await seedBusinessUnit(env, { id: 'bu-x', code: 'X' });
  await seedRole(env, { id: 'r-dash', name: 'Dash', permissions: { dashboard: 'manage' } });
  await seedRole(env, { id: 'r-sn', name: 'SN', permissions: { serial: 'view' } });
  for (const [id, email] of [
    ['u-owner', OWNER],
    ['u-other', OTHER],
  ] as const) {
    await seedUser(env, {
      id,
      email,
      assignments: [{ locationId: null, roleIds: ['r-dash'] }],
      buAssignments: [{ buId: 'bu-x', roleIds: ['r-sn'] }],
    });
  }
  await seedUser(env, {
    id: 'u-viewer',
    email: VIEWER,
    buAssignments: [{ buId: 'bu-x', roleIds: ['r-sn'] }],
  });
});

const create = (email: string | null = OWNER, body: unknown = BODY) =>
  rest.post('/dashboard-reports', { email, body });

describe('izin', () => {
  test('tanpa dashboard: manage = 403 pada semua rute; tanpa sesi = 401', async () => {
    expect((await create(VIEWER)).status).toBe(403);
    expect((await rest.get('/dashboard-reports', { email: VIEWER })).status).toBe(403);
    expect((await rest.get('/dashboard-reports/x', { email: VIEWER })).status).toBe(403);
    expect((await rest.put('/dashboard-reports/x', { email: VIEWER, body: BODY })).status).toBe(
      403,
    );
    expect(
      (await rest.post('/dashboard-reports/x/enabled', { email: VIEWER, body: { enabled: true } }))
        .status,
    ).toBe(403);
    expect((await rest.del('/dashboard-reports/x', { email: VIEWER })).status).toBe(403);
    expect((await create(null)).status).toBe(401);
    expect((await rest.get('/dashboard-reports', { email: null })).status).toBe(401);
  });
});

describe('CRUD', () => {
  test('create = 201 dengan ETag; list dan get oleh pemegang manage lain tanpa alamat penerima', async () => {
    const created = await create();
    expect(created.status).toBe(201);
    const dto = await jsonOf(created);
    expect(dto.owner).toBe(OWNER);
    expect(dto.recipients).toEqual(['penerima@contoh.id']);
    expect(dto.canEdit).toBe(true);

    const list = (await (await rest.get('/dashboard-reports', { email: OTHER })).json()) as {
      reports: { id: string; recipients: string[]; recipientCount: number; canEdit: boolean }[];
      smtpConfigured: boolean;
      limit: number;
    };
    expect(list.reports.map((row) => row.id)).toEqual([dto.id as string]);
    expect(list.reports[0]?.recipients).toEqual([]);
    expect(list.reports[0]?.recipientCount).toBe(1);
    expect(list.reports[0]?.canEdit).toBe(false);
    expect(list.limit).toBe(20);
    expect(list.smtpConfigured).toBe(false);

    const got = await rest.get(`/dashboard-reports/${dto.id}`, { email: OTHER });
    expect(got.status).toBe(200);
    expect(((await got.json()) as { recipients: string[] }).recipients).toEqual([]);
  });

  test('masukan tak sah = 422 VALIDATION', async () => {
    const bad = [
      { ...BODY, name: '' },
      { ...BODY, recipients: [] },
      { ...BODY, recipients: ['A <a@x.id>'] },
      { ...BODY, linkDays: 0 },
      { ...BODY, schedule: { ...BODY.schedule, hour: 24 } },
      { ...BODY, widgets: [{ id: 'tidak.ada', filters: {} }] },
    ];
    for (const [index, body] of bad.entries()) {
      const response = await create(OWNER, body);
      expect([index, response.status]).toEqual([index, 422]);
      expect([index, (await jsonOf(response)).code]).toEqual([index, 'VALIDATION']);
    }
  });

  test('PUT dengan If-Match usang = 412; versi tepat lolos; non-pemilik = 403; super admin boleh', async () => {
    const dto = await jsonOf(await create());
    const id = dto.id as string;
    env.clock.advance(1000);
    const updated = await rest.put(`/dashboard-reports/${id}`, {
      email: OWNER,
      body: { ...BODY, name: 'Baru' },
      headers: { 'if-match': `"${dto.updatedAt as string}"` },
    });
    expect(updated.status).toBe(200);
    const stale = await rest.put(`/dashboard-reports/${id}`, {
      email: OWNER,
      body: { ...BODY, name: 'Lagi' },
      headers: { 'if-match': `"${dto.updatedAt as string}"` },
    });
    expect(stale.status).toBe(412);
    const fresh = (await jsonOf(updated)).updatedAt as string;
    const forbidden = await rest.put(`/dashboard-reports/${id}`, {
      email: OTHER,
      body: BODY,
      headers: { 'if-match': `"${fresh}"` },
    });
    expect(forbidden.status).toBe(403);
    env.clock.advance(1000);
    const admin = await rest.put(`/dashboard-reports/${id}`, {
      email: ADMIN,
      body: { ...BODY, name: 'Oleh admin' },
      headers: { 'if-match': `"${fresh}"` },
    });
    expect(admin.status).toBe(200);
    expect((await jsonOf(admin)).owner).toBe(OWNER);
  });

  test('setEnabled dan remove: pemilik boleh, pemegang manage lain 403, id tak dikenal 404', async () => {
    const dto = await jsonOf(await create());
    const id = dto.id as string;
    const denied = await rest.post(`/dashboard-reports/${id}/enabled`, {
      email: OTHER,
      body: { enabled: false },
    });
    expect(denied.status).toBe(403);
    const paused = await rest.post(`/dashboard-reports/${id}/enabled`, {
      email: OWNER,
      body: { enabled: false },
    });
    expect(paused.status).toBe(200);
    expect((await jsonOf(paused)).enabled).toBe(false);
    expect((await rest.del(`/dashboard-reports/${id}`, { email: OTHER })).status).toBe(403);
    const removed = await rest.del(`/dashboard-reports/${id}`, { email: OWNER });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true });
    expect((await rest.get(`/dashboard-reports/${id}`, { email: OWNER })).status).toBe(404);
    expect((await rest.del('/dashboard-reports/tidak-ada', { email: OWNER })).status).toBe(404);
  });
});

describe('activity.list untuk dashboardReport', () => {
  test('hanya pemegang manage; entri tanpa alamat penerima; id tak dikenal NOT_FOUND', async () => {
    const dto = await jsonOf(await create());
    const read = (email: string, id: string) =>
      rest.get(`/activity?kind=dashboardReport&id=${id}`, { email });
    const ok = await read(OTHER, dto.id as string);
    expect(ok.status).toBe(200);
    const page = (await ok.json()) as { entries: { action: string }[] };
    expect(page.entries.map((entry) => entry.action)).toEqual(['dashboard.report_create']);
    expect(JSON.stringify(page)).not.toContain('contoh.id');
    expect((await read(VIEWER, dto.id as string)).status).toBe(403);
    expect((await read(OTHER, 'tidak-ada')).status).toBe(404);
  });
});

describe('sendTest dan preview', () => {
  const makeReport = async () => (await jsonOf(await create())).id as string;

  test('sendTest: pemilik dan super admin boleh, pemegang manage lain 403, ke surel pemilik saja, audit tanpa alamat', async () => {
    const sent: { to: string[]; bcc?: string[]; subject: string }[] = [];
    env.MAILER = {
      send: async (message) => {
        sent.push(message);
      },
    };
    const id = await makeReport();
    const url = `/dashboard-reports/${id}/send-test`;
    expect((await rest.post(url, { email: OTHER })).status).toBe(403);
    expect((await rest.post(url, { email: VIEWER })).status).toBe(403);
    const ok = await rest.post(url, { email: OWNER });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.bcc).toEqual([OWNER]);
    expect(sent[0]?.subject.startsWith('[UJI] ')).toBe(true);
    // Super admin mengirim uji laporan orang lain: tetap ke surel PEMILIK.
    expect((await rest.post(url, { email: ADMIN })).status).toBe(200);
    expect(sent[1]?.bcc).toEqual([OWNER]);

    const log = (await (
      await rest.get(`/activity?kind=dashboardReport&id=${id}`, { email: OTHER })
    ).json()) as { entries: { action: string }[] };
    expect(log.entries.filter((e) => e.action === 'dashboard.report_send_test')).toHaveLength(2);
    expect(JSON.stringify(log)).not.toContain('contoh.id');
  });

  test('sendTest: dibatasi 5 per jam per pemilik; jendela berikutnya pulih; id tak dikenal 404', async () => {
    env.MAILER = { send: async () => undefined };
    const id = await makeReport();
    const url = `/dashboard-reports/${id}/send-test`;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect([attempt, (await rest.post(url, { email: OWNER })).status]).toEqual([attempt, 200]);
    }
    const sixth = await rest.post(url, { email: OWNER });
    expect(sixth.status).toBe(409);
    expect((await jsonOf(sixth)).code).toBe('CONFLICT');
    env.clock.advance(3_600_001);
    expect((await rest.post(url, { email: OWNER })).status).toBe(200);
    expect(
      (await rest.post('/dashboard-reports/tidak-ada/send-test', { email: OWNER })).status,
    ).toBe(404);
  });

  test('sendTest tanpa SMTP = 503 UNAVAILABLE', async () => {
    const id = await makeReport();
    const response = await rest.post(`/dashboard-reports/${id}/send-test`, { email: OWNER });
    expect(response.status).toBe(503);
    expect((await jsonOf(response)).code).toBe('UNAVAILABLE');
  });

  test('preview: pemilik dan super admin mendapat subjek dan HTML, tanpa tautan terbitan; pemegang manage lain 403', async () => {
    const id = await makeReport();
    const url = `/dashboard-reports/${id}/preview`;
    expect((await rest.get(url, { email: OTHER })).status).toBe(403);
    const response = await rest.get(url, { email: OWNER });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { subject: string; html: string };
    expect(body.subject).toStartWith('[QC] Ringkasan mingguan, Minggu lalu');
    expect(body.html).toContain('https://qc.test/dashboard-publik/contoh');
    expect(body.html).not.toContain('penerima@contoh.id');
    expect((await rest.get(url, { email: ADMIN })).status).toBe(200);
    const shares = await env.DB.prepare('SELECT COUNT(*) AS n FROM dashboard_shares').first<{
      n: number | string;
    }>();
    expect(Number(shares?.n)).toBe(0);
    expect((await rest.get('/dashboard-reports/tidak-ada/preview', { email: OWNER })).status).toBe(
      404,
    );
  });

  test('get: tautan terbitan tampil bagi pemilik, tanpa url bagi pemegang manage lain', async () => {
    env.MAILER = { send: async () => undefined };
    const id = await makeReport();
    await env.DB.prepare("UPDATE dashboard_reports SET last_run_key = '' WHERE id = ?")
      .bind(id)
      .run();
    const { checkDashboardReports } = await import('./run');
    await checkDashboardReports(env, NOW);
    const own = (await (await rest.get(`/dashboard-reports/${id}`, { email: OWNER })).json()) as {
      links?: { url?: string; status: string }[];
    };
    expect(own.links).toHaveLength(1);
    expect(own.links?.[0]?.url).toStartWith('https://qc.test/dashboard-publik/');
    const other = (await (await rest.get(`/dashboard-reports/${id}`, { email: OTHER })).json()) as {
      links?: unknown[];
    };
    expect(other.links).toBeUndefined();
  });
});
