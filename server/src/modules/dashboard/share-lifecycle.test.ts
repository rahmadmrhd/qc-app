// `dashboardShares.get` (halaman View tautan) dan penyapu kedaluwarsa (keputusan pemilik 2026-11-24).
import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { sweepExpiredShares } from '@server/modules/dashboard/share-expiry';
import { seedBusinessUnit, seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { seedCustomer } from '@server-test/item-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { CreateShareInput } from '@shared/dashboard-share';
import { VISIT_LIMITS } from '@shared/dashboard-visit';
import { insertShareStmt } from './share-repo';
import { recordShareVisit } from './share-visits';

setDefaultTimeout(120_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

const NOW = Date.parse('2026-11-23T05:00:00.000Z');
const DAY = 86_400_000;
const SHARER = 'sharer@gmail.com';
const OTHER = 'other@gmail.com';
const VIEWER = 'viewer@gmail.com';

const BODY: CreateShareInput = {
  title: 'Ringkasan',
  filter: { from: '2026-11-01', to: '2026-11-23' },
  range: { mode: 'fixed', from: '2026-11-01', to: '2026-11-23' },
  widgets: [
    { id: 'sn.recorded', filters: {} },
    { id: 'hs.created', filters: { customer: ['c1'], status: ['done'] } },
  ],
  offers: ['customer'],
  expiresInDays: 30,
};

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(NOW);
  rest = restClient(env);
  await seedLocation(env, { id: 'loc-a', code: 'A', name: 'Lokasi A' });
  await seedBusinessUnit(env, { id: 'bu-x', code: 'X', name: 'BU Ex' });
  await seedCustomer(env, { id: 'c1', name: 'PT Maju' });
  await seedRole(env, { id: 'r-dash', name: 'Dash', permissions: { dashboard: 'manage' } });
  await seedRole(env, { id: 'r-sn', name: 'SN', permissions: { serial: 'view' } });
  await seedRole(env, { id: 'r-hs', name: 'HS', permissions: { handover: 'view' } });
  await seedUser(env, {
    id: 'u-sharer',
    email: SHARER,
    assignments: [
      { locationId: null, roleIds: ['r-dash'] },
      { locationId: 'loc-a', roleIds: ['r-hs'] },
    ],
    buAssignments: [{ buId: 'bu-x', roleIds: ['r-sn'] }],
  });
  // pemegang manage lain tanpa hak Serah Terima: tak dapat meresolusi nama customer
  await seedUser(env, {
    id: 'u-other',
    email: OTHER,
    assignments: [{ locationId: null, roleIds: ['r-dash'] }],
  });
  await seedUser(env, { id: 'u-viewer', email: VIEWER });
});

async function create(body: CreateShareInput = BODY): Promise<{ id: string; url: string }> {
  const response = await rest.post('/dashboard-shares', { email: SHARER, body });
  expect(response.status).toBe(201);
  const dto = await jsonOf(response);
  return { id: dto.id as string, url: dto.url as string };
}

const getDetail = (id: string, email: string | null = SHARER) =>
  rest.get(`/dashboard-shares/${id}`, { email });

describe('dashboardShares.get', () => {
  test('izin: tanpa dashboard: manage = 403, tanpa sesi = 401, id tak dikenal = 404', async () => {
    const { id } = await create();
    expect((await getDetail(id, VIEWER)).status).toBe(403);
    expect((await getDetail(id, null)).status).toBe(401);
    const missing = await getDetail('tidak-ada');
    expect(missing.status).toBe(404);
    expect((await jsonOf(missing)).code).toBe('NOT_FOUND');
  });

  test('ringkasan: judul, status, url hanya untuk pembagi, cakupan dengan NAMA, filter, dan nama relasi', async () => {
    const { id, url } = await create();
    const own = (await jsonOf(await getDetail(id))) as Json;
    expect(own.title).toBe('Ringkasan');
    expect(own.status).toBe('active');
    expect(own.url).toBe(url);
    expect(own.revokedBy).toBe('');
    expect(own.visitCount).toBe(0);
    expect(own.visits).toEqual([]);
    expect(own.scope.buNames).toEqual(['BU Ex']);
    expect(own.scope.buDeleted).toEqual([false]);
    expect(own.scope.locationDeleted).toEqual([false]);
    expect(own.scope.locationNames).toEqual(['Lokasi A']);
    expect(own.scope.range).toEqual({ mode: 'fixed', from: '2026-11-01', to: '2026-11-23' });
    expect(own.scope.offers).toEqual(['customer']);
    expect(own.scope.widgets.map((widget: { id: string }) => widget.id)).toEqual([
      'sn.recorded',
      'hs.created',
    ]);
    expect(own.scope.valueNames).toEqual({ c1: 'PT Maju' });
    expect(JSON.stringify(own.scope.buNames)).not.toContain('bu-x');

    // pemegang manage lain: tanpa url; nama relasi hanya lewat HAK-nya (tanpa hak Serah Terima = tak ada nama)
    const other = (await jsonOf(await getDetail(id, OTHER))) as Json;
    expect('url' in other).toBe(false);
    expect(other.scope.valueNames).toEqual({});
    expect(other.title).toBe('Ringkasan');
  });

  test('dicabut: status, pencabut, dan url hilang', async () => {
    const { id } = await create();
    await rest.post(`/dashboard-shares/${id}/revoke`, { email: OTHER });
    const detail = (await jsonOf(await getDetail(id))) as Json;
    expect(detail.status).toBe('revoked');
    expect(detail.revokedBy).toBe(OTHER);
    expect(detail.revokedAt).toBe(new Date(NOW).toISOString());
    expect('url' in detail).toBe(false);
  });

  test('kedaluwarsa langsung berstatus expired (dihitung dari expires_at, tanpa penyapu)', async () => {
    const { id } = await create();
    env.clock.set(NOW + 31 * DAY);
    const detail = (await jsonOf(await getDetail(id))) as Json;
    expect(detail.status).toBe('expired');
  });

  test('kunjungan: ringkasan, maks. 50 baris terbaru, tanpa IP asli', async () => {
    const { id } = await create();
    for (let index = 0; index < VISIT_LIMITS.keep + 3; index += 1) {
      env.clock.set(NOW + index * 60_000);
      await recordShareVisit(
        env,
        id,
        { ip: `198.51.${index}.9`, userAgent: null, country: index === 0 ? 'ID' : null },
        env.clock.now(),
      );
    }
    const detail = (await jsonOf(await getDetail(id))) as Json;
    expect(detail.visitCount).toBe(VISIT_LIMITS.keep + 3);
    expect(detail.visits).toHaveLength(VISIT_LIMITS.keep);
    expect(detail.firstVisitAt).toBe(new Date(NOW).toISOString());
    expect(detail.lastVisitAt).toBe(new Date(NOW + (VISIT_LIMITS.keep + 2) * 60_000).toISOString());
    expect(detail.visits[0].ipPrefix).toBe(`198.51.${VISIT_LIMITS.keep + 2}.0/24`);
    expect(Object.keys(detail.visits[0]).sort()).toEqual([
      'country',
      'device',
      'ipPrefix',
      'visitedAt',
    ]);
    expect(JSON.stringify(detail)).not.toContain('.9"');
  });

  test('tautan terbitan laporan hanya terbaca pemilik atau super admin', async () => {
    await insertShareStmt(env.DB, {
      id: 'rep-share',
      title: 'Kiriman laporan',
      created_by: SHARER,
      created_at: new Date(NOW).toISOString(),
      expires_at: new Date(NOW + DAY).toISOString(),
      revoked_at: '',
      revoked_by: '',
      scope: '{}',
      report_id: 'rep-1',
    }).run();
    expect((await getDetail('rep-share', OTHER)).status).toBe(404);
    expect((await getDetail('rep-share', SHARER)).status).toBe(200);
    expect((await getDetail('rep-share', 'admin@gmail.com')).status).toBe(200);
  });

  test('M1: log aktivitas tautan terbitan laporan memakai gerbang yang sama (NOT_FOUND seragam bagi non-pemilik)', async () => {
    await insertShareStmt(env.DB, {
      id: 'rep-share',
      title: 'Kiriman laporan',
      created_by: SHARER,
      created_at: new Date(NOW).toISOString(),
      expires_at: new Date(NOW + DAY).toISOString(),
      revoked_at: '',
      revoked_by: '',
      scope: '{}',
      report_id: 'rep-1',
    }).run();
    const log = (email: string) =>
      rest.get('/activity?kind=dashboardShare&id=rep-share', { email });
    expect((await log(OTHER)).status).toBe(404);
    expect((await log(SHARER)).status).toBe(200);
    expect((await log('admin@gmail.com')).status).toBe(200);
    // tautan biasa tetap terbaca semua pemegang manage
    const { id } = await create();
    expect(
      (await rest.get(`/activity?kind=dashboardShare&id=${id}`, { email: OTHER })).status,
    ).toBe(200);
  });

  test('M2: BU dan lokasi terhapus tetap bernama dengan penanda terhapus', async () => {
    const { id } = await create();
    await env.DB.prepare(
      "UPDATE business_units SET deleted_at = ?, deleted_by = 'x' WHERE id = 'bu-x'",
    )
      .bind(new Date(NOW).toISOString())
      .run();
    await env.DB.prepare("UPDATE locations SET deleted_at = ?, deleted_by = 'x' WHERE id = 'loc-a'")
      .bind(new Date(NOW).toISOString())
      .run();
    const detail = (await jsonOf(await getDetail(id))) as Json;
    expect(detail.scope.buNames).toEqual(['BU Ex']);
    expect(detail.scope.buDeleted).toEqual([true]);
    expect(detail.scope.locationNames).toEqual(['Lokasi A']);
    expect(detail.scope.locationDeleted).toEqual([true]);
  });

  test('cakupan rusak tidak menjatuhkan halaman (cakupan kosong)', async () => {
    await insertShareStmt(env.DB, {
      id: 'rusak',
      title: 'Rusak',
      created_by: SHARER,
      created_at: new Date(NOW).toISOString(),
      expires_at: new Date(NOW + DAY).toISOString(),
      revoked_at: '',
      revoked_by: '',
      scope: 'bukan json',
      report_id: '',
    }).run();
    const detail = (await jsonOf(await getDetail('rusak'))) as Json;
    expect(detail.scope.widgets).toEqual([]);
    expect(detail.scope.buNames).toEqual([]);
  });
});

const expireRows = async () =>
  (
    await env.DB.prepare(
      "SELECT ts, actor, action, target, target_id, `before`, `after` FROM audit_log WHERE action = 'dashboard.share_expire' ORDER BY target_id",
    ).all<{
      ts: string;
      actor: string;
      action: string;
      target: string;
      target_id: string;
      before: string;
      after: string;
    }>()
  ).results;

describe('penyapu kedaluwarsa', () => {
  test('menulis satu baris nyata per tautan kedaluwarsa dengan ts = expires_at dan aktor system', async () => {
    const due = await create();
    const active = await create({ ...BODY, expiresInDays: 365 });
    env.clock.set(NOW + 31 * DAY);
    expect(await sweepExpiredShares(env)).toBe(1);
    const rows = await expireRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ts: new Date(NOW + 30 * DAY).toISOString(),
      actor: 'system',
      target: `dashboard_share:${due.id}`,
      target_id: due.id,
    });
    expect(rows.some((row) => row.target_id === active.id)).toBe(false);
  });

  test('idempoten: sapuan berulang tidak menulis ganda', async () => {
    await create();
    env.clock.set(NOW + 31 * DAY);
    expect(await sweepExpiredShares(env)).toBe(1);
    expect(await sweepExpiredShares(env)).toBe(0);
    expect(await expireRows()).toHaveLength(1);
  });

  test('sapuan serentak tidak menulis ganda', async () => {
    await create();
    await create();
    env.clock.set(NOW + 31 * DAY);
    await Promise.all([sweepExpiredShares(env), sweepExpiredShares(env), sweepExpiredShares(env)]);
    expect(await expireRows()).toHaveLength(2);
  });

  test('tautan dicabut sebelum kedaluwarsa tidak disentuh; dicabut sesudahnya tetap tercatat kedaluwarsa', async () => {
    const early = await create();
    const late = await create();
    await rest.post(`/dashboard-shares/${early.id}/revoke`, { email: SHARER });
    env.clock.set(NOW + 31 * DAY);
    await rest.post(`/dashboard-shares/${late.id}/revoke`, { email: SHARER });
    await sweepExpiredShares(env);
    expect((await expireRows()).map((row) => row.target_id)).toEqual([late.id]);
  });

  test('activity.list menampilkan dibuat, kedaluwarsa, dan dicabut dengan urutan benar', async () => {
    const { id } = await create();
    env.clock.set(NOW + 31 * DAY);
    await sweepExpiredShares(env);
    env.clock.set(NOW + 32 * DAY);
    await rest.post(`/dashboard-shares/${id}/revoke`, { email: SHARER });
    const response = await rest.get(`/activity?kind=dashboardShare&id=${id}`, { email: SHARER });
    expect(response.status).toBe(200);
    const page = (await response.json()) as {
      entries: { action: string; ts: string; actor: string }[];
    };
    expect(page.entries.map((entry) => entry.action)).toEqual([
      'dashboard.share_revoke',
      'dashboard.share_expire',
      'dashboard.share_create',
    ]);
    expect(page.entries[1]?.actor).toBe('system');
    expect(page.entries[1]?.ts).toBe(new Date(NOW + 30 * DAY).toISOString());
  });

  test('tautan yang belum kedaluwarsa tidak menghasilkan baris', async () => {
    await create();
    expect(await sweepExpiredShares(env)).toBe(0);
    expect(await expireRows()).toEqual([]);
  });
});
