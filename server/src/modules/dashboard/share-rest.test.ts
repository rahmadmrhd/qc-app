import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

setDefaultTimeout(60_000);

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

const NOW = Date.parse('2026-11-23T05:00:00.000Z');
const SHARER = 'sharer@gmail.com'; // dashboard: edit (pembagi)
const OTHER = 'other@gmail.com'; // dashboard: edit (pembagi lain)
const MANAGER = 'manager@gmail.com'; // dashboard: manage (kelola semua)
const VIEWER = 'viewer@gmail.com'; // tanpa izin dashboard
const ADMIN = 'admin@gmail.com'; // super admin

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
  await seedRole(env, { id: 'r-dash', name: 'Dash', permissions: { dashboard: 'edit' } });
  await seedRole(env, { id: 'r-dash-all', name: 'DashAll', permissions: { dashboard: 'manage' } });
  await seedRole(env, { id: 'r-sn', name: 'SN', permissions: { serial: 'view' } });
  for (const [id, email, role] of [
    ['u-sharer', SHARER, 'r-dash'],
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

const create = (email: string | null = SHARER, body: unknown = BODY) =>
  rest.post('/dashboard-shares', { email, body });

/** Jawaban galat tanpa `requestId` (selalu beda): membandingkan "baris orang lain" dengan "id acak". */
async function problemOf(response: Response): Promise<Record<string, unknown>> {
  const { requestId: _ignored, ...others } = await jsonOf(response);
  return { httpStatus: response.status, ...others };
}

const UNKNOWN = '01zzzzzzzzzzzzzzzzzzzzzzzz';

describe('izin', () => {
  test('tanpa dashboard: edit = 403 pada semua rute; tanpa sesi = 401', async () => {
    expect((await create(VIEWER)).status).toBe(403);
    expect((await rest.get('/dashboard-shares', { email: VIEWER })).status).toBe(403);
    expect((await rest.get('/dashboard-shares/apa-saja', { email: VIEWER })).status).toBe(403);
    expect((await rest.post('/dashboard-shares/apa-saja/revoke', { email: VIEWER })).status).toBe(
      403,
    );
    expect((await create(null)).status).toBe(401);
    expect((await rest.get('/dashboard-shares', { email: null })).status).toBe(401);
  });
});

describe('create dan list', () => {
  test('create = 201 dengan url; list: pembagi, manage, dan super admin melihatnya dengan url; edit lain tidak melihat', async () => {
    const created = await create();
    expect(created.status).toBe(201);
    const dto = await jsonOf(created);
    expect(typeof dto.url).toBe('string');
    expect(dto.status).toBe('active');

    const listOf = async (email: string) =>
      (await (await rest.get('/dashboard-shares', { email })).json()) as {
        id: string;
        url?: string;
      }[];
    for (const email of [SHARER, MANAGER, ADMIN]) {
      const rows = await listOf(email);
      expect([email, rows.map((row) => row.id)]).toEqual([email, [dto.id as string]]);
      expect([email, rows[0]?.url]).toEqual([email, dto.url as string]);
    }
    expect(await listOf(OTHER)).toEqual([]);
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

describe('get dan revoke: baris sendiri vs baris orang lain', () => {
  test('edit lain: get dan revoke atas baris orang = jawaban SAMA PERSIS dengan id acak, dan tak mencabut apa pun', async () => {
    const dto = await jsonOf(await create());
    const id = dto.id as string;
    const get = await rest.get(`/dashboard-shares/${id}`, { email: OTHER });
    const getUnknown = await rest.get(`/dashboard-shares/${UNKNOWN}`, { email: OTHER });
    expect(get.status).toBe(404);
    expect(await problemOf(get)).toEqual(await problemOf(getUnknown));
    const revoke = await rest.post(`/dashboard-shares/${id}/revoke`, { email: OTHER });
    const revokeUnknown = await rest.post(`/dashboard-shares/${UNKNOWN}/revoke`, { email: OTHER });
    expect(revoke.status).toBe(404);
    expect(await problemOf(revoke)).toEqual(await problemOf(revokeUnknown));
    const row = await env.DB.prepare('SELECT revoked_at FROM dashboard_shares WHERE id = ?')
      .bind(id)
      .first<{ revoked_at: string }>();
    expect(row?.revoked_at).toBe('');
  });

  test('pembagi, manage, dan super admin boleh membaca (dengan url) dan mencabut', async () => {
    for (const email of [SHARER, MANAGER, ADMIN]) {
      const dto = await jsonOf(await create(SHARER));
      const got = await rest.get(`/dashboard-shares/${dto.id}`, { email });
      expect([email, got.status]).toEqual([email, 200]);
      expect([email, ((await got.json()) as { url?: string }).url]).toEqual([
        email,
        dto.url as string,
      ]);
      expect([
        email,
        (await rest.post(`/dashboard-shares/${dto.id}/revoke`, { email })).status,
      ]).toEqual([email, 200]);
    }
  });
});

describe('revoke', () => {
  test('pengelola semua boleh mencabut; idempoten; status menjadi revoked; satu audit', async () => {
    const dto = await jsonOf(await create());
    const first = await rest.post(`/dashboard-shares/${dto.id}/revoke`, { email: MANAGER });
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
  test('pembagi, manage, dan super admin; edit lain NOT_FOUND seragam; entri tidak memuat token', async () => {
    const dto = await jsonOf(await create());
    const read = (email: string, id: string) =>
      rest.get(`/activity?kind=dashboardShare&id=${id}`, { email });
    for (const email of [SHARER, MANAGER, ADMIN]) {
      const ok = await read(email, dto.id as string);
      expect([email, ok.status]).toEqual([email, 200]);
      const page = (await ok.json()) as { entries: { action: string }[] };
      expect(page.entries.map((entry) => entry.action)).toEqual(['dashboard.share_create']);
      expect(JSON.stringify(page)).not.toContain('v1.');
    }
    const other = await read(OTHER, dto.id as string);
    expect(other.status).toBe(404);
    expect(await problemOf(other)).toEqual(await problemOf(await read(OTHER, UNKNOWN)));
    expect((await read(VIEWER, dto.id as string)).status).toBe(403);
    expect((await read(SHARER, 'tidak-ada')).status).toBe(404);
  });
});
