import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

setDefaultTimeout(60_000);

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

const NOW = Date.parse('2026-11-23T05:00:00.000Z');
const OWNER = 'owner@gmail.com'; // dashboard: edit (pemilik laporan)
const OTHER = 'other@gmail.com'; // dashboard: edit (pemilik lain)
const MANAGER = 'manager@gmail.com'; // dashboard: manage (kelola semua)
const VIEWER = 'viewer@gmail.com'; // tanpa izin dashboard
const ADMIN = 'admin@gmail.com'; // super admin

const BODY = {
  name: 'Ringkasan mingguan',
  schedule: { frequency: 'weekly', hour: 8, weekday: 1, monthDay: 1 },
  period: 'lastWeek',
  filter: { from: '2026-11-01', to: '2026-11-23' },
  widgets: [{ id: 'sn.status', filters: {} }],
  offers: [],
  recipients: ['penerima@contoh.id'],
  linkDays: 14,
};

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(NOW);
  rest = restClient(env);
  await seedBusinessUnit(env, { id: 'bu-x', code: 'X' });
  await seedRole(env, { id: 'r-dash', name: 'Dash', permissions: { dashboard: 'edit' } });
  await seedRole(env, { id: 'r-dash-all', name: 'DashAll', permissions: { dashboard: 'manage' } });
  await seedRole(env, { id: 'r-sn', name: 'SN', permissions: { serial: 'view' } });
  for (const [id, email, role] of [
    ['u-owner', OWNER, 'r-dash'],
    ['u-other', OTHER, 'r-dash'],
    ['u-manager', MANAGER, 'r-dash-all'],
  ] as const) {
    await seedUser(env, {
      id,
      email,
      assignments: [{ locationId: null, roleIds: [role] }],
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

/** Jawaban galat tanpa `requestId` (selalu beda): membandingkan "baris orang lain" dengan "id acak". */
async function problemOf(response: Response): Promise<Record<string, unknown>> {
  const { requestId: _ignored, ...others } = await jsonOf(response);
  return { httpStatus: response.status, ...others };
}

const UNKNOWN = '01zzzzzzzzzzzzzzzzzzzzzzzz';

describe('izin', () => {
  test('tanpa dashboard: edit = 403 pada semua rute; tanpa sesi = 401', async () => {
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
    expect((await rest.post('/dashboard-reports/x/send-test', { email: VIEWER })).status).toBe(403);
    expect((await rest.get('/dashboard-reports/x/preview', { email: VIEWER })).status).toBe(403);
    expect((await create(null)).status).toBe(401);
    expect((await rest.get('/dashboard-reports', { email: null })).status).toBe(401);
  });
});

describe('CRUD', () => {
  test('create = 201; pemilik, manage, dan super admin melihat penerima penuh; edit lain tak melihat baris orang', async () => {
    const created = await create();
    expect(created.status).toBe(201);
    const dto = await jsonOf(created);
    expect(dto.owner).toBe(OWNER);
    expect(dto.recipients).toEqual(['penerima@contoh.id']);
    expect(dto.canEdit).toBe(true);

    type ListBody = {
      reports: { id: string; recipients: string[]; recipientCount: number; canEdit: boolean }[];
      smtpConfigured: boolean;
      limit: number;
    };
    const listOf = async (email: string) =>
      (await (await rest.get('/dashboard-reports', { email })).json()) as ListBody;
    // 'own': pemegang edit lain tidak melihat baris orang (daftar kosong).
    expect((await listOf(OTHER)).reports).toEqual([]);
    for (const email of [OWNER, MANAGER, ADMIN]) {
      const list = await listOf(email);
      expect(list.reports.map((row) => row.id)).toEqual([dto.id as string]);
      expect(list.reports[0]?.recipients).toEqual(['penerima@contoh.id']);
      expect(list.reports[0]?.recipientCount).toBe(1);
      expect(list.reports[0]?.canEdit).toBe(true);
      expect(list.limit).toBe(20);
      expect(list.smtpConfigured).toBe(false);
    }

    const got = await rest.get(`/dashboard-reports/${dto.id}`, { email: MANAGER });
    expect(got.status).toBe(200);
    const body = (await got.json()) as { recipients: string[]; scope: { widgets: unknown[] } };
    expect(body.recipients).toEqual(['penerima@contoh.id']);
    expect(body.scope.widgets).toHaveLength(1);
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

  test('PUT dengan If-Match usang = 412; versi tepat lolos; manage dan super admin boleh dan pemilik tetap', async () => {
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
    env.clock.advance(1000);
    const byManager = await rest.put(`/dashboard-reports/${id}`, {
      email: MANAGER,
      body: { ...BODY, name: 'Oleh manage' },
      headers: { 'if-match': `"${fresh}"` },
    });
    expect(byManager.status).toBe(200);
    const managed = await jsonOf(byManager);
    expect(managed.owner).toBe(OWNER);
    env.clock.advance(1000);
    const admin = await rest.put(`/dashboard-reports/${id}`, {
      email: ADMIN,
      body: { ...BODY, name: 'Oleh admin' },
      headers: { 'if-match': `"${managed.updatedAt as string}"` },
    });
    expect(admin.status).toBe(200);
    expect((await jsonOf(admin)).owner).toBe(OWNER);
  });

  test('setEnabled dan remove: pemilik dan manage boleh, edit lain 404 seragam, id tak dikenal 404', async () => {
    const dto = await jsonOf(await create());
    const id = dto.id as string;
    const denied = await rest.post(`/dashboard-reports/${id}/enabled`, {
      email: OTHER,
      body: { enabled: false },
    });
    expect(denied.status).toBe(404);
    const paused = await rest.post(`/dashboard-reports/${id}/enabled`, {
      email: OWNER,
      body: { enabled: false },
    });
    expect(paused.status).toBe(200);
    expect((await jsonOf(paused)).enabled).toBe(false);
    const resumed = await rest.post(`/dashboard-reports/${id}/enabled`, {
      email: MANAGER,
      body: { enabled: true },
    });
    expect(resumed.status).toBe(200);
    expect((await jsonOf(resumed)).enabled).toBe(true);
    expect((await rest.del(`/dashboard-reports/${id}`, { email: OTHER })).status).toBe(404);
    const removed = await rest.del(`/dashboard-reports/${id}`, { email: MANAGER });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true });
    expect((await rest.get(`/dashboard-reports/${id}`, { email: OWNER })).status).toBe(404);
    expect((await rest.del('/dashboard-reports/tidak-ada', { email: OWNER })).status).toBe(404);
  });
});

type Call = (id: string, email: string, tag: string) => Promise<Response>;
const ROUTES: readonly [string, Call][] = [
  ['get', (id, email) => rest.get(`/dashboard-reports/${id}`, { email })],
  [
    'save',
    (id, email, tag) =>
      rest.put(`/dashboard-reports/${id}`, {
        email,
        body: BODY,
        headers: { 'if-match': `"${tag}"` },
      }),
  ],
  [
    'setEnabled',
    (id, email) =>
      rest.post(`/dashboard-reports/${id}/enabled`, { email, body: { enabled: false } }),
  ],
  ['sendTest', (id, email) => rest.post(`/dashboard-reports/${id}/send-test`, { email })],
  ['preview', (id, email) => rest.get(`/dashboard-reports/${id}/preview`, { email })],
  ['remove', (id, email) => rest.del(`/dashboard-reports/${id}`, { email })],
];

describe('matriks hak: baris sendiri vs baris orang lain', () => {
  test('edit lain: baris orang = jawaban SAMA PERSIS dengan id acak (status dan badan), tak ada yang berubah', async () => {
    env.MAILER = { send: async () => undefined };
    const dto = await jsonOf(await create());
    const id = dto.id as string;
    const tag = dto.updatedAt as string;
    for (const [name, call] of ROUTES) {
      const other = await call(id, OTHER, tag);
      const unknown = await call(UNKNOWN, OTHER, tag);
      expect([name, other.status]).toEqual([name, 404]);
      expect([name, await problemOf(other)]).toEqual([name, await problemOf(unknown)]);
    }
    const after = await jsonOf(await rest.get(`/dashboard-reports/${id}`, { email: OWNER }));
    expect(after.enabled).toBe(true);
    expect(after.updatedAt).toBe(tag);
  });

  test('pemilik, manage, dan super admin: semua rute baris itu berhasil (200)', async () => {
    env.MAILER = { send: async () => undefined };
    for (const email of [OWNER, MANAGER, ADMIN]) {
      const dto = await jsonOf(await create(OWNER));
      const id = dto.id as string;
      for (const [name, call] of ROUTES) {
        const fresh = (await jsonOf(await rest.get(`/dashboard-reports/${id}`, { email: OWNER })))
          .updatedAt as string;
        env.clock.advance(1000);
        const response = await call(id, email, fresh);
        expect([email, name, response.status]).toEqual([email, name, 200]);
      }
    }
  });
});

describe('activity.list untuk dashboardReport', () => {
  test('pemilik, manage, dan super admin; edit lain NOT_FOUND seragam; entri tanpa alamat penerima', async () => {
    const dto = await jsonOf(await create());
    const read = (email: string, id: string) =>
      rest.get(`/activity?kind=dashboardReport&id=${id}`, { email });
    for (const email of [OWNER, MANAGER, ADMIN]) {
      const ok = await read(email, dto.id as string);
      expect([email, ok.status]).toEqual([email, 200]);
      const page = (await ok.json()) as { entries: { action: string }[] };
      expect(page.entries.map((entry) => entry.action)).toEqual(['dashboard.report_create']);
      expect(JSON.stringify(page)).not.toContain('contoh.id');
    }
    const other = await read(OTHER, dto.id as string);
    expect(other.status).toBe(404);
    expect(await problemOf(other)).toEqual(await problemOf(await read(OTHER, UNKNOWN)));
    expect((await read(VIEWER, dto.id as string)).status).toBe(403);
    expect((await read(OWNER, 'tidak-ada')).status).toBe(404);
  });
});

describe('sendTest dan preview', () => {
  const makeReport = async () => (await jsonOf(await create())).id as string;

  test('sendTest: ke surel PELAKU (pemilik ke pemilik; manage dan super admin ke dirinya), audit tanpa alamat', async () => {
    const sent: { to: string[]; bcc?: string[]; subject: string }[] = [];
    env.MAILER = {
      send: async (message) => {
        sent.push(message);
      },
    };
    const id = await makeReport();
    const url = `/dashboard-reports/${id}/send-test`;
    expect((await rest.post(url, { email: OTHER })).status).toBe(404);
    expect((await rest.post(url, { email: VIEWER })).status).toBe(403);
    const ok = await rest.post(url, { email: OWNER });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toEqual([OWNER]);
    expect(sent[0]?.subject.startsWith('[UJI] ')).toBe(true);
    // Pengelola semua menguji laporan orang lain: surel uji ke alamat PELAKU, bukan pemilik.
    expect((await rest.post(url, { email: ADMIN })).status).toBe(200);
    expect(sent[1]?.to).toEqual([ADMIN]);
    expect((await rest.post(url, { email: MANAGER })).status).toBe(200);
    expect(sent[2]?.to).toEqual([MANAGER]);

    const log = (await (
      await rest.get(`/activity?kind=dashboardReport&id=${id}`, { email: OWNER })
    ).json()) as { entries: { action: string }[] };
    expect(log.entries.filter((e) => e.action === 'dashboard.report_send_test')).toHaveLength(3);
    expect(JSON.stringify(log)).not.toContain('contoh.id');
  });

  test('sendTest: dibatasi 5 per jam per PELAKU; pelaku lain tidak ikut terhitung; jendela berikutnya pulih; id tak dikenal 404', async () => {
    env.MAILER = { send: async () => undefined };
    const id = await makeReport();
    const url = `/dashboard-reports/${id}/send-test`;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect([attempt, (await rest.post(url, { email: OWNER })).status]).toEqual([attempt, 200]);
    }
    const sixth = await rest.post(url, { email: OWNER });
    expect(sixth.status).toBe(409);
    expect((await jsonOf(sixth)).code).toBe('CONFLICT');
    // Pengelola lain punya jatahnya sendiri (kunci per pelaku).
    expect((await rest.post(url, { email: MANAGER })).status).toBe(200);
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

  test('preview: pemilik, manage, dan super admin mendapat subjek dan HTML, tanpa tautan terbitan; edit lain 404', async () => {
    const id = await makeReport();
    const url = `/dashboard-reports/${id}/preview`;
    expect((await rest.get(url, { email: OTHER })).status).toBe(404);
    const response = await rest.get(url, { email: OWNER });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { subject: string; html: string; trimmed: boolean };
    expect(body.subject).toStartWith('[UJI] [QC] Ringkasan mingguan, Minggu lalu');
    expect(body.html).toContain('https://qc.test/dashboard-publik/contoh');
    expect(body.html).not.toContain('penerima@contoh.id');
    expect(body.trimmed).toBe(false);
    expect((await rest.get(url, { email: MANAGER })).status).toBe(200);
    expect((await rest.get(url, { email: ADMIN })).status).toBe(200);
    const shares = await env.DB.prepare('SELECT COUNT(*) AS n FROM dashboard_shares').first<{
      n: number | string;
    }>();
    expect(Number(shares?.n)).toBe(0);
    expect((await rest.get('/dashboard-reports/tidak-ada/preview', { email: OWNER })).status).toBe(
      404,
    );
  });

  test('get: tautan terbitan tampil (dengan url) bagi pemilik, manage, dan super admin; edit lain 404', async () => {
    env.MAILER = { send: async () => undefined };
    const id = await makeReport();
    await env.DB.prepare("UPDATE dashboard_reports SET last_run_key = '' WHERE id = ?")
      .bind(id)
      .run();
    const { checkDashboardReports } = await import('./run');
    await checkDashboardReports(env, NOW);
    for (const email of [OWNER, MANAGER, ADMIN]) {
      const body = (await (await rest.get(`/dashboard-reports/${id}`, { email })).json()) as {
        links?: { url?: string; status: string }[];
      };
      expect([email, body.links?.length]).toEqual([email, 1]);
      expect(body.links?.[0]?.url).toStartWith('https://qc.test/dashboard-publik/');
    }
    expect((await rest.get(`/dashboard-reports/${id}`, { email: OTHER })).status).toBe(404);
  });
});
