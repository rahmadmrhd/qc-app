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
