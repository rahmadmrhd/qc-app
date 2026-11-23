// Halaman publik dashboard: `/api/public/dashboards/:token[/query]` (spek dashboard bagian 7.4).
import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { app } from '@server/app';
import { loadUserContext } from '@server/modules/access/context';
import { seedBusinessUnit, seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { seedHandover, seedSerial } from '@server-test/dashboard-seed';
import { seedCustomer } from '@server-test/item-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { PublicDashboardDto } from '@shared/dashboard-public';
import type { CreateShareInput } from '@shared/dashboard-share';
import { loadShare } from './share-repo';
import { createShare } from './share-service';

setDefaultTimeout(180_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;

let env: TestEnv;
const NOW = Date.parse('2026-11-23T05:00:00.000Z');
const SHARER = 'sharer@gmail.com';
const IP = '203.0.113.5';

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(NOW);
  await seedLocation(env, { id: 'loc-a', code: 'A', name: 'Lokasi A' });
  await seedBusinessUnit(env, { id: 'bu-x', code: 'X', name: 'BU Ex' });
  await seedBusinessUnit(env, { id: 'bu-y', code: 'Y', name: 'BU Ye' });
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
    buAssignments: [
      { buId: 'bu-x', roleIds: ['r-sn'] },
      { buId: 'bu-y', roleIds: ['r-sn'] },
    ],
  });
  await seedSerial(env, { id: 's1', buId: 'bu-x', itemId: 'i-1' });
  await seedSerial(env, { id: 's2', buId: 'bu-y', itemId: 'i-1' });
});

const RANGE = { mode: 'fixed', from: '2026-11-01', to: '2026-11-23' } as const;

function input(overrides: Partial<CreateShareInput> = {}): CreateShareInput {
  return {
    title: 'Ringkasan',
    filter: { from: '2026-11-01', to: '2026-11-23' },
    range: RANGE,
    widgets: [{ id: 'sn.recorded', filters: {} }],
    offers: [],
    expiresInDays: 30,
    ...overrides,
  };
}

/** Membuat tautan lewat layanan; mengembalikan id dan token. */
async function makeShare(overrides: Partial<CreateShareInput> = {}) {
  const user = await loadUserContext(env, SHARER);
  if (!user) throw new Error('pembagi tidak ditemukan');
  const dto = await createShare(env, user, input(overrides));
  const token = (dto.url ?? '').split('/dashboard-publik/')[1] ?? '';
  return { id: dto.id, token };
}

async function get(
  token: string,
  options: { ip?: string; search?: string } = {},
): Promise<Response> {
  return app.request(
    `https://qc.test/api/public/dashboards/${token}${options.search ?? ''}`,
    {},
    { ...env, clientIp: options.ip ?? IP },
  );
}

async function post(
  token: string,
  body: unknown,
  options: { ip?: string; csrf?: boolean; raw?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.csrf !== false) headers['x-requested-with'] = 'qc';
  return app.request(
    `https://qc.test/api/public/dashboards/${token}/query`,
    { method: 'POST', headers, body: options.raw ?? JSON.stringify(body) },
    { ...env, clientIp: options.ip ?? IP },
  );
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

const numberOf = (dto: PublicDashboardDto, id: string): number => {
  const widget = dto.widgets.find((entry) => entry.id === id);
  if (widget?.result.status !== 'ok' || widget.result.data.kind !== 'number') throw new Error('x');
  return widget.result.data.value;
};

function expectHardened(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('x-robots-tag')).toBe('noindex');
}

describe('respons sah', () => {
  test('GET memuat dashboard dengan header pengaman, tanpa previous dan tanpa surel pembagi', async () => {
    const { token } = await makeShare();
    const response = await get(token);
    expect(response.status).toBe(200);
    expectHardened(response);
    const text = await response.clone().text();
    expect(text).not.toContain('previous');
    expect(text).not.toContain('@gmail.com');
    const dto = (await response.json()) as PublicDashboardDto;
    expect(dto.sharedBy).toBe('sharer');
    expect(dto.widgets.map((widget) => widget.id)).toEqual(['sn.recorded']);
    expect(numberOf(dto, 'sn.recorded')).toBe(2);
  });

  test('parameter query yang tak dikenal pada GET tidak mengubah hasil', async () => {
    const { token } = await makeShare();
    const plain = (await (await get(token)).json()) as PublicDashboardDto;
    const noisy = (await (
      await get(token, { search: '?buIds=bu-y&from=2020-01-01&x=1' })
    ).json()) as PublicDashboardDto;
    expect(noisy.widgets).toEqual(plain.widgets);
    expect(noisy.range).toEqual(plain.range);
  });

  test('daftar pada GET maks. 10 baris dengan kolom putih saja', async () => {
    await seedCustomer(env, { id: 'c1', name: 'PT Maju' });
    for (let index = 0; index < 12; index += 1) {
      await seedHandover(env, { id: `h${index}`, locationId: 'loc-a', customerId: 'c1' });
    }
    const { token } = await makeShare({ widgets: [{ id: 'hs.oldest', filters: {} }] });
    const dto = (await (await get(token)).json()) as PublicDashboardDto;
    const result = dto.widgets[0]?.result;
    if (result?.status !== 'ok' || result.data.kind !== 'list') throw new Error('bukan daftar');
    expect(result.data.rows.length).toBeLessThanOrEqual(10);
    for (const row of result.data.rows) {
      expect(Object.keys(row).sort()).toEqual([
        'age',
        'customer',
        'location',
        'number',
        'progress',
      ]);
    }
  });

  test('POST query: widget di luar tautan tak muncul; isolasi BU (BU lain = nol, bentuk sama)', async () => {
    const { token } = await makeShare({
      filter: { from: '2026-11-01', to: '2026-11-23', buIds: ['bu-x'] },
    });
    const own = await post(token, { buIds: ['bu-x'] });
    expect(own.status).toBe(200);
    expectHardened(own);
    const ownDto = (await own.json()) as PublicDashboardDto;
    expect(ownDto.widgets.map((widget) => widget.id)).toEqual(['sn.recorded']);
    expect(numberOf(ownDto, 'sn.recorded')).toBe(1);
    const other = (await (await post(token, { buIds: ['bu-y'] })).json()) as PublicDashboardDto;
    expect(numberOf(other, 'sn.recorded')).toBe(0);
    expect(Object.keys(other).sort()).toEqual(Object.keys(ownDto).sort());
    expect(other.widgets.map((widget) => widget.id)).toEqual(['sn.recorded']);
  });
});

describe('penolakan seragam', () => {
  test('token acak, diutak-atik, kedaluwarsa, dicabut, pembagi nonaktif, dan pembagi kehilangan manage = 404 identik', async () => {
    const reference = await problemShape(await get('v1.abc.123.def', { ip: '198.51.100.1' }));
    expect(reference.status).toBe(404);
    expect(reference.code).toBe('NOT_FOUND');

    const valid = await makeShare();
    const tampered = `${valid.token.slice(0, -2)}${valid.token.endsWith('AA') ? 'BB' : 'AA'}`;
    const expiring = await makeShare({ expiresInDays: 1 });
    const revoked = await makeShare();
    await env.DB.prepare('UPDATE dashboard_shares SET revoked_at = ? WHERE id = ?')
      .bind('2026-11-23T04:00:00.000Z', revoked.id)
      .run();
    const lostManage = await makeShare();
    const cases: [string, string][] = [
      ['acak', 'bukan-token'],
      ['diutak-atik', tampered],
      ['dicabut', revoked.token],
    ];
    let index = 10;
    for (const [label, token] of cases) {
      const shape = await problemShape(await get(token, { ip: `198.51.100.${index++}` }));
      expect([label, shape]).toEqual([label, reference]);
    }
    // kedaluwarsa: maju 2 hari
    env.clock.set(NOW + 2 * 86_400_000);
    expect(await problemShape(await get(expiring.token, { ip: '198.51.100.40' }))).toEqual(
      reference,
    );
    env.clock.set(NOW);
    // pembagi kehilangan manage
    await env.DB.prepare('UPDATE users SET assignments = ? WHERE email = ?')
      .bind(JSON.stringify([{ locationId: 'loc-a', roleIds: ['r-hs'] }]), SHARER)
      .run();
    expect(await problemShape(await get(lostManage.token, { ip: '198.51.100.41' }))).toEqual(
      reference,
    );
    // pembagi nonaktif
    await env.DB.prepare("UPDATE users SET status = 'inactive' WHERE email = ?").bind(SHARER).run();
    expect(await problemShape(await get(valid.token, { ip: '198.51.100.42' }))).toEqual(reference);
    const notFound = await get(valid.token, { ip: '198.51.100.43' });
    expectHardened(notFound);
  });

  test('pembatas kegagalan: percobaan ke-21 dari IP yang sama = 429; tautan sah tidak diblokir', async () => {
    const { token } = await makeShare();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect((await get('v1.bukan.1.tidak-sah', { ip: IP })).status).toBe(404);
    }
    const blocked = await get('v1.bukan.1.tidak-sah', { ip: IP });
    expect(blocked.status).toBe(429);
    expectHardened(blocked);
    expect((await get(token, { ip: IP })).status).toBe(200);
    // IP lain tak terpengaruh
    expect((await get('v1.bukan.1.tidak-sah', { ip: '203.0.113.99' })).status).toBe(404);
  });
});

describe('pembatas keberhasilan POST query', () => {
  test('Review Focus 5: 31 permintaan dari satu IP (tanggal berbeda) = ke-31 429; jendela berikutnya pulih', async () => {
    const { token } = await makeShare();
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      const day = String(attempt % 23 || 23).padStart(2, '0');
      const response = await post(token, { from: `2026-11-${day}`, to: `2026-11-${day}` });
      expect([attempt, response.status]).toEqual([attempt, 200]);
    }
    const over = await post(token, { from: '2026-11-05', to: '2026-11-06' });
    expect(over.status).toBe(429);
    expectHardened(over);
    env.clock.set(NOW + 61_000);
    expect((await post(token, { from: '2026-11-05', to: '2026-11-06' })).status).toBe(200);
  });

  test('per tautan: permintaan ke-121 (IP berbeda) = 429', async () => {
    const { id, token } = await makeShare();
    await env.DB.prepare('INSERT INTO rate_limits (`key`, count, window_start) VALUES (?, 119, ?)')
      .bind(`dashboard-view-token:${id}`, NOW)
      .run();
    expect((await post(token, {}, { ip: '203.0.113.20' })).status).toBe(200); // ke-120
    const over = await post(token, {}, { ip: '203.0.113.21' }); // ke-121
    expect(over.status).toBe(429);
    env.clock.set(NOW + 61_000);
    expect((await post(token, {}, { ip: '203.0.113.22' })).status).toBe(200);
  });
});

describe('badan POST', () => {
  test('tanpa header CSRF ditolak; JSON rusak, filter tak sah = 400; badan > 16 KB ditolak', async () => {
    const { token } = await makeShare();
    expect((await post(token, {}, { csrf: false })).status).toBe(403);
    const broken = await post(token, null, { raw: '{bukan json' });
    expect(broken.status).toBe(400);
    expect(((await broken.json()) as Json).code).toBe('VALIDATION');
    expect((await post(token, { buIds: 'x' })).status).toBe(400);
    expect((await post(token, { from: '2026-11-10', to: '2026-11-01' })).status).toBe(400);
    const huge = await post(token, null, { raw: JSON.stringify({ buIds: ['x'.repeat(20_000)] }) });
    expect(huge.status).toBe(413);
    expectHardened(huge);
    // badan kosong dibaca sebagai tanpa filter
    expect((await post(token, null, { raw: '' })).status).toBe(200);
  });

  test('token rusak pada POST = 404 seragam tanpa membaca badan', async () => {
    const response = await post('v1.x.1.salah', {}, { ip: '198.51.100.77' });
    expect(response.status).toBe(404);
    expect(((await response.json()) as Json).code).toBe('NOT_FOUND');
    const row = await loadShare(env.DB, 'x');
    expect(row).toBeNull();
  });
});
