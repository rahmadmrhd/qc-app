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
const MANAGER = 'manager@gmail.com'; // dashboard: manage, hanya hak Serial
const UNKNOWN = '01zzzzzzzzzzzzzzzzzzzzzzzz';

const BODY = {
  title: 'Ringkasan',
  filter: { from: '2026-11-01', to: '2026-11-23' },
  range: { mode: 'fixed', from: '2026-11-01', to: '2026-11-23' },
  widgets: [{ id: 'sn.status', filters: {} }],
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
});

const create = async (body: unknown = BODY) =>
  jsonOf(await rest.post('/dashboard-shares', { email: SHARER, body }));
const update = (id: string, body: Record<string, unknown>, email = SHARER) =>
  rest.put(`/dashboard-shares/${id}`, { email, body });

describe('dashboardShares.update', () => {
  test('mengganti judul dan widget di tempat; id sama; satu audit dashboard.share_update', async () => {
    const created = await create();
    const response = await update(created.id as string, {
      ...BODY,
      title: 'Judul baru',
      widgets: [
        { id: 'sn.status', filters: {} },
        { id: 'sn.total', filters: {} },
      ],
      expiresInDays: undefined,
    });
    expect(response.status).toBe(200);
    const dto = await jsonOf(response);
    expect(dto.id).toBe(created.id as string);
    expect(dto.title).toBe('Judul baru');
    expect(dto.widgetCount).toBe(2);
    const audits = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'dashboard.share_update'",
    ).first<{ n: number | string }>();
    expect(Number(audits?.n)).toBe(1);
  });

  test('tanpa isian masa berlaku = URL tetap; mengganti masa berlaku = URL baru', async () => {
    const created = await create();
    const kept = await jsonOf(
      await update(created.id as string, { ...BODY, expiresInDays: undefined }),
    );
    expect(kept.url).toBe(created.url as string);
    expect(kept.expiresAt).toBe(created.expiresAt as string);
    const extended = await jsonOf(
      await update(created.id as string, { ...BODY, expiresInDays: 90 }),
    );
    expect(extended.url).not.toBe(created.url as string);
    expect(extended.expiresAt).not.toBe(created.expiresAt as string);
  });

  test('tautan milik orang lain = jawaban sama dengan id acak (NOT_FOUND), tak mengubah apa pun', async () => {
    const created = await create();
    const foreign = await update(created.id as string, { ...BODY, title: 'Dibajak' }, OTHER);
    const unknown = await update(UNKNOWN, { ...BODY, title: 'Dibajak' }, OTHER);
    expect(foreign.status).toBe(404);
    const strip = async (response: Response) => {
      const { requestId: _ignored, ...rest } = await jsonOf(response);
      return rest;
    };
    expect(await strip(foreign)).toEqual(await strip(unknown));
    const row = await env.DB.prepare('SELECT title FROM dashboard_shares WHERE id = ?')
      .bind(created.id as string)
      .first<{ title: string }>();
    expect(row?.title).toBe('Ringkasan');
  });

  test('tautan dicabut atau terbitan laporan = 409 CONFLICT', async () => {
    const revoked = await create();
    await rest.post(`/dashboard-shares/${revoked.id}/revoke`, { email: SHARER });
    expect((await update(revoked.id as string, BODY)).status).toBe(409);
    const fromReport = await create();
    await env.DB.prepare("UPDATE dashboard_shares SET report_id = 'rpt1' WHERE id = ?")
      .bind(fromReport.id as string)
      .run();
    expect((await update(fromReport.id as string, BODY)).status).toBe(409);
  });

  test('masukan tak sah = 422 (judul kosong, widget tak dikenal)', async () => {
    const created = await create();
    expect((await update(created.id as string, { ...BODY, title: '  ' })).status).toBe(422);
    expect(
      (
        await update(created.id as string, {
          ...BODY,
          widgets: [{ id: 'tak.dikenal', filters: {} }],
        })
      ).status,
    ).toBe(422);
  });

  test('pemegang manage tak boleh memasukkan widget di luar haknya sendiri (422, pesan generik)', async () => {
    const created = await create();
    const response = await update(
      created.id as string,
      { ...BODY, widgets: [{ id: 'hs.created', filters: {} }] },
      MANAGER,
    );
    expect(response.status).toBe(422);
  });
});
