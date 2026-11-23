import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

setDefaultTimeout(60_000);

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

const NOW = Date.parse('2026-11-23T05:00:00.000Z');
const SHARER = 'sharer@gmail.com';
const OTHER_MANAGER = 'other@gmail.com';
const VIEWER = 'viewer@gmail.com';
const ADMIN = 'admin@gmail.com';

const BODY = {
  title: 'Ringkasan',
  filter: { from: '2026-11-01', to: '2026-11-23' },
  range: { mode: 'fixed', from: '2026-11-01', to: '2026-11-23' },
  widgets: [{ id: 'sn.recorded', filters: {} }],
  offers: [],
  expiresInDays: 30,
};

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(NOW);
  rest = restClient(env);
  await seedBusinessUnit(env, { id: 'bu-x', code: 'X' });
  await seedRole(env, { id: 'r-dash', name: 'Dash', permissions: { dashboard: 'manage' } });
  await seedRole(env, { id: 'r-sn', name: 'SN', permissions: { serial: 'view' } });
  await seedUser(env, {
    id: 'u-sharer',
    email: SHARER,
    assignments: [{ locationId: null, roleIds: ['r-dash'] }],
    buAssignments: [{ buId: 'bu-x', roleIds: ['r-sn'] }],
  });
  await seedUser(env, {
    id: 'u-other',
    email: OTHER_MANAGER,
    assignments: [{ locationId: null, roleIds: ['r-dash'] }],
  });
  await seedUser(env, {
    id: 'u-viewer',
    email: VIEWER,
    buAssignments: [{ buId: 'bu-x', roleIds: ['r-sn'] }],
  });
});

const create = (email: string | null = SHARER, body: unknown = BODY) =>
  rest.post('/dashboard-shares', { email, body });

describe('izin', () => {
  test('tanpa dashboard: manage = 403 pada ketiga rute; tanpa sesi = 401', async () => {
    expect((await create(VIEWER)).status).toBe(403);
    expect((await rest.get('/dashboard-shares', { email: VIEWER })).status).toBe(403);
    expect((await rest.post('/dashboard-shares/apa-saja/revoke', { email: VIEWER })).status).toBe(
      403,
    );
    expect((await create(null)).status).toBe(401);
    expect((await rest.get('/dashboard-shares', { email: null })).status).toBe(401);
  });
});

describe('create dan list', () => {
  test('create = 201 dengan url; list oleh pemegang manage lain memuat tautan TANPA url', async () => {
    const created = await create();
    expect(created.status).toBe(201);
    const dto = await jsonOf(created);
    expect(typeof dto.url).toBe('string');
    expect(dto.status).toBe('active');

    const own = (await (await rest.get('/dashboard-shares', { email: SHARER })).json()) as {
      id: string;
      url?: string;
    }[];
    expect(own.map((row) => row.id)).toEqual([dto.id as string]);
    expect(own[0]?.url).toBe(dto.url as string);

    const other = (await (
      await rest.get('/dashboard-shares', { email: OTHER_MANAGER })
    ).json()) as { id: string; url?: string }[];
    expect(other.map((row) => row.id)).toEqual([dto.id as string]);
    expect('url' in (other[0] ?? {})).toBe(false);

    const admin = (await (await rest.get('/dashboard-shares', { email: ADMIN })).json()) as {
      url?: string;
    }[];
    expect(admin[0]?.url).toBe(dto.url as string);
  });

  test('masukan tak sah = 422 VALIDATION (judul kosong, hari 0 dan 366, widget tak dikenal)', async () => {
    const bad = [
      { ...BODY, title: '' },
      { ...BODY, expiresInDays: 0 },
      { ...BODY, expiresInDays: 366 },
      { ...BODY, widgets: [{ id: 'tidak.ada', filters: {} }] },
      { ...BODY, range: { mode: 'fixed', from: 'x', to: 'y' } },
      { ...BODY, offers: ['rahasia'] },
    ];
    for (const [index, body] of bad.entries()) {
      const response = await create(SHARER, body);
      expect([index, response.status]).toEqual([index, 422]);
      expect([index, (await jsonOf(response)).code]).toEqual([index, 'VALIDATION']);
    }
  });

  test('widget di luar hak pembuat = 422 VALIDATION', async () => {
    const response = await create(SHARER, {
      ...BODY,
      widgets: [{ id: 'pt.condition', filters: {} }],
    });
    expect(response.status).toBe(422);
  });
});

describe('revoke', () => {
  test('pemegang manage lain boleh mencabut; idempoten; status menjadi revoked', async () => {
    const dto = await jsonOf(await create());
    const first = await rest.post(`/dashboard-shares/${dto.id}/revoke`, { email: OTHER_MANAGER });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });
    const again = await rest.post(`/dashboard-shares/${dto.id}/revoke`, { email: SHARER });
    expect(again.status).toBe(200);
    const list = (await (await rest.get('/dashboard-shares', { email: SHARER })).json()) as {
      status: string;
      revokedAt: string;
    }[];
    expect(list[0]?.status).toBe('revoked');
    const firstRevoked = list[0]?.revokedAt;
    expect(firstRevoked).toBe(new Date(NOW).toISOString());
    // pencabutan kedua tidak menulis audit kedua
    const audits = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'dashboard.share_revoke'",
    ).first<{ n: number | string }>();
    expect(Number(audits?.n)).toBe(1);
  });

  test('id tak dikenal = 404 NOT_FOUND', async () => {
    const response = await rest.post('/dashboard-shares/tidak-ada/revoke', { email: SHARER });
    expect(response.status).toBe(404);
    expect((await jsonOf(response)).code).toBe('NOT_FOUND');
  });
});

describe('activity.list untuk dashboardShare', () => {
  test('hanya pemegang manage; entri tidak memuat token dan id tak dikenal NOT_FOUND', async () => {
    const dto = await jsonOf(await create());
    const read = (email: string, id: string) =>
      rest.get(`/activity?kind=dashboardShare&id=${id}`, { email });
    const ok = await read(OTHER_MANAGER, dto.id as string);
    expect(ok.status).toBe(200);
    const page = (await ok.json()) as { entries: { action: string }[] };
    expect(page.entries.map((entry) => entry.action)).toEqual(['dashboard.share_create']);
    expect(JSON.stringify(page)).not.toContain('v1.');
    expect((await read(VIEWER, dto.id as string)).status).toBe(403);
    expect((await read(OTHER_MANAGER, 'tidak-ada')).status).toBe(404);
  });
});
