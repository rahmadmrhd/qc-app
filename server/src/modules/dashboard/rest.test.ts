import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedBusinessUnit, seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { seedBrand, seedCustomer, seedItem } from '@server-test/item-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { seedSticker, seedStickerType } from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { WidgetId } from '@shared/dashboard';
import { WIDGET_IMPLS, type WidgetImpl } from './registry';

setDefaultTimeout(60_000);

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

const RANGE = { from: '2026-11-01', to: '2026-11-23' };
const HANDOVER_ONLY = 'wh@gmail.com';
const SERIAL_ONLY = 'sn@gmail.com';
const NOBODY = 'nobody@gmail.com';

const stubbed = new Map<WidgetId, WidgetImpl | undefined>();
function stub(id: WidgetId): void {
  stubbed.set(id, WIDGET_IMPLS.get(id));
  WIDGET_IMPLS.set(id, { id, run: async () => ({ kind: 'number', value: 7 }) });
}

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-23T05:00:00.000Z'));
  rest = restClient(env);
  await seedLocation(env, { id: 'loc-a', code: 'A', name: 'Lokasi A' });
  await seedBusinessUnit(env, { id: 'bu-a', code: 'A' });
  await seedRole(env, { id: 'r-wh', name: 'WH', permissions: { handover: 'view' } });
  await seedRole(env, { id: 'r-sn', name: 'SN', permissions: { serial: 'view' } });
  await seedUser(env, {
    id: 'u-wh',
    email: HANDOVER_ONLY,
    assignments: [{ locationId: 'loc-a', roleIds: ['r-wh'] }],
  });
  await seedUser(env, {
    id: 'u-sn',
    email: SERIAL_ONLY,
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-sn'] }],
  });
  await seedUser(env, { id: 'u-none', email: NOBODY });
  stub('hs.created');
  stub('sn.recorded');
});

afterEach(() => {
  for (const [id, impl] of stubbed) {
    if (impl) WIDGET_IMPLS.set(id, impl);
    else WIDGET_IMPLS.delete(id);
  }
  stubbed.clear();
});

const query = (widgets: unknown, filter: unknown = RANGE, email: string | null = HANDOVER_ONLY) =>
  rest.post('/dashboard/query', { email, body: { filter, widgets } });

describe('dashboard.query', () => {
  test('tanpa sesi = 401', async () => {
    const response = await query([{ id: 'hs.created' }], RANGE, null);
    expect(response.status).toBe(401);
  });

  test('widget yang boleh dilihat dihitung; keluaran memuat rentang dan bucket', async () => {
    const response = await query([{ id: 'hs.created' }]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.range).toEqual(RANGE);
    expect(body.bucket).toBe('day');
    expect(typeof body.generatedAt).toBe('string');
    expect(body.widgets).toEqual([
      { id: 'hs.created', status: 'ok', data: { kind: 'number', value: 7 } },
    ]);
  });

  test('id widget tak dikenal = VALIDATION', async () => {
    const response = await query([{ id: 'hs.tidak-ada' }]);
    expect(response.status).toBe(422);
    expect((await jsonOf(response)).code).toBe('VALIDATION');
  });

  test('filter grup berkunci bu/location/date atau kunci asing = VALIDATION', async () => {
    for (const key of ['bu', 'location', 'date', 'tidak-ada']) {
      const response = await query([{ id: 'hs.created', filters: { [key]: ['x'] } }]);
      expect(response.status, key).toBe(422);
    }
  });

  test('nilai filter enum di luar opsi, daftar kosong, atau lebih dari 20 nilai = VALIDATION', async () => {
    const bad = [
      { status: ['bukan-status'] },
      { status: [] },
      { customer: Array.from({ length: 21 }, (_, index) => `c${index}`) },
      { customer: 'bukan-daftar' },
    ];
    for (const filters of bad) {
      const response = await query([{ id: 'hs.created', filters }]);
      expect(response.status, JSON.stringify(filters)).toBe(422);
    }
    const good = await query([
      { id: 'hs.created', filters: { status: ['done', 'new'], customer: ['c1'] } },
    ]);
    expect(good.status).toBe(200);
  });

  test('31 widget = VALIDATION', async () => {
    const response = await query(Array.from({ length: 31 }, () => ({ id: 'hs.created' })));
    expect(response.status).toBe(422);
  });

  test('rentang tak sah atau filter global lebih dari 20 nilai = VALIDATION', async () => {
    expect(
      (await query([{ id: 'hs.created' }], { from: '2026-11-10', to: '2026-11-09' })).status,
    ).toBe(422);
    expect(
      (await query([{ id: 'hs.created' }], { from: '2025-01-01', to: '2026-11-09' })).status,
    ).toBe(422);
    const many = Array.from({ length: 21 }, (_, index) => `b${index}`);
    expect((await query([{ id: 'hs.created' }], { ...RANGE, buIds: many })).status).toBe(422);
    expect((await query([{ id: 'hs.created' }], { ...RANGE, buIds: [] })).status).toBe(200);
  });

  test('widget tanpa izin tidak ada di keluaran', async () => {
    const response = await query([{ id: 'hs.created' }, { id: 'sn.recorded' }]);
    const body = (await response.json()) as { widgets: { id: string }[] };
    expect(body.widgets.map((widget) => widget.id)).toEqual(['hs.created']);

    const serial = await query([{ id: 'hs.created' }, { id: 'sn.recorded' }], RANGE, SERIAL_ONLY);
    const serialBody = (await serial.json()) as { widgets: { id: string }[] };
    expect(serialBody.widgets.map((widget) => widget.id)).toEqual(['sn.recorded']);

    const nobody = await query([{ id: 'hs.created' }, { id: 'sn.recorded' }], RANGE, NOBODY);
    expect(((await nobody.json()) as { widgets: unknown[] }).widgets).toEqual([]);
  });
});

describe('dashboard.options', () => {
  beforeEach(async () => {
    await seedCustomer(env, { id: 'c-1', name: 'Customer Satu' });
    await seedBrand(env, 'Brand');
    await seedItem(env, { id: 'i-1', brand: 'Brand', model: 'Tipe 1', businessUnitIds: ['bu-a'] });
    await seedStickerType(env, { id: 't-1', name: 'Jenis Satu' });
    await seedSticker(env, { id: 's-1', typeId: 't-1', name: 'Stiker Satu' });
  });

  test('tanpa sesi = 401', async () => {
    expect((await rest.get('/dashboard/options', { email: null })).status).toBe(401);
  });

  test('pengguna hanya Serah Terima: hanya customer', async () => {
    const response = await rest.get('/dashboard/options', { email: HANDOVER_ONLY });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      customers: [{ value: 'c-1', label: 'Customer Satu' }],
      items: [],
      stickerTypes: [],
      stickers: [],
    });
  });

  test('pengguna hanya Serial Number: hanya item pada BU yang boleh dibaca', async () => {
    await seedBusinessUnit(env, { id: 'bu-b', code: 'B' });
    await seedItem(env, { id: 'i-b', brand: 'Brand', model: 'Tipe B', businessUnitIds: ['bu-b'] });
    const response = await rest.get('/dashboard/options', { email: SERIAL_ONLY });
    expect(await response.json()).toEqual({
      customers: [],
      items: [{ value: 'i-1', label: 'Brand Tipe 1' }],
      stickerTypes: [],
      stickers: [],
    });
  });

  test('admin melihat semua daftar; record terhapus tidak ikut', async () => {
    await seedCustomer(env, { id: 'c-2', name: 'Customer Dua' });
    await env.DB.prepare(
      "UPDATE customers SET deleted_at = '2026-11-01T00:00:00.000Z' WHERE id = ?",
    )
      .bind('c-2')
      .run();
    const response = await rest.get('/dashboard/options');
    const body = (await response.json()) as Record<string, { value: string }[]>;
    expect(body.customers?.map((option) => option.value)).toEqual(['c-1']);
    expect(body.items?.map((option) => option.value)).toEqual(['i-1']);
    expect(body.stickerTypes?.map((option) => option.value)).toEqual(['t-1']);
    expect(body.stickers?.map((option) => option.value)).toEqual(['s-1']);
  });

  test('pengguna tanpa izin apa pun mendapat semua daftar kosong', async () => {
    const response = await rest.get('/dashboard/options', { email: NOBODY });
    expect(await response.json()).toEqual({
      customers: [],
      items: [],
      stickerTypes: [],
      stickers: [],
    });
  });
});
