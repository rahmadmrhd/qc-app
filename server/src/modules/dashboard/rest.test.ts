import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedBusinessUnit, seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { seedBrand, seedCustomer, seedItem } from '@server-test/item-fixtures';
import { restCall } from '@server-test/rest-call';
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
  stub('sn.status');
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
    const response = await query([{ id: 'hs.created' }, { id: 'sn.status' }]);
    const body = (await response.json()) as { widgets: { id: string }[] };
    expect(body.widgets.map((widget) => widget.id)).toEqual(['hs.created']);

    const serial = await query([{ id: 'hs.created' }, { id: 'sn.status' }], RANGE, SERIAL_ONLY);
    const serialBody = (await serial.json()) as { widgets: { id: string }[] };
    expect(serialBody.widgets.map((widget) => widget.id)).toEqual(['sn.status']);

    const nobody = await query([{ id: 'hs.created' }, { id: 'sn.status' }], RANGE, NOBODY);
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
      brands: [],
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
      brands: [{ value: 'brand-brand', label: 'Brand' }],
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
    expect(body.brands?.map((option) => option.value)).toEqual(['brand-brand']);
    expect(body.stickerTypes?.map((option) => option.value)).toEqual(['t-1']);
    expect(body.stickers?.map((option) => option.value)).toEqual(['s-1']);
  });

  test('pengguna tanpa izin apa pun mendapat semua daftar kosong', async () => {
    const response = await rest.get('/dashboard/options', { email: NOBODY });
    expect(await response.json()).toEqual({
      brands: [],
      customers: [],
      items: [],
      stickerTypes: [],
      stickers: [],
    });
  });
});

describe('dashboard.options: pencarian dan halaman di server', () => {
  type Page = Record<string, { value: string; label: string }[]> & {
    next?: Record<string, string>;
  };
  const ADMIN_EMAIL = 'admin@gmail.com';
  const call = (email: string, input: unknown) => restCall(env, email, 'dashboard.options', input);
  const pageOf = async (email: string, input: unknown): Promise<Page> => {
    const result = await call(email, input);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.data as Page;
  };

  beforeEach(async () => {
    for (let index = 1; index <= 5; index += 1) {
      await seedCustomer(env, { id: `c-${index}`, name: `Cust ${index}` });
    }
  });

  test('kind + limit + cursor: halaman berurutan nama, next hanya bila masih ada sisa', async () => {
    const first = await pageOf(HANDOVER_ONLY, { kind: 'customers', limit: 2 });
    expect(first.customers?.map((option) => option.label)).toEqual(['Cust 1', 'Cust 2']);
    expect(first.next).toEqual({ customers: '2' });
    expect(first.items).toEqual([]);
    const second = await pageOf(HANDOVER_ONLY, { kind: 'customers', limit: 2, cursor: '2' });
    expect(second.customers?.map((option) => option.label)).toEqual(['Cust 3', 'Cust 4']);
    expect(second.next).toEqual({ customers: '4' });
    const third = await pageOf(HANDOVER_ONLY, { kind: 'customers', limit: 2, cursor: '4' });
    expect(third.customers?.map((option) => option.label)).toEqual(['Cust 5']);
    expect(third.next).toBeUndefined();
  });

  test('query mencari di server tanpa peduli huruf besar-kecil, dan % atau _ dicocokkan apa adanya', async () => {
    await seedCustomer(env, { id: 'c-pct', name: 'Diskon 100% Toko' });
    const found = await pageOf(HANDOVER_ONLY, { kind: 'customers', query: 'cust 3' });
    expect(found.customers?.map((option) => option.value)).toEqual(['c-3']);
    const literal = await pageOf(HANDOVER_ONLY, { kind: 'customers', query: '%' });
    expect(literal.customers?.map((option) => option.value)).toEqual(['c-pct']);
    const underscore = await pageOf(HANDOVER_ONLY, { kind: 'customers', query: '_' });
    expect(underscore.customers).toEqual([]);
  });

  test('record ke-51 dan seterusnya dapat dicari (tidak lagi terpotong)', async () => {
    for (let index = 6; index <= 60; index += 1) {
      await seedCustomer(env, { id: `c-${index}`, name: `Cust ${String(index).padStart(2, '0')}` });
    }
    const all = await pageOf(HANDOVER_ONLY, { kind: 'customers' });
    expect(all.customers?.length).toBe(50);
    expect(all.next).toEqual({ customers: '50' });
    const late = await pageOf(HANDOVER_ONLY, { kind: 'customers', query: 'Cust 60' });
    expect(late.customers?.map((option) => option.value)).toEqual(['c-60']);
  });

  test('ids meresolusi nama; yang terhapus atau tak dikenal tidak dikembalikan; abaikan limit dan query', async () => {
    await env.DB.prepare(
      "UPDATE customers SET deleted_at = '2026-11-01T00:00:00.000Z' WHERE id = ?",
    )
      .bind('c-2')
      .run();
    const result = await pageOf(HANDOVER_ONLY, {
      kind: 'customers',
      ids: ['c-4', 'c-2', 'tidak-ada', 'c-1'],
      query: 'tidak cocok',
      limit: 1,
    });
    expect(result.customers?.map((option) => option.value).sort()).toEqual(['c-1', 'c-4']);
    expect(result.next).toBeUndefined();
  });

  test('tanpa hak: id di luar hak tidak mengembalikan nama (item BU lain, daftar bukan hak)', async () => {
    await seedBusinessUnit(env, { id: 'bu-b', code: 'B' });
    await seedBrand(env, 'Brand');
    await seedItem(env, { id: 'i-a', brand: 'Brand', model: 'Tipe A', businessUnitIds: ['bu-a'] });
    await seedItem(env, { id: 'i-b', brand: 'Brand', model: 'Tipe B', businessUnitIds: ['bu-b'] });
    const serial = await pageOf(SERIAL_ONLY, { kind: 'items', ids: ['i-a', 'i-b'] });
    expect(serial.items?.map((option) => option.value)).toEqual(['i-a']);
    const searched = await pageOf(SERIAL_ONLY, { kind: 'items', query: 'tipe b' });
    expect(searched.items).toEqual([]);
    const byBrand = await pageOf(SERIAL_ONLY, { kind: 'items', query: 'brand tipe' });
    expect(byBrand.items?.map((option) => option.value)).toEqual(['i-a']);
    // Pengguna Serah Terima saja tak berhak atas daftar item, dan pengguna tanpa izin tak berhak atas customer.
    const handover = await pageOf(HANDOVER_ONLY, { kind: 'items', ids: ['i-a'] });
    expect(handover.items).toEqual([]);
    const none = await pageOf(NOBODY, { kind: 'customers', ids: ['c-1'] });
    expect(none.customers).toEqual([]);
  });

  test('jenis stiker dan stiker bisa dicari dan di-resolve dengan ids', async () => {
    await seedStickerType(env, { id: 't-x', name: 'Jenis Xenon' });
    await seedSticker(env, { id: 's-x', typeId: 't-x', name: 'Stiker Xenon' });
    const types = await pageOf(ADMIN_EMAIL, { kind: 'stickerTypes', query: 'xenon' });
    expect(types.stickerTypes?.map((option) => option.value)).toEqual(['t-x']);
    const stickers = await pageOf(ADMIN_EMAIL, { kind: 'stickers', ids: ['s-x'] });
    expect(stickers.stickers?.map((option) => option.label)).toEqual(['Stiker Xenon']);
  });

  test('validasi: cursor, query, dan ids wajib bersama kind; batas limit, cursor, ids', async () => {
    const accepted = async (input: unknown) => (await call(HANDOVER_ONLY, input)).ok;
    const ids = (count: number) => Array.from({ length: count }, (_, index) => `c${index}`);
    expect(await accepted({ cursor: '2' })).toBe(false);
    expect(await accepted({ query: 'x' })).toBe(false);
    expect(await accepted({ ids: ['c-1'] })).toBe(false);
    expect(await accepted({ kind: 'lain' })).toBe(false);
    expect(await accepted({ kind: 'customers', limit: 0 })).toBe(false);
    expect(await accepted({ kind: 'customers', limit: 101 })).toBe(false);
    expect(await accepted({ kind: 'customers', cursor: 'abc' })).toBe(false);
    expect(await accepted({ kind: 'customers', cursor: '-1' })).toBe(false);
    expect(await accepted({ kind: 'customers', ids: ids(21) })).toBe(false);
    expect(await accepted({ kind: 'customers', query: 'x'.repeat(101) })).toBe(false);
    expect(await accepted({ kind: 'customers', limit: 100 })).toBe(true);
    expect(await accepted({ kind: 'customers', ids: ids(20) })).toBe(true);
  });
});
